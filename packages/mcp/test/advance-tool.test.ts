import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readActiveId, readTask, taskDir, writeTask } from "@junto/core"
import { advanceTool } from "../src/tools/advance.js"
import { taskTool } from "../src/tools/task.js"
import { persistTaskPolicy } from "../src/tools/policy.js"
import { verifyTool } from "../src/tools/verify.js"

let root: string
const ctx = () => ({ root, runner: "test@0" })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-adv-"))
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({
    schemaVersion: 1,
    gates: { tests: { argv: ["node", "-e", "process.exit(0)"], required: true } },
  }))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function activeId(): string {
  const id = readActiveId(root)
  if (id === null) throw new Error("Test requires an active task")
  return id
}

const write = (id: string, name: string, body: string) =>
  writeFileSync(join(taskDir(root, id), name), body, "utf-8")

describe("advanceTool", () => {
  it("blocks brief -> plan when brief.md is empty and explains why", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    await expect(advanceTool(ctx(), { to: "plan" })).rejects.toThrow(/brief\.md/)
  })

  it("allows brief -> plan when brief.md has content", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    const id = activeId()
    write(id, "brief.md", "JWT support is required.")
    await advanceTool(ctx(), { to: "plan" })
    expect(readTask(root, id).phase).toBe("plan")
  })

  it("blocks plan -> build before approval and names the correct command", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    const id = activeId()
    write(id, "brief.md", "x")
    await advanceTool(ctx(), { to: "plan" })
    write(id, "plan.md", "1. Implement the change")
    await expect(advanceTool(ctx(), { to: "build" })).rejects.toThrow(/junto:approve/)
  })

  it("allows plan -> build after approvedBy is set", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    const id = activeId()
    write(id, "brief.md", "x")
    await advanceTool(ctx(), { to: "plan" })
    write(id, "plan.md", "1. Implement the change")
    const task = readTask(root, id)
    task.phases.plan = { status: "done", approvedBy: "user" }
    writeTask(root, task)
    await advanceTool(ctx(), { to: "build" })
    expect(readTask(root, id).phase).toBe("build")
  })

  it("blocks verify -> done when a gate has not run", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    await advanceTool(ctx(), { to: "verify" })
    await expect(advanceTool(ctx(), { to: "done" })).rejects.toThrow(/tests/)
  })

  it("allows verify -> done after the gate passes", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = activeId()
    await advanceTool(ctx(), { to: "verify" })
    await verifyTool(ctx(), {})
    await advanceTool(ctx(), { to: "done" })
    expect(readTask(root, id).phase).toBe("done")
  })

  it("blocks verify -> done when the verdict is stale", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = activeId()
    await advanceTool(ctx(), { to: "verify" })
    await verifyTool(ctx(), {})
    const task = readTask(root, id)
    const tests = task.gates.tests
    if (tests === undefined) throw new Error("Test requires the tests gate")
    tests.stale = true
    writeTask(root, task)
    await expect(advanceTool(ctx(), { to: "done" })).rejects.toThrow(/stale/)
  })

  it("cannot set approvedBy because the hook owns approval", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    const id = activeId()
    write(id, "brief.md", "x")
    await advanceTool(ctx(), { to: "plan" })
    expect(readTask(root, id).phases.plan?.approvedBy).toBeUndefined()
  })

  it("moves an approved deep task into panel before build", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "deep" })
    const id = activeId()
    write(id, "brief.md", "x")
    await advanceTool(ctx(), { to: "plan" })
    write(id, "plan.md", "1. Implement the change")
    const task = readTask(root, id)
    task.phases.plan = { status: "done", approvedBy: "user" }
    writeTask(root, task)
    const out = await advanceTool(ctx(), { to: "panel" })
    expect(out).toMatch(/junto:panel/)
    expect(readTask(root, id).phase).toBe("panel")
    await advanceTool(ctx(), { to: "build" })
    expect(readTask(root, id).phase).toBe("build")
  })

  it("moves a deep task through review before verify", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "deep" })
    const id = activeId()
    write(id, "brief.md", "x")
    await advanceTool(ctx(), { to: "plan" })
    write(id, "plan.md", "1. Implement the change")
    const task = readTask(root, id)
    task.phases.plan = { status: "done", approvedBy: "user" }
    writeTask(root, task)
    await advanceTool(ctx(), { to: "panel" })
    await advanceTool(ctx(), { to: "build" })
    const out = await advanceTool(ctx(), { to: "review" })
    expect(out).toMatch(/junto:panel/)
    await expect(advanceTool(ctx(), { to: "done" })).rejects.toThrow(/adjacent/)
    await advanceTool(ctx(), { to: "verify" })
    expect(readTask(root, id).phase).toBe("verify")
  })
})

describe("advanceTool with source-bound command gates", () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })

  beforeEach(() => {
    git("init", "-q")
    git("config", "user.email", "junto@example.test")
    git("config", "user.name", "Junto Test")
    writeFileSync(join(root, "app.js"), "export const value = 1\n")
    writeFileSync(join(root, "README.md"), "# App\n")
    git("add", "app.js", "README.md")
    git("commit", "-q", "-m", "init")
  })

  async function passTests(): Promise<string> {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = activeId()
    await advanceTool(ctx(), { to: "verify" })
    await verifyTool(ctx(), {})
    return id
  }

  it("blocks done when source changed without an edit hook (for example through Bash)", async () => {
    await passTests()
    writeFileSync(join(root, "app.js"), "export const value = 2\n")
    await expect(advanceTool(ctx(), { to: "done" })).rejects.toThrow(/tests \(stale evidence/)
  })

  it("ignores files covered by staleIgnore and commits of unchanged content", async () => {
    const id = await passTests()
    writeFileSync(join(root, "README.md"), "# App\n\nMore docs.\n")
    git("add", "README.md")
    git("commit", "-q", "-m", "docs")
    await advanceTool(ctx(), { to: "done" })
    expect(readTask(root, id).phase).toBe("done")
  })

  it("keeps a user approval recorded while policy obligations are persisted", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = activeId()
    const stored = readTask(root, id)
    const approved = readTask(root, id)
    approved.phases.build = { ...(approved.phases.build ?? { status: "active" }), approvedBy: "user" }
    writeTask(root, approved)
    // Policy resolved from the older snapshot must merge, not overwrite the approval.
    persistTaskPolicy(root, stored, { ...stored, ruleApprovalRequired: true })
    const after = readTask(root, id)
    expect(after.phases.build?.approvedBy).toBe("user")
    expect(after.ruleApprovalRequired).toBe(true)
  })

  it("stays done-able after reverting a change made after the gate ran", async () => {
    const id = await passTests()
    writeFileSync(join(root, "app.js"), "export const value = 2\n")
    writeFileSync(join(root, "app.js"), "export const value = 1\n")
    await advanceTool(ctx(), { to: "done" })
    expect(readTask(root, id).phase).toBe("done")
  })
})
