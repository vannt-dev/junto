import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readActiveId, readConfig, readTask, resolveBackend, resolveRoleProvider, resolveRolePrompt, taskDir, updateTask } from "@junto/core"
import type { ToolContext } from "../context.js"

export interface ConsultResult {
  role: string
  ok: boolean
  path?: string
  tokensUsed?: number
  consultTokensUsedTotal?: number
  error?: string
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : ""
}

/** `NNN` is a per-task monotonic sequence shared by every role's consult file. */
function nextSequence(consultsDir: string): number {
  if (!existsSync(consultsDir)) return 1
  const numbers = readdirSync(consultsDir)
    .map(name => /^(\d+)-/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
  return (numbers.length === 0 ? 0 : Math.max(...numbers)) + 1
}

/**
 * Shared by junto__consult and junto__panel. Never throws: a panel with several roles must let
 * one role's failure show up next to the others' successes rather than aborting the whole call.
 */
export async function runConsult(ctx: ToolContext, role: string, question: string): Promise<ConsultResult> {
  try {
    const id = readActiveId(ctx.root)
    if (id === null) throw new Error("No active task. Run /junto:start first.")

    const config = readConfig(ctx.root)
    const task = readTask(ctx.root, id)
    const cap = config.consultBudget?.maxTokensPerTask
    if (cap !== undefined && task.consultTokensUsed >= cap) {
      throw new Error(
        `Consult budget exhausted for this task: ${task.consultTokensUsed}/${cap} tokens used. `
        + "Raise consultBudget.maxTokensPerTask in .junto/config.json to continue.",
      )
    }

    const prompt = resolveRolePrompt(ctx.root, role)
    const provider = resolveRoleProvider(role, config)
    const { backend, model, timeoutMs } = resolveBackend(provider, config)

    const dir = taskDir(ctx.root, id)
    const brief = readIfExists(join(dir, "brief.md"))
    const plan = readIfExists(join(dir, "plan.md"))
    const userPrompt = `## Brief\n\n${brief}\n\n## Plan\n\n${plan}\n\n## Question\n\n${question}`

    const result = await backend.complete({ systemPrompt: prompt, userPrompt, model, timeoutMs })

    const consultsDir = join(dir, "consults")
    mkdirSync(consultsDir, { recursive: true })
    const seq = String(nextSequence(consultsDir)).padStart(3, "0")
    const relPath = `consults/${seq}-${role}.md`
    const content = "---\n"
      + `role: ${role}\n`
      + `provider: ${provider}\n`
      + `model: ${result.model}\n`
      + `tokensUsed: ${result.tokensUsed}\n`
      + `createdAt: ${new Date().toISOString()}\n`
      + "---\n\n"
      + `## Question\n\n${question}\n\n## Response\n\n${result.text}\n`
    writeFileSync(join(dir, relPath), content, "utf-8")

    const updated = updateTask(ctx.root, id, (t) => {
      t.consultTokensUsed += result.tokensUsed
      t.consults.push(relPath)
    })

    return {
      role,
      ok: true,
      path: relPath,
      tokensUsed: result.tokensUsed,
      consultTokensUsedTotal: updated.consultTokensUsed,
    }
  } catch (error) {
    return { role, ok: false, error: (error as Error).message }
  }
}

export async function consultTool(ctx: ToolContext, input: { role: string, question: string }): Promise<string> {
  const result = await runConsult(ctx, input.role, input.question)
  if (!result.ok) throw new Error(result.error)
  return `Consulted "${result.role}": saved to ${result.path}. `
    + `Tokens used: ${result.tokensUsed} (task total: ${result.consultTokensUsedTotal}).`
}
