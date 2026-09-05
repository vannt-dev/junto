import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { findProjectRoot, readActiveId, readConfig, readTask, setActiveId, updateTask, writeTask } from "../src/store.js"
import type { Config, Task } from "../src/schema.js"

let root: string
const tmpDirs: string[] = []

/** Tracked mkdtemp helper so afterEach removes directories created by individual tests. */
function mktemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

const task: Task = {
  schemaVersion: 1,
  id: "2026-08-30-x",
  title: "X",
  size: "small",
  phase: "build",
  baseCommit: null,
  createdAt: "2026-08-30T09:00:00Z",
  updatedAt: "2026-08-30T09:00:00Z",
  phases: { build: { status: "active" } },
  gates: {},
  decisions: [],
  consults: [],
}

beforeEach(() => {
  root = mktemp("junto-")
  mkdirSync(join(root, ".junto", "tasks", "2026-08-30-x"), { recursive: true })
})

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("findProjectRoot", () => {
  it("finds the root from a deeply nested directory", () => {
    const deep = join(root, "a", "b", "c")
    mkdirSync(deep, { recursive: true })
    expect(findProjectRoot(deep)).toBe(root)
  })

  it("returns null when no .junto directory exists", () => {
    const orphan = mktemp("junto-none-")
    expect(findProjectRoot(orphan)).toBeNull()
  })

  it("does not treat a file named .junto as a project root", () => {
    const orphan = mktemp("junto-file-")
    writeFileSync(join(orphan, ".junto"), "not a directory", "utf-8")
    expect(findProjectRoot(orphan)).toBeNull()
  })
})

describe("task round-trip", () => {
  it("writes and reads a task round trip", () => {
    writeTask(root, task)
    expect(readTask(root, task.id).title).toBe("X")
  })

  it("updates updatedAt on every write", () => {
    writeTask(root, task)
    const after = readTask(root, task.id)
    expect(after.updatedAt).not.toBe(task.updatedAt)
  })

  it("does not leave a temporary file after writing", () => {
    writeTask(root, task)
    expect(existsSync(join(root, ".junto", "tasks", task.id, "task.json.tmp"))).toBe(false)
  })

  it("preserves the old file when new content is invalid", () => {
    writeTask(root, task)
    const bad = { ...task, size: "huge" } as unknown as Task
    expect(() => writeTask(root, bad)).toThrow()
    expect(readTask(root, task.id).size).toBe("small")
  })

  it("overwrites content across two consecutive valid writes", () => {
    writeTask(root, task)
    writeTask(root, { ...task, title: "Y" })
    expect(readTask(root, task.id).title).toBe("Y")
  })

  it("updateTask reads, modifies, writes, and releases its lock", () => {
    writeTask(root, task)
    updateTask(root, task.id, current => { current.title = "Locked" })
    expect(readTask(root, task.id).title).toBe("Locked")
    expect(existsSync(join(root, ".junto", "tasks", task.id, "task.json.lock"))).toBe(false)
  })

  it("updateTask releases its lock when the updater throws", () => {
    writeTask(root, task)
    expect(() => updateTask(root, task.id, () => { throw new Error("stop") })).toThrow(/stop/)
    expect(existsSync(join(root, ".junto", "tasks", task.id, "task.json.lock"))).toBe(false)
  })
})

describe("active", () => {
  it("returns null when the active file is missing", () => {
    expect(readActiveId(root)).toBeNull()
  })

  it("writes and reads the active task ID", () => {
    setActiveId(root, "2026-08-30-x")
    expect(readActiveId(root)).toBe("2026-08-30-x")
  })

  it("removes the active task ID with null", () => {
    setActiveId(root, "2026-08-30-x")
    setActiveId(root, null)
    expect(readActiveId(root)).toBeNull()
  })

  it("ignores surrounding whitespace in the file", () => {
    writeFileSync(join(root, ".junto", "active"), "  2026-08-30-x \n")
    expect(readActiveId(root)).toBe("2026-08-30-x")
  })
})

describe("readConfig", () => {
  it("reads valid config.json and preserves unknown fields", () => {
    const raw = {
      schemaVersion: 1,
      gates: { lint: { argv: ["pnpm", "lint"], required: true } },
      staleIgnore: ["**/*.md"],
      autoApprove: ["small"],
      futureField: "an unknown M2 field that must survive parseConfig",
    }
    writeFileSync(join(root, ".junto", "config.json"), JSON.stringify(raw))

    const config = readConfig(root)

    expect(config.gates.lint?.argv).toEqual(["pnpm", "lint"])
    expect(config.staleIgnore).toEqual(["**/*.md"])
    expect((config as Config & { futureField?: string }).futureField).toBe(
      "an unknown M2 field that must survive parseConfig",
    )
  })

  it("reports clear guidance when config.json is missing", () => {
    expect(() => readConfig(root)).toThrow(/junto:start.*quality gate/i)
  })
})
