import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"
import { execa } from "execa"
import { taskDir } from "./paths.js"
import { SCHEMA_VERSION, type GateSpec, type GateState, type VerdictFile } from "./schema.js"

export const OUTPUT_TAIL_BYTES = 8192
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Tên gate được nội suy thẳng vào đường dẫn file (`verdicts/<name>.json` /
 * `.log`) — chỉ cho ký tự an toàn để không thể thoát ra khỏi `verdicts/`
 * (và do đó khỏi `.junto/`), vì key của `gates` trong config không bị
 * zod ràng buộc hình dạng (R1, ruling R-T).
 */
const VALID_GATE_NAME = /^[A-Za-z0-9._-]+$/

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

/** Các phần mở rộng cần thử khi tìm executable. Thử nguyên văn trước — argv[0] có thể đã tự mang đuôi. */
function candidateExtensions(): string[] {
  if (process.platform !== "win32") return [""]
  const pathext = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
  return ["", ...pathext.split(";").filter(Boolean)]
}

function existsAsExecutable(base: string): boolean {
  return candidateExtensions().some(ext => existsSync(base + ext))
}

/**
 * Dò `argv[0]` có resolve được thành một file thật trên đĩa không —
 * TRƯỚC khi spawn. Đây là quyết định tất định thay cho cách dò chuỗi trong
 * output cũ (ruling R-O): dò chữ trong stdout/stderr của tiến trình đã spawn
 * dính dương tính giả (một gate như `["npm","run","build"]` mà script bên
 * trong gọi một binary thiếu sẽ chuyển tiếp nguyên văn câu lỗi "not
 * recognized" của binary con đó — output không do người dùng kiểm soát, và
 * `npm` vẫn "chạy được") lẫn âm tính giả (Windows locale khác en-US không in
 * đúng câu tiếng Anh kỳ vọng, khiến lệnh thiếu bị báo `fail` thay vì
 * `skipped`). Resolve trước bằng PATH loại bỏ cả hai lớp sai số này.
 */
function resolveExecutable(cmd: string, cwd: string): boolean {
  if (cmd.includes("/") || cmd.includes("\\")) {
    const base = isAbsolute(cmd) ? cmd : join(cwd, cmd)
    return existsAsExecutable(base)
  }
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  return dirs.some(dir => existsAsExecutable(join(dir, cmd)))
}

interface Outcome {
  state: GateState
  exitCode: number | null
  output: string
  reason?: string
}

/**
 * `skipped` nghĩa là không có tiến trình nào từng chạy — vì vậy KHÔNG được
 * mang exit code (luôn `null`, dù nền tảng nào), và log KHÔNG được rỗng:
 * đúng lúc người dùng cần lời giải thích nhất mà để trống là phản tác dụng
 * (ruling R-Q).
 */
function skipOutcome(name: string, detail: string): Outcome {
  const reason = `Gate "${name}" không chạy được: ${detail}. `
    + `Cài công cụ rồi chạy lại, hoặc đặt required: false trong .junto/config.json.`
  return { state: "skipped", exitCode: null, output: reason, reason }
}

async function spawnOutcome(cmd: string, args: string[], cwd: string, name: string, timeoutMs: number): Promise<Outcome> {
  try {
    const res = await execa(cmd, args, {
      cwd,
      timeout: timeoutMs,
      all: true,
      reject: false,
      stripFinalNewline: false,
    })
    const output = res.all ?? ""
    const exitCode = res.exitCode ?? null

    // Lưới an toàn cho race hiếm (tool bị xoá giữa lúc resolveExecutable()
    // kiểm tra xong và lúc execa thực sự spawn) — nhánh "trả về" của R-E.
    if ((res as { code?: unknown }).code === "ENOENT") {
      return skipOutcome(name, `lệnh "${cmd}" không tồn tại`)
    }
    if (res.timedOut) {
      return {
        state: "fail",
        exitCode,
        output,
        reason: `Gate "${name}" chạy quá thời gian cho phép (${timeoutMs}ms).`,
      }
    }
    if (exitCode === 0) return { state: "pass", exitCode, output }
    return { state: "fail", exitCode, output }
  } catch (err) {
    // Nhánh "ném" của cùng lưới an toàn ở trên — theo đúng R-E, dù với
    // reject:false execa gần như không bao giờ chạy tới đây.
    const e = err as { code?: unknown; shortMessage?: string; message: string }
    if (e.code === "ENOENT") {
      return skipOutcome(name, e.shortMessage ?? e.message)
    }
    // execa (reject:false) hiếm khi ném vì lý do khác ENOENT — nếu có, coi là
    // fail để không lẫn với skipped (skipped chỉ dành cho "chưa cài tool").
    const reason = `Gate "${name}" gặp lỗi khi chạy: ${e.shortMessage ?? e.message}.`
    return { state: "fail", exitCode: null, output: reason, reason }
  }
}

/**
 * Chạy một gate và ghi bằng chứng ra đĩa.
 * argv LUÔN là mảng — không bao giờ ghép chuỗi shell.
 */
export async function runGate(opts: RunGateOptions): Promise<VerdictFile> {
  const { root, taskId, name, spec, runner } = opts
  if (!VALID_GATE_NAME.test(name)) {
    throw new Error(
      `Tên gate "${name}" không hợp lệ — chỉ cho phép chữ, số, ".", "_", "-". `
      + `Tên này bị nội suy thẳng vào đường dẫn verdicts/<name>.json.`,
    )
  }

  const cwd = root
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const [cmd, ...args] = spec.argv

  // gateSpecSchema đòi argv.length >= 1, nhưng noUncheckedIndexedAccess
  // không biết ràng buộc đó ở compile time — xử lý tường minh thay vì `cmd!`.
  const outcome = cmd === undefined
    ? skipOutcome(name, "argv rỗng")
    : resolveExecutable(cmd, cwd)
      ? await spawnOutcome(cmd, args, cwd, name, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      : skipOutcome(name, `lệnh "${cmd}" không tồn tại`)

  const dir = join(taskDir(root, taskId), "verdicts")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.log`), outcome.output, "utf-8")

  const verdict: VerdictFile = {
    schemaVersion: SCHEMA_VERSION,
    gate: name,
    argv: spec.argv,
    cwd,
    exitCode: outcome.exitCode,
    state: outcome.state,
    startedAt,
    durationMs: Date.now() - t0,
    outputTail: tail(outcome.output, OUTPUT_TAIL_BYTES),
    outputBytes: Buffer.byteLength(outcome.output, "utf-8"),
    outputFile: `verdicts/${name}.log`,
    runner,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  }

  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(verdict, null, 2)}\n`, "utf-8")
  return verdict
}
