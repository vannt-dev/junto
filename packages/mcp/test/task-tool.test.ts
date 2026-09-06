import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readActiveId, readTask, writeTask } from "@junto/core"
import { newTaskId, taskTool } from "../src/tools/task.js"

let root: string
const ctx = () => ({ root, runner: "test@0" })

function activeId(): string {
  const id = readActiveId(root)
  if (id === null) throw new Error("Test requires an active task")
  return id
}

function markActiveDone(): string {
  const id = activeId()
  const task = readTask(root, id)
  const previous = task.phases[task.phase]
  if (previous !== undefined) task.phases[task.phase] = { ...previous, status: "done" }
  task.phase = "done"
  task.phases.done = { status: "active" }
  writeTask(root, task)
  return id
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-task-"))
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(
    join(root, ".junto", "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      gates: {
        tests: { argv: ["node", "-e", "process.exit(0)"], required: true },
        lint: { argv: ["node", "-e", "process.exit(0)"], required: false },
      },
    }),
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("newTaskId", () => {
  it("combines the date with a slug", () => {
    expect(newTaskId("Add JWT to API", new Date("2026-08-30T09:00:00Z"))).toBe("2026-08-30-add-jwt-to-api")
  })

  it("truncates an overly long slug", () => {
    const id = newTaskId("a".repeat(200), new Date("2026-08-30T09:00:00Z"))
    expect(id.length).toBeLessThanOrEqual(51)
  })

  it("does not leave separators at either end", () => {
    expect(newTaskId("!!! hello world !!!", new Date("2026-08-30T09:00:00Z"))).toBe("2026-08-30-hello-world")
  })

  it("falls back to the 'task' slug for an empty title", () => {
    expect(newTaskId("", new Date("2026-08-30T09:00:00Z"))).toBe("2026-08-30-task")
  })

  it("falls back to the 'task' slug for punctuation-only titles", () => {
    expect(newTaskId("!!!???...", new Date("2026-08-30T09:00:00Z"))).toBe("2026-08-30-task")
  })

  it("falls back to the 'task' slug for emoji-only titles", () => {
    expect(newTaskId("🎉🎉🎉", new Date("2026-08-30T09:00:00Z"))).toBe("2026-08-30-task")
  })
})

describe("action: start", () => {
  it("creates a task and makes it active", async () => {
    await taskTool(ctx(), { action: "start", title: "Add JWT", size: "standard" })
    const id = readActiveId(root)
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-add-jwt$/)
    expect(readTask(root, id!).size).toBe("standard")
  })

  it("starts a standard task in the brief phase", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    expect(readTask(root, readActiveId(root)!).phase).toBe("brief")
  })

  it("starts a small task directly in the build phase", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    expect(readTask(root, readActiveId(root)!).phase).toBe("build")
  })

  it("loads gates and required flags from config", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const t = readTask(root, readActiveId(root)!)
    expect(t.gates.tests?.required).toBe(true)
    expect(t.gates.lint?.required).toBe(false)
    expect(t.gates.tests?.verdict).toBeNull()
    expect(t.gates.tests?.failStreak).toBe(0)
  })

  it("creates the task directory with an empty brief.md", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    const id = readActiveId(root)!
    expect(existsSync(join(root, ".junto", "tasks", id, "brief.md"))).toBe(true)
  })

  it("rejects start when a task is already active", async () => {
    await taskTool(ctx(), { action: "start", title: "A", size: "small" })
    await expect(taskTool(ctx(), { action: "start", title: "B", size: "small" }))
      .rejects.toThrow(/task is already active/i)
  })

  it("rejects start when an orphaned task directory already exists", async () => {
    const id = newTaskId("Duplicate date", new Date())
    mkdirSync(join(root, ".junto", "tasks", id), { recursive: true })
    await expect(taskTool(ctx(), { action: "start", title: "Duplicate date", size: "small" }))
      .rejects.toThrow(/already exists/i)
  })

  it("rejects start when the target archive already exists", async () => {
    await taskTool(ctx(), { action: "start", title: "Duplicate", size: "small" })
    markActiveDone()
    await taskTool(ctx(), { action: "finish" })
    await expect(taskTool(ctx(), { action: "start", title: "Duplicate", size: "small" }))
      .rejects.toThrow(/already exists.*archive/i)
  })
})

describe("action: finish", () => {
  it("rejects archiving an unfinished task", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    await expect(taskTool(ctx(), { action: "finish" })).rejects.toThrow(/not in the done phase.*junto:verify/i)
    expect(readActiveId(root)).not.toBeNull()
  })

  it("moves the task to the archive and clears active", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = markActiveDone()
    await taskTool(ctx(), { action: "finish" })
    expect(readActiveId(root)).toBeNull()
    expect(existsSync(join(root, ".junto", "archive", id, "task.json"))).toBe(true)
    expect(existsSync(join(root, ".junto", "tasks", id))).toBe(false)
  })

  it("writes summary.md to the archive", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = markActiveDone()
    await taskTool(ctx(), { action: "finish" })
    expect(existsSync(join(root, ".junto", "archive", id, "summary.md"))).toBe(true)
  })

  it("reports a clear error when there is no active task", async () => {
    await expect(taskTool(ctx(), { action: "finish" })).rejects.toThrow(/no active task/i)
  })

  it("rejects finish when the target archive appears during the task", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = markActiveDone()
    mkdirSync(join(root, ".junto", "archive", id), { recursive: true })
    await expect(taskTool(ctx(), { action: "finish" })).rejects.toThrow(/already exists.*archive/i)
  })
})

describe("action: switch", () => {
  it("rejects switching to a task that does not exist", async () => {
    await taskTool(ctx(), { action: "start", title: "A", size: "small" })
    const first = markActiveDone()
    await taskTool(ctx(), { action: "finish" })
    await taskTool(ctx(), { action: "start", title: "B", size: "small" })
    await expect(taskTool(ctx(), { action: "switch", id: first })).rejects.toThrow(/not found/i)
  })

  it("switches active to a task that exists on disk", async () => {
    await taskTool(ctx(), { action: "start", title: "A", size: "small" })
    const secondId = "2026-08-30-b-thu-cong"
    mkdirSync(join(root, ".junto", "tasks", secondId), { recursive: true })
    writeFileSync(
      join(root, ".junto", "tasks", secondId, "task.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: secondId,
        title: "B",
        size: "small",
        phase: "build",
        baseCommit: null,
        createdAt: "2026-08-30T09:00:00Z",
        updatedAt: "2026-08-30T09:00:00Z",
        phases: { build: { status: "active" } },
        gates: {},
        decisions: [],
        consults: [],
        consultTokensUsed: 0,
      }),
      "utf-8",
    )
    await taskTool(ctx(), { action: "switch", id: secondId })
    expect(readActiveId(root)).toBe(secondId)
  })

  it("rejects an invalid task ID containing path traversal", async () => {
    await expect(taskTool(ctx(), { action: "switch", id: "../../../secrets" }))
      .rejects.toThrow(/invalid/i)
  })
})
