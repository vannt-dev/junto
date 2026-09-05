import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readActiveId, readTask, taskDir, writeTask } from "@junto/core"
import { advanceTool } from "../src/tools/advance.js"
import { taskTool } from "../src/tools/task.js"
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
})
