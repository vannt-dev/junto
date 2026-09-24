import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  canEnter,
  captureReviewFingerprint,
  captureSourceFingerprint,
  gateStateSchema,
  readActiveId,
  readConfig,
  readTask,
  taskDir,
  updateTask,
  type Config,
  type GateState,
  type Phase,
  type Task,
  type TransitionContext,
} from "@junto/core"
import type { ToolContext } from "../context.js"
import { persistTaskPolicy, resolveTaskPolicy } from "./policy.js"

/** Read disk facts at the I/O boundary so `canEnter` remains pure. */
export function buildTransitionContext(root: string, task: Task, config: Config): TransitionContext {
  const dir = taskDir(root, task.id)

  let fingerprint: string | undefined
  const readState = (name: string, rel: string | null): GateState | null => {
    if (rel === null) return null
    const path = join(dir, rel)
    if (!existsSync(path)) return null
    try {
      const verdict = JSON.parse(readFileSync(path, "utf-8"))
      if (config.gates[name]?.type === "review" || verdict.reviewFingerprint !== undefined) {
        fingerprint ??= captureReviewFingerprint(root, task, config)
        if (verdict.reviewFingerprint !== fingerprint) {
          const gate = task.gates[name]
          if (gate) gate.stale = true
          return null
        }
      }
      if (verdict.sourceFingerprint !== undefined) {
        // Catches edits the hooks cannot see; an unsupported or changed fingerprint fails closed.
        const spec = config.gates[name]
        if (spec === undefined || captureSourceFingerprint(root, config, spec) !== verdict.sourceFingerprint) {
          const gate = task.gates[name]
          if (gate) gate.stale = true
          return null
        }
      }
      return gateStateSchema.parse(verdict.state)
    } catch {
      if (config.gates[name]?.type === "review") {
        const gate = task.gates[name]
        if (gate) gate.stale = true
      }
      return null
    }
  }

  const verdictStates: Record<string, GateState | null> = {}
  for (const [name, status] of Object.entries(task.gates)) {
    verdictStates[name] = readState(name, status.verdict)
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

  const config = readConfig(ctx.root)
  const stored = readTask(ctx.root, id)
  const { task, unknownGates } = await resolveTaskPolicy(ctx.root, stored, config)
  // Persist new obligations even when blocked so the user approval hook sees them.
  persistTaskPolicy(ctx.root, stored, task)
  const check = canEnter(task, input.to, { ...buildTransitionContext(ctx.root, task, config), unknownRuleGates: unknownGates })
  if (!check.ok) throw new Error(`Cannot transition to "${input.to}". ${check.reason}`)

  // Apply only the transition to the latest task so concurrent hook updates (staleness,
  // approval) survive, and refuse if the task moved or a gate was invalidated after the check.
  const now = new Date().toISOString()
  updateTask(ctx.root, id, current => {
    const invalidated = Object.entries(current.gates).some(([name, gate]) => gate.required
      && (gate.stale || (gate.invalidationVersion ?? 0) !== (task.gates[name]?.invalidationVersion ?? 0)))
    if (current.phase !== task.phase || (input.to === "done" && invalidated)) {
      throw new Error(`Cannot transition to "${input.to}". The task changed during the transition; retry.`)
    }
    const previous = current.phases[current.phase]
    if (previous !== undefined) current.phases[current.phase] = { ...previous, status: "done", at: now }
    current.phases[input.to] = { ...(current.phases[input.to] ?? {}), status: "active", at: now }
    current.phase = input.to
  })

  const nudge = input.to === "panel"
    ? " Run /junto:panel to review the approved plan, then advance to build."
    : input.to === "review"
      ? " Run /junto:panel to review the implementation, then advance to verify."
      : ""

  return `Task "${id}" transitioned to phase ${input.to}.${nudge}`
}
