import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readTask, setActiveId, taskDir, updateTask, writeTask, type Task } from "@junto/core"
import { handleStop } from "../../src-hooks/stop.js"

let root: string
const temporaryRoots: string[] = []
const ID = "2026-11-24-x"

function seed(overrides: Partial<Task> = {}): Task {
  const now = "2026-11-24T09:00:00Z"
  const task: Task = {
    schemaVersion: 1,
    id: ID,
    title: "X",
    size: "standard",
    phase: "build",
    baseCommit: null,
    createdAt: now,
    updatedAt: now,
    phases: { plan: { status: "done", approvedBy: "user" }, build: { status: "active" } },
    gates: { tests: { required: true, verdict: null, stale: false, failStreak: 0 } },
    decisions: [],
    consults: [],
    consultTokensUsed: 0,
    ...overrides,
  }
  mkdirSync(join(taskDir(root, task.id), "verdicts"), { recursive: true })
  writeFileSync(join(taskDir(root, task.id), "plan.md"), "# Plan\n")
  writeTask(root, task)
  setActiveId(root, task.id)
  return task
}

function config(extra: Record<string, unknown> = {}): void {
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({
    schemaVersion: 1,
    gates: { tests: { argv: ["node", "-e", "0"], required: true } },
    ...extra,
  }))
}

function verdict(state: "pass" | "fail", startedAt: string): void {
  writeFileSync(join(taskDir(root, ID), "verdicts", "tests.json"), JSON.stringify({ schemaVersion: 1, gate: "tests", state, startedAt }))
  updateTask(root, ID, (task) => {
    const gate = task.gates.tests
    if (gate) { gate.verdict = "verdicts/tests.json"; gate.stale = false; gate.failStreak = state === "fail" ? 1 : 0 }
  })
}

function stop(extra: Record<string, unknown> = {}): string {
  return handleStop({ hook_event_name: "Stop", cwd: root, stop_hook_active: false, ...extra })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-stop-"))
  temporaryRoots.push(root)
  mkdirSync(join(root, ".junto"), { recursive: true })
  config()
})

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const path = temporaryRoots.pop()
    if (path !== undefined) rmSync(path, { recursive: true, force: true })
  }
})

describe("handleStop", () => {
  it("does nothing without an active task", () => {
    expect(stop()).toBe("")
  })

  it("blocks with a reason naming the gate and the next command", () => {
    seed()
    const output = JSON.parse(stop())
    expect(output.decision).toBe("block")
    expect(output.reason).toMatch(/tests \(not run\)/)
    expect(output.reason).toMatch(/\/junto:verify/)
    expect(readTask(root, ID).stopGate).toMatchObject({ phase: "build", blocks: 1 })
  })

  it("lets Claude stop once the required gates pass", () => {
    seed({ phase: "verify" })
    verdict("pass", "2026-11-24T10:00:00Z")
    expect(stop()).toBe("")
  })

  it("does nothing while the plan waits for the user's approval", () => {
    seed({ phase: "plan", phases: { plan: { status: "active" } } })
    expect(stop()).toBe("")
    seed({ ruleApprovalRequired: true, phases: { build: { status: "active" } } })
    expect(stop()).toBe("")
  })

  it("does nothing after the user asked to abandon", () => {
    seed({ abandonRequest: { by: "user", at: "2026-11-24T10:00:00Z" } })
    expect(stop()).toBe("")
  })

  it("does nothing in the done phase", () => {
    seed({ phase: "done" })
    expect(stop()).toBe("")
  })

  it("does nothing when the project turns it off", () => {
    config({ stopGate: { enabled: false } })
    seed()
    expect(stop()).toBe("")
  })

  it("does nothing while background tasks run", () => {
    seed()
    expect(stop({ background_tasks: [{ id: "b1", type: "shell", status: "running" }] })).toBe("")
  })

  it("lets Claude stop when nothing changed since the last block, and records it", () => {
    seed()
    expect(JSON.parse(stop()).decision).toBe("block")
    const output = JSON.parse(stop({ stop_hook_active: true }))
    expect(output.decision).toBeUndefined()
    expect(output.systemMessage).toMatch(/tests \(not run\)/)
    const task = readTask(root, ID)
    expect(task.stopGate?.released).toBe("stall")
    expect(task.decisions.at(-1)?.what).toMatch(/Stop gate/)
    expect(stop({ stop_hook_active: true })).toBe("")
    expect(readTask(root, ID).decisions).toHaveLength(1)
  })

  it("blocks again after a new gate run, up to the cap, then allows", () => {
    config({ stopGate: { maxBlocks: 2 } })
    seed({ phase: "verify" })
    expect(JSON.parse(stop()).decision).toBe("block")
    verdict("fail", "2026-11-24T10:00:00Z")
    expect(JSON.parse(stop({ stop_hook_active: true })).decision).toBe("block")
    verdict("fail", "2026-11-24T10:05:00Z")
    const output = JSON.parse(stop({ stop_hook_active: true }))
    expect(output.decision).toBeUndefined()
    expect(output.systemMessage).toMatch(/2/)
    expect(readTask(root, ID).stopGate?.released).toBe("cap")
  })

  it("allows when the task file cannot be read", () => {
    seed()
    writeFileSync(join(taskDir(root, ID), "task.json"), "{")
    expect(stop()).toBe("")
  })
})
