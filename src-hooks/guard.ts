import { isAbsolute, relative, resolve } from "node:path"
import {
  findProjectRoot,
  PROTECTED_GLOBS,
  readActiveId,
  readConfig,
  shouldStale,
  updateTask,
} from "@junto/core"
import { runHook } from "./lib/io.js"

export interface HookInput {
  hook_event_name?: string
  cwd?: string
  tool_name?: string
  tool_input?: { file_path?: string, [key: string]: unknown }
}

function toRegExp(glob: string): RegExp {
  const body = glob
    .split("/")
    .map(segment => segment === "**"
      ? ".*"
      : segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join("/")
  return new RegExp(`^${body}$`)
}

export function isProtected(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "")
  return PROTECTED_GLOBS.some(glob => toRegExp(glob).test(normalized))
}

function deny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  })
}

export function handleGuard(input: HookInput): string {
  const filePath = input.tool_input?.file_path
  if (typeof filePath !== "string" || filePath === "") return ""

  const cwd = input.cwd ?? process.cwd()
  const root = findProjectRoot(cwd)
  if (root === null) return ""

  const absolutePath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
  const rel = relative(root, absolutePath).replace(/\\/g, "/")
  if (rel === ".." || rel.startsWith("../")) return ""

  if (input.hook_event_name === "PreToolUse") {
    if (!isProtected(rel)) return ""
    return deny(
      `junto protects ${rel} as evidence; only MCP tools may write it. `
      + "Use junto__verify to run gates, junto__advance to change phases, junto__task for the "
      + "task lifecycle, and junto__consult/junto__panel for advisory review.",
    )
  }

  if (input.hook_event_name !== "PostToolUse") return ""

  const id = readActiveId(root)
  if (id === null) return ""
  try {
    const config = readConfig(root)
    if (!shouldStale(rel, config.staleIgnore)) return ""
    updateTask(root, id, (task) => {
      let changed = false
      for (const gate of Object.values(task.gates)) {
        if (gate.verdict !== null && !gate.stale) {
          gate.stale = true
          changed = true
        }
      }
      return changed
    })
  } catch {
    // A broken hook must not interrupt the user's work.
  }
  return ""
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/guard.js")) {
  await runHook(input => handleGuard(input as HookInput))
}
