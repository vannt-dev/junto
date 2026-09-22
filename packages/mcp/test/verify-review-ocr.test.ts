import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureReviewFingerprint, OpenCodeReviewProvider, readActiveId, readConfig, readTask, updateTask, writeTask } from "@junto/core"
import { taskTool } from "../src/tools/task.js"
import { verifyTool } from "../src/tools/verify.js"
import { advanceTool } from "../src/tools/advance.js"
import { resolvePlan } from "../src/tools/plan.js"
import { statusTool } from "../src/tools/status.js"

/**
 * A real child process stands in for `ocr`, so these tests exercise argv, environment, exit codes and
 * output handling end to end. The JSON shape is the one `ocr review --format json` emits.
 */
let root: string
let bin: string
const ctx = () => ({ root, runner: "test@0" })
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" })
const savedBin = process.env.OPEN_CODE_REVIEW_BIN

function installFakeOcr(output: unknown, exitCode = 0): void {
  writeFileSync(join(bin, "out.json"), typeof output === "string" ? output : JSON.stringify(output))
  if (process.platform === "win32") {
    const script = [
      "@echo off",
      "if \"%~1\"==\"--version\" goto version",
      "echo %*>> \"%~dp0args.txt\"",
      "type \"%~dp0out.json\"",
      `exit /b ${exitCode}`,
      ":version",
      "echo ocr 9.9.9",
      "exit /b 0",
    ].join("\r\n")
    writeFileSync(join(bin, "ocr.cmd"), script)
    process.env.OPEN_CODE_REVIEW_BIN = join(bin, "ocr.cmd")
  } else {
    const script = [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo ocr 9.9.9; exit 0; fi",
      "echo \"$@\" >> \"$(dirname \"$0\")/args.txt\"",
      "cat \"$(dirname \"$0\")/out.json\"",
      `exit ${exitCode}`,
    ].join("\n")
    writeFileSync(join(bin, "ocr"), script)
    chmodSync(join(bin, "ocr"), 0o755)
    process.env.OPEN_CODE_REVIEW_BIN = join(bin, "ocr")
  }
}

const comment = (severity: string, extra: Record<string, unknown> = {}) => ({
  path: "src/auth/login.ts",
  content: "Token compared with == instead of a constant-time check",
  start_line: 12,
  end_line: 12,
  category: "security",
  severity,
  ...extra,
})

async function startTask(): Promise<string> {
  await taskTool(ctx(), { action: "start", title: "Add login", size: "small" })
  const id = readActiveId(root)!
  writeFileSync(join(root, ".junto", "tasks", id, "brief.md"), "Users log in with refresh tokens\n")
  return id
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-ocr-"))
  bin = mkdtempSync(join(tmpdir(), "junto-ocr-bin-"))
  git("init", "-q")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "t")
  git("config", "commit.gpgsign", "false")
  writeFileSync(join(root, "README.txt"), "x\n")
  git("add", ".")
  git("commit", "-q", "-m", "init")
  mkdirSync(join(root, "src", "auth"), { recursive: true })
  writeFileSync(join(root, "src", "auth", "login.ts"), "export {}\n")
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({
    schemaVersion: 1,
    gates: { "code-review": { type: "review", provider: "open-code-review", required: true } },
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  if (savedBin === undefined) delete process.env.OPEN_CODE_REVIEW_BIN
  else process.env.OPEN_CODE_REVIEW_BIN = savedBin
  rmSync(root, { recursive: true, force: true })
  rmSync(bin, { recursive: true, force: true })
})

