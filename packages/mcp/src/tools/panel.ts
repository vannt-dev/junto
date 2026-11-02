import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { BUILT_IN_ROLES, readActiveId, taskDir } from "@junto/core"
import { nextSequence, runConsult } from "./consult.js"
import { prepareConsultContext } from "./context.js"
import type { ConsultContextInput } from "./context.js"
import {
  buildPanelDigest, PANEL_ANSWER_FORMAT, panelDigestSummary, panelRoleOutcome, renderPanelDigest,
  type PanelRoleOutcome,
} from "./panel-digest.js"
import type { ToolContext } from "../context.js"

export async function panelTool(
  ctx: ToolContext,
  input: { roles?: string[], question: string, context?: ConsultContextInput },
): Promise<string> {
  const id = readActiveId(ctx.root)
  if (id === null) throw new Error("No active task. Run /junto:start first.")

  const roles = input.roles ?? [...BUILT_IN_ROLES]
  const context = prepareConsultContext(ctx, input.context)
  const sections: string[] = context?.path === undefined ? [] : [`Context: ${context.path}.`]
  const outcomes: PanelRoleOutcome[] = []

  // Sequential, not concurrent: runConsult checks the shared per-task budget by reading
  // task.json, then spends it via updateTask. Running roles in parallel would let two calls
  // both pass the check against the same stale reading before either writes back its spend.
  for (const role of roles) {
    const result = await runConsult(ctx, role, input.question, context, PANEL_ANSWER_FORMAT)
    const outcome = panelRoleOutcome(result)
    outcomes.push(outcome)
    sections.push(
      result.ok
        ? `## ${role} - ${outcome.status}\nSaved to ${result.path}. Tokens used: ${result.tokensUsed}.`
        : `## ${role} - ${outcome.status}\n${result.error}`,
    )
  }

  const digest = buildPanelDigest(outcomes)
  const rendered = renderPanelDigest(digest)
  const digestPath = writeDigest(ctx.root, id, input.question, panelDigestSummary(digest), rendered)

  return `${rendered}\n\nDigest saved to ${digestPath}.\n\n${sections.join("\n\n")}`
}

/** Stored beside the consult files, never in task.json: the digest is advisory and needs no schema change. */
function writeDigest(root: string, id: string, question: string, summary: string, rendered: string): string {
  const panelsDir = join(taskDir(root, id), "panels")
  mkdirSync(panelsDir, { recursive: true })
  const relPath = `panels/${String(nextSequence(panelsDir)).padStart(3, "0")}-digest.md`
  const content = "---\n"
    + `summary: ${summary}\n`
    + `createdAt: ${new Date().toISOString()}\n`
    + "---\n\n"
    + `## Question\n\n${question}\n\n${rendered}\n`
  writeFileSync(join(taskDir(root, id), relPath), content, "utf-8")
  return relPath
}
