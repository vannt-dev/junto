import { existsSync, realpathSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { exportBoard, gitTopLevel, juntoDir, listWorktrees, type BoardEntry } from "@junto/core"
import type { ToolContext } from "../context.js"
import { summarizeActiveTask } from "./task-summary.js"

// Native resolution expands Windows 8.3 aliases, so the same directory compares equal.
function canonical(path: string): string {
  try { return realpathSync.native(path) } catch { return resolve(path) }
}

/**
 * Read every worktree's own `.junto/` without writing to it: each lane is its own checkout with its
 * own active task, and junto writes only inside the current project's `.junto/`.
 */
async function collectEntries(ctx: ToolContext): Promise<BoardEntry[]> {
  const here = canonical(ctx.root)
  const top = await gitTopLevel(ctx.root)
  // `.junto/` may sit below the Git top level; look at the same offset in every worktree.
  const offset = top === null ? "" : relative(canonical(top), here)
  const entries: BoardEntry[] = []
  for (const worktree of await listWorktrees(ctx.root)) {
    const root = join(worktree.path, offset)
    const entry: BoardEntry = { path: resolve(worktree.path), branch: worktree.branch, current: canonical(root) === here, task: null }
    try {
      // A deleted worktree stays listed until `git worktree prune`; do not report it as idle.
      if (!existsSync(worktree.path)) throw new Error("the worktree directory is missing; run git worktree prune")
      const summary = existsSync(juntoDir(root)) ? await summarizeActiveTask(root) : null
      if (summary !== null) {
        entry.task = {
          id: summary.task.id,
          title: summary.task.title,
          size: summary.size,
          phase: summary.task.phase,
          next: summary.next,
          blockers: summary.blocker,
          gates: summary.gates,
          baseWarning: summary.baseWarning,
        }
      }
    } catch (error) {
      entry.error = (error as Error).message
    }
    entries.push(entry)
  }
  return entries
}

function renderEntry(entry: BoardEntry): string {
  const heading = `## ${entry.branch ?? "(detached HEAD)"}${entry.current ? " (this worktree)" : ""}\n\nPath: ${entry.path}\n`
  if (entry.error !== undefined) return `${heading}Error: cannot read this worktree's task: ${entry.error}`
  const { task } = entry
  if (task === null) return `${heading}No active task.`
  const gates = task.gates.map(gate => `${gate.name} ${gate.state}${gate.required ? "" : " (optional)"}`).join(", ")
  return `${heading}Task: ${task.id} — ${task.title}\n`
    + `Size: ${task.size}\n`
    + `Phase: ${task.phase}\n`
    + `Next: ${task.next}\n`
    + `Blockers: ${task.blockers}\n`
    + `Gates: ${gates || "(none)"}`
    + (task.baseWarning === null ? "" : `\nWarning: ${task.baseWarning}`)
}

/** Status of every worktree of the repository; `html` also writes `.junto/board.html` here. */
export async function statusBoard(ctx: ToolContext, html: boolean): Promise<string> {
  const entries = await collectEntries(ctx)
  const board = html ? `\n\nBoard: ${exportBoard(ctx.root, entries)}` : ""
  return `# Junto status: all worktrees\n\n${entries.map(renderEntry).join("\n\n")}${board}`
}
