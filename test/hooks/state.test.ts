import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readActiveId, readTask, setActiveId, taskDir, writeTask, type Task } from "@junto/core"
import { readHookInput } from "../../src-hooks/lib/io.js"
import { contextOutput } from "../../src-hooks/lib/render.js"
import { APPROVE_SENTINEL, handleState, renderStateBlock } from "../../src-hooks/state.js"

let root: string
const temporaryRoots: string[] = []

function activeId(): string {
  const id = readActiveId(root)
  if (id === null) throw new Error("Test requires an active task")
  return id
}

function seed(overrides: Partial<Task> = {}): Task {
  const now = "2026-08-30T09:00:00Z"
  const task: Task = {
    schemaVersion: 1,
    id: "2026-08-30-x",
    title: "X",
    size: "standard",
    phase: "plan",
    baseCommit: null,
    createdAt: now,
    updatedAt: now,
    phases: { plan: { status: "active" } },
    gates: { tests: { required: true, verdict: null, stale: false, failStreak: 0 } },
    decisions: [],
    consults: [],
    consultTokensUsed: 0,
    ...overrides,
  }
  mkdirSync(taskDir(root, task.id), { recursive: true })
  writeTask(root, task)
  setActiveId(root, task.id)
  return task
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-state-"))
  temporaryRoots.push(root)
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates: {} }))
})

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const path = temporaryRoots.pop()
    if (path !== undefined) rmSync(path, { recursive: true, force: true })
  }
})

describe("hook helpers", () => {
  it("reads valid JSON and ignores invalid JSON", () => {
    expect(readHookInput('{"cwd":"x"}')).toEqual({ cwd: "x" })
    expect(readHookInput("{")) .toEqual({})
  })

  it("wraps additionalContext for the correct event", () => {
    expect(JSON.parse(contextOutput("x")).hookSpecificOutput).toEqual({
      hookEventName: "UserPromptSubmit",
      additionalContext: "x",
    })
  })
})

describe("renderStateBlock", () => {
  it("stays compact at under 600 characters", () => expect(renderStateBlock(seed()).length).toBeLessThan(600))

  it("includes the task, phase, and size", () => {
    const output = renderStateBlock(seed())
    expect(output).toMatch(/2026-08-30-x/)
    expect(output).toMatch(/phase="plan"/)
    expect(output).toMatch(/size="standard"/)
  })

  it("marks a stale gate", () => {
    const task = seed()
    const tests = task.gates.tests
    if (tests === undefined) throw new Error("Test requires the tests gate")
    tests.stale = true
    tests.verdict = "verdicts/tests.json"
    expect(renderStateBlock(task)).toMatch(/tests\(stale\)/)
  })
})

describe("handleState - context injection", () => {
  it("injects nothing when there is no active task", () => expect(handleState({ prompt: "hello", cwd: root })).toBe(""))

  it("injects the Junto block when a task is active", () => {
    seed()
    const output = JSON.parse(handleState({ prompt: "hello", cwd: root }))
    expect(output.hookSpecificOutput.additionalContext).toMatch(/<junto/)
  })

  it("returns nothing without failing when .junto is missing", () => {
    const orphan = mkdtempSync(join(tmpdir(), "junto-none-"))
    temporaryRoots.push(orphan)
    expect(handleState({ prompt: "x", cwd: orphan })).toBe("")
  })
})

describe("handleState - approval recording", () => {
  it("sets approvedBy for the raw /junto:approve command", () => {
    seed()
    handleState({ prompt: "/junto:approve", cwd: root })
    expect(readTask(root, activeId()).phases.plan?.approvedBy).toBe("user")
  })

  it("sets approvedBy when the expanded prompt contains the sentinel", () => {
    seed()
    handleState({ prompt: `${APPROVE_SENTINEL}\n\nThe user approved the plan.`, cwd: root })
    expect(readTask(root, activeId()).phases.plan?.approvedBy).toBe("user")
  })

  it("confirms approval in the output", () => {
    seed()
    expect(handleState({ prompt: "/junto:approve", cwd: root })).toMatch(/approved/i)
  })

  it("directs an approved deep task to panel", () => {
    seed({ size: "deep" })
    expect(handleState({ prompt: "/junto:approve", cwd: root })).toMatch(/panel/)
  })

  it("does not approve from an ordinary prompt", () => {
    seed()
    handleState({ prompt: "please approve the plan", cwd: root })
    expect(readTask(root, activeId()).phases.plan?.approvedBy).toBeUndefined()
  })

  it("does not approve when the command name is only mentioned", () => {
    seed()
    handleState({ prompt: "should I run /junto:approve?", cwd: root })
    expect(readTask(root, activeId()).phases.plan?.approvedBy).toBeUndefined()
  })

  it("does not approve when the task is not in the plan phase", () => {
    seed({ phase: "build", phases: { build: { status: "active" } } })
    expect(handleState({ prompt: "/junto:approve", cwd: root })).toMatch(/not in the plan phase/i)
  })
})
