import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  canEnter,
  gateStateSchema,
  readActiveId,
  readConfig,
  readTask,
  taskDir,
  writeTask,
  type Config,
  type GateState,
  type Phase,
  type Task,
  type TransitionContext,
} from "@junto/core"
import type { ToolContext } from "../context.js"

/** Read disk facts at the I/O boundary so `canEnter` remains pure. */
export function buildTransitionContext(root: string, task: Task, config: Config): TransitionContext {
  const dir = taskDir(root, task.id)

  const readState = (rel: string | null): GateState | null => {
    if (rel === null) return null
    const path = join(dir, rel)
    if (!existsSync(path)) return null
    try {
      return gateStateSchema.parse(JSON.parse(readFileSync(path, "utf-8")).state)
    } catch {
      return null
    }
  }

  const verdictStates: Record<string, GateState | null> = {}
  for (const [name, status] of Object.entries(task.gates)) {
    verdictStates[name] = readState(status.verdict)
  }

  const brief = join(dir, "brief.md")
  return {
    briefNonEmpty: existsSync(brief) && readFileSync(brief, "utf-8").trim() !== "",
    planExists: existsSync(join(dir, "plan.md")),
    autoApprove: config.autoApprove,
    verdictStates,
  }
}

export async function advanceTool(ctx: ToolContext, input: { to: Phase }): Promise<string> {
  const id = readActiveId(ctx.root)
  if (id === null) throw new Error("No active task. Run /junto:start first.")

  const task = readTask(ctx.root, id)
  const config = readConfig(ctx.root)
  const check = canEnter(task, input.to, buildTransitionContext(ctx.root, task, config))
  if (!check.ok) throw new Error(`Cannot transition to "${input.to}". ${check.reason}`)

  const now = new Date().toISOString()
  const previous = task.phases[task.phase]
  if (previous !== undefined) task.phases[task.phase] = { ...previous, status: "done", at: now }
  task.phases[input.to] = { ...(task.phases[input.to] ?? {}), status: "active", at: now }
  task.phase = input.to
  writeTask(ctx.root, task)

  const nudge = input.to === "panel"
    ? " Run /junto:panel to review the approved plan, then advance to build."
    : input.to === "review"
      ? " Run /junto:panel to review the implementation, then advance to verify."
      : ""

  return `Task "${id}" transitioned to phase ${input.to}.${nudge}`
}
