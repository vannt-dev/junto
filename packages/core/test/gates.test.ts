import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OUTPUT_TAIL_BYTES, runGate } from "../src/gates.js"

let root: string
const taskId = "2026-08-30-g"
const tmpDirs: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-gate-"))
  tmpDirs.push(root)
  mkdirSync(join(root, ".junto", "tasks", taskId), { recursive: true })
})

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const run = (argv: string[], timeoutMs?: number) =>
  runGate({ root, taskId, name: "g", spec: { argv, required: true, timeoutMs }, runner: "test@0" })

describe("runGate", () => {
  it("thoát 0 là pass", async () => {
    const v = await run(["node", "-e", "process.exit(0)"])
    expect(v.state).toBe("pass")
    expect(v.exitCode).toBe(0)
  })

  it("thoát khác 0 là fail", async () => {
    const v = await run(["node", "-e", "process.exit(3)"])
    expect(v.state).toBe("fail")
    expect(v.exitCode).toBe(3)
  })

  it("lệnh không tồn tại là skipped, KHÔNG phải fail", async () => {
    const v = await run(["junto-khong-ton-tai-abc123"])
    expect(v.state).toBe("skipped")
    expect(v.reason).toMatch(/không chạy được|not found|ENOENT/i)
  })

  it("timeout là fail kèm lý do", async () => {
    const v = await run(["node", "-e", "setTimeout(()=>{}, 60000)"], 300)
    expect(v.state).toBe("fail")
    expect(v.reason).toMatch(/quá thời gian|timeout/i)
  })

  it("ghi file log đầy đủ ra đĩa", async () => {
    const v = await run(["node", "-e", "console.log('xin chao')"])
    const log = readFileSync(join(root, ".junto", "tasks", taskId, "verdicts", "g.log"), "utf-8")
    expect(log).toMatch(/xin chao/)
    expect(v.outputFile).toBe("verdicts/g.log")
  })

  it("ghi file verdict json đọc lại được", async () => {
    await run(["node", "-e", "process.exit(0)"])
    const raw = readFileSync(join(root, ".junto", "tasks", taskId, "verdicts", "g.json"), "utf-8")
    expect(JSON.parse(raw).state).toBe("pass")
  })

  it("cắt outputTail nhưng vẫn báo đúng tổng số byte", async () => {
    const v = await run(["node", "-e", "for(let i=0;i<20000;i++) console.log('x'.repeat(40))"])
    expect(v.outputBytes).toBeGreaterThan(OUTPUT_TAIL_BYTES)
    expect(Buffer.byteLength(v.outputTail, "utf-8")).toBeLessThanOrEqual(OUTPUT_TAIL_BYTES)
  })

  it("gộp cả stderr vào output", async () => {
    const v = await run(["node", "-e", "console.error('loi o day'); process.exit(1)"])
    expect(v.outputTail).toMatch(/loi o day/)
  })

  it("ghi lại argv nguyên vẹn để kiểm chứng được", async () => {
    const v = await run(["node", "-e", "process.exit(0)"])
    expect(v.argv).toEqual(["node", "-e", "process.exit(0)"])
  })

  // --- Bổ sung ở vòng review 1 (fix R-O/R-Q/R-T) — không sửa 9 test ở trên ---

  it("lệnh có thật in đúng câu bẫy 'not recognized' rồi thoát 1 vẫn là fail, không phải skipped", async () => {
    // Ghim chiều dương tính giả của cách dò chuỗi cũ: một gate như
    // `["npm","run","build"]` có thể chuyển tiếp nguyên văn lỗi "not
    // recognized" của một binary con thiếu — output đó không do người dùng
    // kiểm soát và không được phép biến gate thành skipped.
    const v = await run([
      "node",
      "-e",
      "console.log(\"'x' is not recognized as an internal or external command\"); process.exit(1)",
    ])
    expect(v.state).toBe("fail")
    expect(v.exitCode).toBe(1)
  })

  it("lệnh có thật thoát mã 1 phải là fail (chiều còn lại của ranh giới fail/skipped)", async () => {
    const v = await run(["node", "-e", "console.error('loi o day'); process.exit(1)"])
    expect(v.state).toBe("fail")
    expect(v.exitCode).toBe(1)
  })

  it("skipped không mang exit code và log không rỗng", async () => {
    const v = await run(["junto-khong-ton-tai-abc123"])
    expect(v.state).toBe("skipped")
    expect(v.exitCode).toBeNull()
    const log = readFileSync(join(root, ".junto", "tasks", taskId, "verdicts", "g.log"), "utf-8")
    expect(log.length).toBeGreaterThan(0)
  })

  it("tên gate không hợp lệ (có thể thoát khỏi verdicts/) bị từ chối", async () => {
    await expect(
      runGate({
        root,
        taskId,
        name: "../../../evil",
        spec: { argv: ["node", "-e", "process.exit(0)"], required: true },
        runner: "test@0",
      }),
    ).rejects.toThrow()
  })
})
