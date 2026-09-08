import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readActiveId, readTask, taskDir, writeTask } from "@junto/core"
import { advanceTool } from "../src/tools/advance.js"
import { statusTool } from "../src/tools/status.js"
import { taskTool } from "../src/tools/task.js"
import { verifyTool } from "../src/tools/verify.js"

let root: string
const ctx = () => ({ root, runner: "test@0" })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-status-"))
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({
    schemaVersion: 1,
    gates: { tests: { argv: ["node", "-e", "process.exit(0)"], required: true } },
    consultBudget: { maxTokensPerTask: 2_000 },
  }))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function activeId(): string {
  const id = readActiveId(root)
  if (id === null) throw new Error("Test requires an active task")
  return id
}

describe("statusTool", () => {
  it("reports clearly when no task is active", () => {
    expect(statusTool(ctx())).toMatch(/no active task/i)
  })

  it("shows identity, next action, gate state, budget, and a transition blocker", async () => {
    await taskTool(ctx(), { action: "start", title: "Add auth", size: "standard" })

    const output = statusTool(ctx())

    expect(output).toMatch(/Add auth/)
    expect(output).toMatch(/standard/)
    expect(output).toMatch(/Phase: brief/)
    expect(output).toMatch(/Next: \/junto:plan/)
    expect(output).toMatch(/tests: required, not run/)
    expect(output).toMatch(/0\/2000/)
    expect(output).toMatch(/brief\.md is missing or empty/)
  })

  it("reads the real verdict state and marks stale evidence", async () => {
    await taskTool(ctx(), { action: "start", title: "Fix", size: "small" })
    await advanceTool(ctx(), { to: "verify" })
    await verifyTool(ctx(), {})

    expect(statusTool(ctx())).toMatch(/tests: required, pass/)

    const id = activeId()
    const task = readTask(root, id)
    const tests = task.gates.tests
    if (tests === undefined) throw new Error("Test requires the tests gate")
    tests.stale = true
    writeTask(root, task)

    const stale = statusTool(ctx())
    expect(stale).toMatch(/tests: required, stale/)
    expect(stale).toMatch(/stale evidence/)
  })

  it("directs completed tasks to finish", async () => {
    await taskTool(ctx(), { action: "start", title: "Fix", size: "small" })
    await advanceTool(ctx(), { to: "verify" })
    await verifyTool(ctx(), {})
    await advanceTool(ctx(), { to: "done" })

    const output = statusTool(ctx())
    expect(output).toMatch(/Phase: done/)
    expect(output).toMatch(/Next: \/junto:finish/)
    expect(output).toMatch(/Blockers: none/)
  })

  it("reports an unreadable verdict instead of treating it as a pass", async () => {
    await taskTool(ctx(), { action: "start", title: "Fix", size: "small" })
    const id = activeId()
    const task = readTask(root, id)
    const tests = task.gates.tests
    if (tests === undefined) throw new Error("Test requires the tests gate")
    tests.verdict = "verdicts/tests.json"
    writeTask(root, task)
    writeFileSync(join(taskDir(root, id), "verdicts", "tests.json"), "not json")

    expect(statusTool(ctx())).toMatch(/tests: required, unreadable verdict/)
  })
})