describe("verify with a review gate and a real reviewer process", () => {
  it("accepts filesystem aliases of the repository but rejects a nested root", async () => {
    const id = await startTask()
    const task = readTask(root, id)
    const config = readConfig(root)
    const alias = join(bin, "repository-alias")
    symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir")
    expect(captureReviewFingerprint(alias, task, config)).toBe(captureReviewFingerprint(root, task, config))
    if (process.platform === "win32") {
      expect(captureReviewFingerprint(root.toUpperCase(), task, config)).toBe(captureReviewFingerprint(root, task, config))
    }
    expect(() => captureReviewFingerprint(join(root, "src"), task, config)).toThrow(/repository root/)
  })

  it.each(["source", "index", "head", "policy", "brief", "plan", "legacy"])("refuses stale %s evidence at status and completion", async change => {
    installFakeOcr({ status: "complete", comments: [] })
    const id = await startTask()
    await advanceTool(ctx(), { to: "verify" })
    await verifyTool(ctx(), {})
    const dir = join(root, ".junto", "tasks", id)
    if (change === "source") writeFileSync(join(root, "src/auth/login.ts"), "throw new Error('new bug')\n")
    if (change === "index") git("add", "src/auth/login.ts")
    if (change === "head") git("commit", "--allow-empty", "-qm", "move head")
    if (change === "policy") {
      const path = join(root, ".junto", "config.json")
      const config = JSON.parse(readFileSync(path, "utf8"))
      config.gates["code-review"].failOn = ["critical", "high", "medium"]
      writeFileSync(path, JSON.stringify(config))
    }
    if (change === "brief" || change === "plan") writeFileSync(join(dir, `${change}.md`), "Changed requirement")
    if (change === "legacy") {
      const path = join(dir, "verdicts/code-review.json")
      const verdict = JSON.parse(readFileSync(path, "utf8"))
      delete verdict.reviewFingerprint
      writeFileSync(path, JSON.stringify(verdict))
    }
    const stored = readFileSync(join(dir, "task.json"), "utf8")
    expect(await statusTool(ctx())).toContain("stale")
    expect(readFileSync(join(dir, "task.json"), "utf8")).toBe(stored)
    await expect(advanceTool(ctx(), { to: "done" })).rejects.toThrow(/stale/)
  })

  it("requires fresh evidence when archiving and permits completion after re-review", async () => {
    installFakeOcr({ status: "complete", comments: [] })
    await startTask()
    await advanceTool(ctx(), { to: "verify" })
    await verifyTool(ctx(), {})
    await advanceTool(ctx(), { to: "done" })
    writeFileSync(join(root, "src/auth/login.ts"), "export const changed = true\n")
    await expect(taskTool(ctx(), { action: "finish" })).rejects.toThrow(/stale/)
    await verifyTool(ctx(), {})
    expect(await taskTool(ctx(), { action: "finish" })).toContain("Archived")
  })

  it("fails when source changes while the reviewer runs", async () => {
    await startTask()
    vi.spyOn(OpenCodeReviewProvider.prototype, "review").mockImplementation(async () => {
      writeFileSync(join(root, "src/auth/login.ts"), "throw new Error('changed during review')\n")
      return { provider: "open-code-review", findings: [] }
    })
    expect(await verifyTool(ctx(), {})).toContain("changed during review")
    const id = readActiveId(root)
    expect(readTask(root, id!).gates["code-review"]?.stale).toBe(true)
  })

  it("preserves hook invalidations even when an in-flight edit is reverted", async () => {
    const id = await startTask()
    vi.spyOn(OpenCodeReviewProvider.prototype, "review").mockImplementation(async () => {
      const path = join(root, "src/auth/login.ts")
      const original = readFileSync(path)
      writeFileSync(path, "throw new Error('temporary edit')\n")
      updateTask(root, id, task => {
        const gate = task.gates["code-review"]!
        gate.invalidationVersion = (gate.invalidationVersion ?? 0) + 1
        gate.stale = true
      })
      writeFileSync(path, original)
      return { provider: "open-code-review", findings: [] }
    })
    expect(await verifyTool(ctx(), {})).toContain("changed during review")
    expect(readTask(root, id).gates["code-review"]?.stale).toBe(true)
  })

  it("does not archive an old review after changing its configured gate type", async () => {
    installFakeOcr({ status: "complete", comments: [] })
    await startTask()
    await advanceTool(ctx(), { to: "verify" })
    await verifyTool(ctx(), {})
    await advanceTool(ctx(), { to: "done" })
    writeFileSync(join(root, ".junto/config.json"), JSON.stringify({ schemaVersion: 1,
      gates: { "code-review": { type: "command", argv: ["node", "-e", "process.exit(0)"], required: true } } }))
    await expect(taskTool(ctx(), { action: "finish" })).rejects.toThrow(/stale/)
  })

  it("passes on a clean review and hands the reviewer the requirement background", async () => {
    installFakeOcr({ status: "complete", comments: null })
    const id = await startTask()

    const out = await verifyTool(ctx(), {})
    expect(out).toMatch(/code-review - pass/)

    const args = readFileSync(join(bin, "args.txt"), "utf-8")
    // On Windows cmd.exe quotes each argument, so compare without quotes.
    const flat = args.replace(/"/g, "")
    expect(flat).toContain("review")
    expect(flat).toContain("--format json")
    expect(flat).toContain("--background-file")
    expect(flat).not.toContain("--files")
    expect(readTask(root, id).gates["code-review"]?.failStreak).toBe(0)
    expect(existsSync(join(root, ".junto", "tasks", id, "review-background.md"))).toBe(true)
  })

  it("reviews committed task changes even when the workspace is clean", async () => {
    installFakeOcr({ status: "complete", comments: [] })
    const id = await startTask()
    const base = readTask(root, id).baseCommit
    git("add", "src/auth/login.ts")
    git("commit", "-q", "-m", "implement login")
    const head = git("rev-parse", "HEAD").toString().trim()
    expect(await verifyTool(ctx(), {})).toContain("code-review - pass")
    const args = readFileSync(join(bin, "args.txt"), "utf-8").replace(/"/g, "")
    expect(args).toContain(`--from ${base} --to ${head}`)
    expect(args.trim().split(/\r?\n/)).toHaveLength(1)
    const evidence = JSON.parse(readFileSync(join(root, ".junto", "tasks", id, "verdicts/code-review.review.json"), "utf-8"))
    expect(evidence.runs[0].scope).toMatchObject({ mode: "range", from: base, to: head, files: ["src/auth/login.ts"] })
  })

  it("reviews both committed and pending changes and previews the same scopes", async () => {
    const id = await startTask()
    git("add", "src/auth/login.ts")
    git("commit", "-q", "-m", "implement login")
    writeFileSync(join(root, "src/auth/login.ts"), "export const updated = true\n")
    installFakeOcr({ mode: "workspace", reviewable_files: [], excluded_files: [] })
    const plan = await resolvePlan(ctx())
    expect(plan.reviewScopes?.map(s => s.scope.mode)).toEqual(["range", "workspace"])
    installFakeOcr({ status: "complete", comments: [] })
    expect(await verifyTool(ctx(), {})).toContain("code-review - pass")
    const evidence = JSON.parse(readFileSync(join(root, ".junto", "tasks", id, "verdicts/code-review.review.json"), "utf-8"))
    expect(evidence.runs.map((r: { scope: unknown }) => r.scope)).toEqual(plan.reviewScopes?.map(s => s.scope))
    const calls = readFileSync(join(bin, "args.txt"), "utf-8").replace(/"/g, "").trim().split(/\r?\n/)
    expect(calls.filter(c => c.startsWith("review "))).toHaveLength(2)
    expect(calls.filter(c => c.includes("--from"))).toHaveLength(2) // preview + review
  })

  it("keeps a skipped OCR run from satisfying a required gate", async () => {
    installFakeOcr({ status: "skipped", comments: [] })
    const id = await startTask()
    await advanceTool(ctx(), { to: "verify" })
    expect(await verifyTool(ctx(), {})).toContain("code-review - skipped")
    expect(readTask(root, id).gates["code-review"]?.failStreak).toBe(0)
    await expect(advanceTool(ctx(), { to: "done" })).rejects.toThrow(/code-review \(skipped\)/)
  })

  it("invalidates old evidence if the task base is no longer in the current history", async () => {
    installFakeOcr({ status: "complete", comments: [] })
    const id = await startTask()
    expect(await verifyTool(ctx(), {})).toContain("code-review - pass")
    git("checkout", "--orphan", "unrelated-history")
    git("add", "src/auth/login.ts")
    git("commit", "-q", "-m", "new history")
    await expect(verifyTool(ctx(), {})).rejects.toThrow(/no longer an ancestor/)
    expect(readTask(root, id).gates["code-review"]?.stale).toBe(true)
  })

  it("refuses to guess committed scope when the task never captured a base", async () => {
    installFakeOcr({ status: "complete", comments: [] })
    const id = await startTask()
    const task = readTask(root, id)
    task.baseCommit = null // Represents a task started before the first commit.
    writeTask(root, task)
    await expect(verifyTool(ctx(), {})).rejects.toThrow(/no recorded base commit/)
    await expect(resolvePlan(ctx())).rejects.toThrow(/no recorded base commit/)
    expect(existsSync(join(bin, "args.txt"))).toBe(false)
  })

  it("fails on a high-severity finding and keeps the finding in evidence", async () => {
    installFakeOcr({ status: "complete", comments: [comment("high")] })
    const id = await startTask()

    const out = await verifyTool(ctx(), {})
    expect(out).toMatch(/code-review - fail/)
    expect(readTask(root, id).gates["code-review"]?.failStreak).toBe(1)
    const review = JSON.parse(readFileSync(join(root, ".junto", "tasks", id, "verdicts", "code-review.review.json"), "utf-8"))
    expect(review.findings[0]).toMatchObject({ severity: "high", category: "security", file: "src/auth/login.ts", line: 12 })
  })

  it("lets low-severity findings pass and redacts secrets from stored evidence", async () => {
    installFakeOcr({
      status: "complete",
      comments: [comment("low", { content: "Logs api_key=sk-abcdefghijklmnopqrstuvwxyz" })],
    })
    const id = await startTask()

    expect(await verifyTool(ctx(), {})).toMatch(/code-review - pass/)
    const dir = join(root, ".junto", "tasks", id, "verdicts")
    for (const file of ["code-review.review.json", "code-review.raw.json", "code-review.log"]) {
      expect(readFileSync(join(dir, file), "utf-8")).not.toContain("sk-abcdef")
    }
  })

  it("treats malformed reviewer output as a failure, not a pass", async () => {
    installFakeOcr("not json")
    await startTask()
    expect(await verifyTool(ctx(), {})).toMatch(/code-review - fail/)
  })

  it("treats a reviewer that exits non-zero as a failure, not a pass", async () => {
    installFakeOcr({ status: "complete", comments: [] }, 3)
    await startTask()
    const out = await verifyTool(ctx(), {})
    expect(out, out).toMatch(/code-review - fail/)
  })
})

describe("verify with a partial review", () => {
  it("fails the gate for a partial run but keeps its findings as evidence", async () => {
    installFakeOcr({ status: "partial", message: "1 of 2 selected item(s) failed", comments: [comment("low")] })
    const id = await startTask()
    const out = await verifyTool(ctx(), {})
    expect(out).toMatch(/code-review - fail/)
    const review = JSON.parse(readFileSync(join(root, ".junto", "tasks", id, "verdicts", "code-review.review.json"), "utf-8"))
    expect(review.error.kind).toBe("incomplete")
    expect(review.findings).toHaveLength(1)
  })
})
