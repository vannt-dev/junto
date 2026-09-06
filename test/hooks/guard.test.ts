import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readTask, setActiveId, taskDir, writeTask, type Task } from "@junto/core"
import { handleGuard, isProtected } from "../../src-hooks/guard.js"

let root: string

function seed(): Task {
  const now = "2026-08-30T09:00:00Z"
  const task: Task = {
    schemaVersion: 1,
    id: "t",
    title: "T",
    size: "small",
    phase: "build",
    baseCommit: null,
    createdAt: now,
    updatedAt: now,
    phases: { build: { status: "active" } },
    gates: {
      tests: { required: true, verdict: "verdicts/tests.json", stale: false, failStreak: 0 },
      lint: { required: false, verdict: "verdicts/lint.json", stale: false, failStreak: 0 },
    },
    decisions: [],
    consults: [],
    consultTokensUsed: 0,
  }
  mkdirSync(taskDir(root, task.id), { recursive: true })
  writeTask(root, task)
  setActiveId(root, task.id)
  return task
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-guard-"))
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates: {} }))
  seed()
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const pre = (file: string) => handleGuard({
  hook_event_name: "PreToolUse", cwd: root, tool_name: "Write", tool_input: { file_path: file },
})
const post = (file: string) => handleGuard({
  hook_event_name: "PostToolUse", cwd: root, tool_name: "Edit", tool_input: { file_path: file },
})

describe("isProtected", () => {
  it("protects task.json", () => expect(isProtected(".junto/tasks/t/task.json")).toBe(true))
  it("protects task.json lock and temporary files", () => {
    expect(isProtected(".junto/tasks/t/task.json.lock")).toBe(true)
    expect(isProtected(".junto/tasks/t/task.json.tmp")).toBe(true)
  })
  it("protects the verdicts directory", () => expect(isProtected(".junto/tasks/t/verdicts/tests.json")).toBe(true))
  it("protects the active file", () => expect(isProtected(".junto/active")).toBe(true))
  it("does not protect plan.md", () => expect(isProtected(".junto/tasks/t/plan.md")).toBe(false))
  it("does not protect config.json", () => expect(isProtected(".junto/config.json")).toBe(false))
  it("does not protect files outside .junto", () => expect(isProtected("src/app.ts")).toBe(false))
})

describe("PreToolUse", () => {
  it("rejects writes to task.json", () => {
    const output = JSON.parse(pre(join(root, ".junto", "tasks", "t", "task.json")))
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny")
    expect(output.hookSpecificOutput.permissionDecisionReason).toMatch(/junto__/)
  })

  it("rejects relative protected paths", () => {
    expect(JSON.parse(pre(".junto/tasks/t/verdicts/tests.json")).hookSpecificOutput.permissionDecision).toBe("deny")
  })

  it("allows ordinary source files", () => expect(pre(join(root, "src", "app.ts"))).toBe(""))
})

describe("PostToolUse", () => {
  it("marks every gate stale after a source-file edit", () => {
    post(join(root, "src", "app.ts"))
    const task = readTask(root, "t")
    expect(task.gates.tests?.stale).toBe(true)
    expect(task.gates.lint?.stale).toBe(true)
  })

  it("does not mark gates stale after a Markdown edit", () => {
    post(join(root, "README.md"))
    expect(readTask(root, "t").gates.tests?.stale).toBe(false)
  })

  it("does not mark gates stale after a .junto edit", () => {
    post(join(root, ".junto", "tasks", "t", "plan.md"))
    expect(readTask(root, "t").gates.tests?.stale).toBe(false)
  })

  it("returns nothing when there is no active task", () => {
    setActiveId(root, null)
    expect(post(join(root, "src", "app.ts"))).toBe("")
  })
})
