import { BUILT_IN_ROLES, readActiveId } from "@junto/core"
import { runConsult } from "./consult.js"
import type { ToolContext } from "../context.js"

export async function panelTool(ctx: ToolContext, input: { roles?: string[], question: string }): Promise<string> {
  if (readActiveId(ctx.root) === null) throw new Error("No active task. Run /junto:start first.")

  const roles = input.roles ?? [...BUILT_IN_ROLES]
  const sections: string[] = []

  // Sequential, not concurrent: runConsult checks the shared per-task budget by reading
  // task.json, then spends it via updateTask. Running roles in parallel would let two calls
  // both pass the check against the same stale reading before either writes back its spend.
  for (const role of roles) {
    const result = await runConsult(ctx, role, input.question)
    sections.push(
      result.ok
        ? `## ${role} - ok\nSaved to ${result.path}. Tokens used: ${result.tokensUsed}.`
        : `## ${role} - failed\n${result.error}`,
    )
  }

  return sections.join("\n\n")
}
