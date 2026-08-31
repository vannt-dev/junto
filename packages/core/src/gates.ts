import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execa } from "execa"
import { taskDir } from "./paths.js"
import type { GateSpec, GateState, VerdictFile } from "./schema.js"

export const OUTPUT_TAIL_BYTES = 8192
const DEFAULT_TIMEOUT_MS = 300_000

export interface RunGateOptions {
  root: string
  taskId: string
  name: string
  spec: GateSpec
  runner: string
}

/** Lấy phần đuôi, cắt theo byte nhưng không cắt giữa ký tự UTF-8. */
function tail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8")
  if (buf.byteLength <= maxBytes) return text
  return new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(buf.byteLength - maxBytes))
}

/** Hình dạng chung của cả giá trị trả về (reject:false) lẫn lỗi ném ra bởi execa. */
interface ExecaLikeResult {
  code?: unknown
  exitCode?: number | null
  all?: string
  message?: string
  shortMessage?: string
}

/**
 * Lệnh "không chạy được" (tool chưa cài) hay đã chạy nhưng thoát khác 0?
 *
 * Trên POSIX, execa/Node báo đúng `code: "ENOENT"` khi không tìm thấy executable.
 * Trên Windows thì KHÔNG — đã kiểm chứng bằng thực nghiệm: execa gọi
 * `crossSpawn._parse()` chỉ để escaping rồi tự spawn bằng `node:child_process`,
 * bỏ qua hẳn phần hook phát hiện ENOENT của cross-spawn (xem
 * cross-spawn/lib/enoent.js). Hệ quả: một lệnh không tồn tại trên Windows lại
 * bị cross-spawn bọc qua `cmd.exe /d /s /c` (vì không tìm thấy phần mở rộng
 * .exe/.com để chạy thẳng), và cmd.exe "chạy" nó, in ra
 * `'<cmd>' is not recognized as an internal or external command, ...` rồi
 * thoát mã 1 — giống hệt hình dạng của một lệnh thật sự chạy và fail.
 * `res.code` khi đó là `undefined`, không phải `"ENOENT"`.
 *
 * Vì vậy phải kết hợp hai tín hiệu: field `code === "ENOENT"` (đường chính,
 * đúng trên POSIX) và, riêng trên win32, dò chữ trong output/message mà
 * cmd.exe luôn in ra khi không nhận ra lệnh.
 */
function isMissingCommand(x: ExecaLikeResult): boolean {
  if (x.code === "ENOENT") return true
  if (process.platform !== "win32") return false
  if (x.exitCode !== 1) return false
  const text = `${x.all ?? ""}\n${x.message ?? ""}\n${x.shortMessage ?? ""}`
  return /is not recognized as an internal or external command/i.test(text)
}

/**
 * Chạy một gate và ghi bằng chứng ra đĩa.
 * argv LUÔN là mảng — không bao giờ ghép chuỗi shell.
 */
export async function runGate(opts: RunGateOptions): Promise<VerdictFile> {
  const { root, taskId, name, spec, runner } = opts
  const [cmd, ...args] = spec.argv
  const cwd = root
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  let output = ""
  let exitCode: number | null = null
  let state: GateState
  let reason: string | undefined

  const skipReason = (detail: string) =>
    `Gate "${name}" không chạy được: ${detail}. `
    + `Cài công cụ rồi chạy lại, hoặc đặt required: false trong .junto/config.json.`

  try {
    // reject:false — execa trả về đối tượng kết quả kể cả khi thoát khác 0
    // hoặc không spawn được, thay vì ném lỗi. Nhánh catch bên dưới vẫn được
    // giữ để phòng trường hợp execa ném (ví dụ lỗi cấu hình option), theo
    // đúng ruling R-E: phải bắt được ENOENT dù ném hay trả về.
    const res = await execa(cmd!, args, {
      cwd,
      timeout: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      all: true,
      reject: false,
      stripFinalNewline: false,
    })
    output = res.all ?? ""
    exitCode = res.exitCode ?? null

    if (isMissingCommand(res)) {
      state = "skipped"
      reason = skipReason(`lệnh "${cmd}" không tồn tại`)
    } else if (res.timedOut) {
      state = "fail"
      reason = `Gate "${name}" chạy quá thời gian cho phép (${spec.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms).`
    } else if (exitCode === 0) {
      state = "pass"
    } else {
      state = "fail"
    }
  } catch (err) {
    const e = err as ExecaLikeResult & { message: string }
    if (isMissingCommand(e)) {
      state = "skipped"
      reason = skipReason(e.shortMessage ?? e.message)
    } else {
      // execa (reject:false) hiếm khi ném vì lý do khác ENOENT — nếu có, coi
      // là fail để không lẫn với skipped (skipped chỉ dành cho "chưa cài tool").
      state = "fail"
      reason = `Gate "${name}" gặp lỗi khi chạy: ${e.shortMessage ?? e.message}.`
    }
    output = reason
  }

  const dir = join(taskDir(root, taskId), "verdicts")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.log`), output, "utf-8")

  const verdict: VerdictFile = {
    gate: name,
    argv: spec.argv,
    cwd,
    exitCode,
    state,
    startedAt,
    durationMs: Date.now() - t0,
    outputTail: tail(output, OUTPUT_TAIL_BYTES),
    outputBytes: Buffer.byteLength(output, "utf-8"),
    outputFile: `verdicts/${name}.log`,
    runner,
    ...(reason ? { reason } : {}),
  }

  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(verdict, null, 2)}\n`, "utf-8")
  return verdict
}
