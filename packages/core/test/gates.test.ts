import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { OUTPUT_TAIL_BYTES, runGate } from "../src/gates.js"

let root: string
const taskId = "2026-08-30-g"

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-gate-"))
  mkdirSync(join(root, ".junto", "tasks", taskId), { recursive: true })
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
})
