import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { setActiveId, taskDir, writeTask, type Task } from "@junto/core"
import { handleHandoff } from "../../src-hooks/handoff.js"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-handoff-"))
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates: {} }))
  const now = "2026-08-30T09:00:00Z"
  const task: Task = {
    schemaVersion: 1, id: "t", title: "T", size: "small", phase: "build",
    baseCommit: null, createdAt: now, updatedAt: now,
    phases: { build: { status: "active" } }, gates: {}, decisions: [], consults: [],
    consultTokensUsed: 0,
  }
  mkdirSync(taskDir(root, "t"), { recursive: true })
  writeTask(root, task)
  setActiveId(root, "t")
  writeFileSync(join(taskDir(root, "t"), "context.jsonl"), [
    JSON.stringify({ _example: "seed row" }),
    JSON.stringify({ file: "src/auth.ts", reason: "middleware location" }),
    "",
  ].join("\n"), "utf-8")
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const call = (tool: string) => handleHandoff({ cwd: root, tool_name: tool, tool_input: {} })

describe("handleHandoff", () => {
  it("injects the spec for the Task tool", () => {
    const output = JSON.parse(call("Task"))
    expect(output.hookSpecificOutput.additionalContext).toMatch(/src\/auth\.ts/)
    expect(output.hookSpecificOutput.additionalContext).toMatch(/middleware location/)
  })

  it("injects the spec for the current Agent tool name", () => {
    expect(JSON.parse(call("Agent")).hookSpecificOutput.additionalContext).toMatch(/src\/auth\.ts/)
  })

  it("ignores sample lines containing the _example key", () => {
    expect(JSON.parse(call("Task")).hookSpecificOutput.additionalContext).not.toMatch(/seed row/)
  })

  it("ignores unrelated tools", () => expect(call("Bash")).toBe(""))

  it("injects nothing when context.jsonl is empty", () => {
    writeFileSync(join(taskDir(root, "t"), "context.jsonl"), "", "utf-8")
    expect(call("Task")).toBe("")
  })
})
