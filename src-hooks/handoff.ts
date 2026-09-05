import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { findProjectRoot, readActiveId, taskDir } from "@junto/core"
import { runHook } from "./lib/io.js"

interface Row { file?: string, reason?: string, _example?: unknown }

export function handleHandoff(input: {
  cwd?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
}): string {
  // Claude Code >= 2.1.63 calls this tool Agent; Task remains an alias on older versions.
  if (input.tool_name !== "Agent" && input.tool_name !== "Task") return ""

  const root = findProjectRoot(input.cwd ?? process.cwd())
  if (root === null) return ""
  const id = readActiveId(root)
  if (id === null) return ""

  const path = join(taskDir(root, id), "context.jsonl")
  if (!existsSync(path)) return ""

  const rows: Row[] = readFileSync(path, "utf-8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "")
    .map((line) => {
      try { return JSON.parse(line) as Row } catch { return {} }
    })
    .filter(row => row._example === undefined && typeof row.file === "string")

  if (rows.length === 0) return ""
  const lines = rows.map(row => `- ${row.file}${row.reason ? ` - ${row.reason}` : ""}`).join("\n")
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `<junto-spec task="${id}">\nFiles relevant to the active task:\n${lines}\n</junto-spec>`,
    },
  })
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/handoff.js")) {
  await runHook(input => handleHandoff(input as Parameters<typeof handleHandoff>[0]))
}
