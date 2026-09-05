import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { setActiveId, taskDir, writeTask, type Task } from "@junto/core"
import { handleSession } from "../../src-hooks/session.js"

let root: string
const temporaryRoots: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-session-"))
  temporaryRoots.push(root)
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates: {} }))
  const now = "2026-08-30T09:00:00Z"
  const task: Task = {
    schemaVersion: 1,
    id: "t",
    title: "Add JWT",
    size: "standard",
    phase: "build",
    baseCommit: null,
    createdAt: now,
    updatedAt: now,
    phases: { plan: { status: "done", approvedBy: "user" }, build: { status: "active" } },
    gates: {},
    decisions: [{ at: now, what: "Use jose", why: "Native ESM" }],
    consults: [],
  }
  mkdirSync(taskDir(root, "t"), { recursive: true })
  writeTask(root, task)
  setActiveId(root, "t")
  writeFileSync(join(taskDir(root, "t"), "brief.md"), "The API needs JWT support.", "utf-8")
  writeFileSync(join(taskDir(root, "t"), "plan.md"), "1. Install jose\n2. Add middleware", "utf-8")
})

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const path = temporaryRoots.pop()
    if (path !== undefined) rmSync(path, { recursive: true, force: true })
  }
})

describe("handleSession", () => {
  it("injects both the brief and plan", () => {
    const output = handleSession({ source: "startup", cwd: root })
    expect(output).toMatch(/API needs JWT support/)
    expect(output).toMatch(/Install jose/)
  })

  it("injects context after compaction", () => expect(handleSession({ source: "compact", cwd: root })).toMatch(/API needs JWT support/))
  it("includes recorded decisions", () => expect(handleSession({ source: "resume", cwd: root })).toMatch(/Use jose/))

  it("returns nothing when there is no active task", () => {
    setActiveId(root, null)
    expect(handleSession({ source: "startup", cwd: root })).toBe("")
  })

  it("returns nothing when .junto is missing", () => {
    const orphan = mkdtempSync(join(tmpdir(), "junto-none-"))
    temporaryRoots.push(orphan)
    expect(handleSession({ source: "startup", cwd: orphan })).toBe("")
  })
})
