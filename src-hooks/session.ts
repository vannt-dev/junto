import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { findProjectRoot, readActiveId, readTask, taskDir } from "@junto/core"
import { runHook } from "./lib/io.js"

const MAX_DOC_CHARS = 4000

function readDoc(dir: string, name: string): string {
  const path = join(dir, name)
  if (!existsSync(path)) return ""
  return readFileSync(path, "utf-8").trim().slice(0, MAX_DOC_CHARS)
}

export function handleSession(input: { source?: string, cwd?: string }): string {
  const root = findProjectRoot(input.cwd ?? process.cwd())
  if (root === null) return ""

  const id = readActiveId(root)
  if (id === null) return ""

  try {
    const task = readTask(root, id)
    const dir = taskDir(root, id)
    const brief = readDoc(dir, "brief.md")
    const plan = readDoc(dir, "plan.md")
    const decisions = task.decisions.map(decision => `- ${decision.what} - ${decision.why}`).join("\n")
    return [
      `<junto-session task="${task.id}" phase="${task.phase}" size="${task.size}">`,
      `# ${task.title}`,
      brief ? `## Requirements\n${brief}` : "",
      plan ? `## Plan\n${plan}` : "",
      decisions ? `## Recorded decisions\n${decisions}` : "",
      "</junto-session>",
    ].filter(Boolean).join("\n\n")
  } catch {
    return ""
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/session.js")) {
  await runHook(input => handleSession(input as { source?: string, cwd?: string }))
}
