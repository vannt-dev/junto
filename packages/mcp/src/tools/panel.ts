import { BUILT_IN_ROLES, readActiveId } from "@junto/core"
import { runConsult } from "./consult.js"
import { prepareConsultContext } from "./context.js"
import type { ConsultContextInput } from "./context.js"
import type { ToolContext } from "../context.js"

export async function panelTool(
  ctx: ToolContext,
  input: { roles?: string[], question: string, context?: ConsultContextInput },
): Promise<string> {
  if (readActiveId(ctx.root) === null) throw new Error("No active task. Run /junto:start first.")

  const roles = input.roles ?? [...BUILT_IN_ROLES]
  const context = prepareConsultContext(ctx, input.context)
  const sections: string[] = context?.path === undefined ? [] : [`Context: ${context.path}.`]

  // Sequential, not concurrent: runConsult checks the shared per-task budget by reading
  // task.json, then spends it via updateTask. Running roles in parallel would let two calls
  // both pass the check against the same stale reading before either writes back its spend.
  for (const role of roles) {
    const result = await runConsult(ctx, role, input.question, context)
    const label = result.ok ? "ok" : result.error?.includes("budget exhausted") ? "skipped" : "failed"
    sections.push(
      result.ok
        ? `## ${role} - ${label}\nSaved to ${result.path}. Tokens used: ${result.tokensUsed}.`
        : `## ${role} - ${label}\n${result.error}`,
    )
  }

  return sections.join("\n\n")
}
