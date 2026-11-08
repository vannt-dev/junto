import type { ToolContext } from "../context.js"
import { statusBoard } from "./status-board.js"
import { summarizeActiveTask } from "./task-summary.js"

export interface StatusInput {
  /** Show the active task of every worktree of this repository. */
  all?: boolean
  /** Also write `.junto/board.html` for every worktree; implies `all`. */
  html?: boolean
}

/** Render a read-only summary; only `html` writes, and only the generated `.junto/board.html`. */
export async function statusTool(ctx: ToolContext, input: StatusInput = {}): Promise<string> {
  if (input.all || input.html) return statusBoard(ctx, input.html === true)

  const summary = await summarizeActiveTask(ctx.root)
  if (summary === null) return "No active task. Run /junto:start to create one."
  const { task } = summary
  const gates = summary.gates.map(gate => `- ${gate.name}: ${gate.required ? "required" : "optional"}, ${gate.state}`)

  return `# Junto status\n\n`
    + `Task: ${task.id} — ${task.title}\n`
    + `Size: ${summary.size}\n`
    + `Phase: ${task.phase}\n`
    + `Next: ${summary.next}\n`
    + `Next phase: ${summary.nextPhase ?? "none"}\n`
    + `Blockers: ${summary.blocker}\n`
    + (summary.baseWarning === null ? "" : `Warning: ${summary.baseWarning}\n`)
    + `Consult budget: ${summary.budget}\n`
    + (summary.panel === null ? "" : `Last panel: ${summary.panel}\n`)
    + "\n"
    + `## Gates\n\n${gates.join("\n") || "(none)"}`
}
