import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// The shipped hooks run in every Claude Code session once the plugin is installed. Outside a
// project with a .junto directory each must print nothing and exit 0: no context added, no
// tool call denied, nothing written.
const HOOKS = resolve(import.meta.dirname, "../../plugin/hooks")
const temporaryRoots: string[] = []

afterEach(() => {
  for (const dir of temporaryRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function runShipped(hook: string, input: Record<string, unknown>) {
  return spawnSync(process.execPath, [join(HOOKS, hook)], { input: JSON.stringify(input), encoding: "utf-8" })
}

describe("shipped hooks outside a junto project", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["session.js", { hook_event_name: "SessionStart", source: "startup" }],
    ["state.js", { hook_event_name: "UserPromptSubmit", prompt: "/junto:approve" }],
    ["guard.js", { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: ".junto/active" } }],
    ["guard.js", { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/app.ts" } }],
    ["handoff.js", { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { prompt: "x" } }],
  ]

  it.each(cases)("%s does nothing for %o", (hook, event) => {
    const cwd = mkdtempSync(join(tmpdir(), "junto-outside-"))
    temporaryRoots.push(cwd)
    const result = runShipped(hook, { ...event, cwd })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })
})
