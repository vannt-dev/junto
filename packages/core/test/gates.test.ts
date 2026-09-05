import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  it("treats exit code 0 as pass", async () => {
    const v = await run(["node", "-e", "process.exit(0)"])
    expect(v.state).toBe("pass")
    expect(v.exitCode).toBe(0)
  })

  it("treats a nonzero exit code as fail", async () => {
    const v = await run(["node", "-e", "process.exit(3)"])
    expect(v.state).toBe("fail")
    expect(v.exitCode).toBe(3)
  })

  it("treats a missing command as skipped, not failed", async () => {
    const v = await run(["junto-command-does-not-exist-abc123"])
    expect(v.state).toBe("skipped")
    expect(v.reason).toMatch(/could not run|not found|ENOENT/i)
  })

  it("treats a timeout as failed and includes a reason", async () => {
    const v = await run(["node", "-e", "setTimeout(()=>{}, 60000)"], 300)
    expect(v.state).toBe("fail")
    expect(v.reason).toMatch(/timeout/i)
  })

  it("writes the full log to disk", async () => {
    const v = await run(["node", "-e", "console.log('hello')"])
    const log = readFileSync(join(root, ".junto", "tasks", taskId, "verdicts", "g.log"), "utf-8")
    expect(log).toMatch(/hello/)
    expect(v.outputFile).toBe("verdicts/g.log")
  })

  it("writes a readable verdict JSON file", async () => {
    await run(["node", "-e", "process.exit(0)"])
    const raw = readFileSync(join(root, ".junto", "tasks", taskId, "verdicts", "g.json"), "utf-8")
    expect(JSON.parse(raw).state).toBe("pass")
  })

  it("truncates outputTail while reporting the full byte count", async () => {
    const v = await run(["node", "-e", "for(let i=0;i<20000;i++) console.log('x'.repeat(40))"])
    expect(v.outputBytes).toBeGreaterThan(OUTPUT_TAIL_BYTES)
    expect(Buffer.byteLength(v.outputTail, "utf-8")).toBeLessThanOrEqual(OUTPUT_TAIL_BYTES)
  })

  it("includes stderr in output", async () => {
    const v = await run(["node", "-e", "console.error('error here'); process.exit(1)"])
    expect(v.outputTail).toMatch(/error here/)
  })

  it("records argv exactly for auditability", async () => {
    const v = await run(["node", "-e", "process.exit(0)"])
    expect(v.argv).toEqual(["node", "-e", "process.exit(0)"])
  })


  it("keeps an existing command that prints 'not recognized' classified as failed", async () => {
    const v = await run([
      "node",
      "-e",
      "console.log(\"'x' is not recognized as an internal or external command\"); process.exit(1)",
    ])
    expect(v.state).toBe("fail")
    expect(v.exitCode).toBe(1)
  })

  it("classifies an existing command with exit code 1 as failed", async () => {
    const v = await run(["node", "-e", "console.error('error here'); process.exit(1)"])
    expect(v.state).toBe("fail")
    expect(v.exitCode).toBe(1)
  })

  it("gives skipped verdicts no exit code and a nonempty log", async () => {
    const v = await run(["junto-command-does-not-exist-abc123"])
    expect(v.state).toBe("skipped")
    expect(v.exitCode).toBeNull()
    const log = readFileSync(join(root, ".junto", "tasks", taskId, "verdicts", "g.log"), "utf-8")
    expect(log.length).toBeGreaterThan(0)
  })

  it("rejects an invalid gate name that could escape verdicts/", async () => {
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

  it.each(["NUL", "con.json", "COM1", "lpt9.log"])("rejects reserved Windows device names: %s", async (name) => {
    await expect(runGate({
      root,
      taskId,
      name,
      spec: { argv: ["node", "-e", "process.exit(0)"], required: true },
      runner: "test@0",
    })).rejects.toThrow(/reserved.*Windows/i)
  })

  it.skipIf(process.platform === "win32")("skips files without the executable bit on POSIX", async () => {
    const command = join(root, "not-executable")
    writeFileSync(command, "#!/bin/sh\nexit 0\n", "utf-8")
    chmodSync(command, 0o644)
    const verdict = await run([command])
    expect(verdict.state).toBe("skipped")
  })
})
