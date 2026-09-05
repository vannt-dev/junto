import type { GateState, Phase, Size, Task } from "./schema.js"

export type TransitionCheck = { ok: true } | { ok: false; reason: string }

export interface TransitionContext {
  /** brief.md exists and remains non-empty after trimming. */
  briefNonEmpty: boolean
  /** plan.md exists. */
  planExists: boolean
  /** config.autoApprove */
  autoApprove: Size[]
  /** Gate name to state read from its verdict file; null means no verdict. */
  verdictStates: Record<string, GateState | null>
}

const SMALL_PHASES: Phase[] = ["build", "verify", "done"]
const FULL_PHASES: Phase[] = ["brief", "plan", "build", "verify", "done"]

/**
 * Required phases by task size.
 * In M1, `deep` matches `standard`; panel/review phases arrive in M3.
 */
export function requiredPhases(size: Size): Phase[] {
  return size === "small" ? [...SMALL_PHASES] : [...FULL_PHASES]
}

export function canEnter(task: Task, to: Phase, ctx: TransitionContext): TransitionCheck {
  const order = requiredPhases(task.size)
  const from = order.indexOf(task.phase)
  const target = order.indexOf(to)

  if (target === -1) return { ok: false, reason: `Phase "${to}" is not part of the "${task.size}" lifecycle.` }
  if (from === -1) return { ok: false, reason: `Current phase "${task.phase}" is not part of the "${task.size}" lifecycle.` }
  if (target !== from + 1) {
    return { ok: false, reason: `Only adjacent phase transitions are allowed. Current: "${task.phase}"; requested: "${to}".` }
  }

  // L1
  if (task.phase === "brief" && to === "plan") {
    if (!ctx.briefNonEmpty) return { ok: false, reason: "brief.md is missing or empty." }
    return { ok: true }
  }

  // L2 - the only hard human checkpoint.
  if (task.phase === "plan" && to === "build") {
    if (!ctx.planExists) return { ok: false, reason: "plan.md does not exist." }
    if (ctx.autoApprove.includes(task.size)) return { ok: true }
    if (task.phases.plan?.approvedBy !== "user") {
      return { ok: false, reason: "The plan is not approved. The user must type /junto:approve; the model cannot approve its own plan." }
    }
    return { ok: true }
  }

  // L3
  if (task.phase === "build" && to === "verify") return { ok: true }

  // L4
  if (task.phase === "verify" && to === "done") {
    const blocked: string[] = []
    for (const [name, status] of Object.entries(task.gates)) {
      if (!status.required) continue
      if (status.verdict === null) { blocked.push(`${name} (not run)`); continue }
      if (status.stale) { blocked.push(`${name} (stale evidence; code changed)`); continue }
      const state = ctx.verdictStates[name] ?? null
      if (state !== "pass") blocked.push(`${name} (${state ?? "unreadable verdict"})`)
    }
    if (blocked.length > 0) {
      return { ok: false, reason: `Required gates have not passed: ${blocked.join(", ")}. Run /junto:verify.` }
    }
    return { ok: true }
  }

  return { ok: false, reason: `No rule allows transition "${task.phase}" -> "${to}".` }
}
