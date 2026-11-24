import { createHash } from "node:crypto"
import type { GateEvidence } from "./gates.js"
import type { Phase, Size, StopGateState, Task } from "./schema.js"
import { sizeRaisedPastPlan, unpassedRequiredGates } from "./transitions.js"

/** Phases where the model is expected to make the required gates pass before it ends a turn. */
export const STOP_GATE_PHASES: readonly Phase[] = ["build", "review", "verify"]

/** Matches the verify tool's hint: after this many failures in a row the plan, not the code, may be wrong. */
export const STOP_GATE_FAIL_STREAK = 3

/** Facts read at the I/O boundary so decideStop stays pure. */
export interface StopFacts {
  enabled: boolean
  maxBlocks: number
  autoApprove: Size[]
  planExists: boolean
  verdicts: Record<string, GateEvidence>
  /** In-flight background tasks from the Stop input; the session is paused, not finished. */
  backgroundTasks: number
}

export type StopDecision =
  | { action: "allow", why: string }
  | { action: "block", reason: string, state: StopGateState }
  | { action: "release", message: string, state: StopGateState, record: { what: string, why: string } }

/** Digest of everything a gate run or a source edit changes, so an unchanged digest means no progress. */
export function stopEvidence(task: Task, verdicts: Record<string, GateEvidence>): string {
  const rows = Object.keys(task.gates).sort().map((name) => {
    const gate = task.gates[name]
    const seen = verdicts[name]
    return [name, gate?.verdict ?? null, gate?.stale ?? false, gate?.invalidationVersion ?? 0, gate?.failStreak ?? 0,
      seen?.state ?? null, seen?.startedAt ?? null]
  })
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16)
}

/** The step only the user can take next, or null when the model can make progress itself. */
function waitsOnUser(task: Task, facts: StopFacts): string | null {
  const approved = task.phases.plan?.approvedBy === "user"
  if (task.abandonRequest !== undefined) return "the user asked to abandon the task"
  if (task.ruleApprovalRequired && !approved) return "a matched rule waits for the user's plan approval"
  if (sizeRaisedPastPlan(task) && (!facts.planExists || (!facts.autoApprove.includes(task.size) && !approved))) {
    return "the raised task size owes a plan and the user's approval"
  }
  return null
}

/**
 * Decide whether the Stop hook keeps Claude working. It only nudges toward evidence the model can
 * produce itself, and it always lets go: at the per-phase cap, or when nothing changed since the
 * last block, so a turn that waits on the user is never trapped.
 */
export function decideStop(task: Task, facts: StopFacts): StopDecision {
  if (!facts.enabled) return { action: "allow", why: "the stop gate is turned off" }
  if (!STOP_GATE_PHASES.includes(task.phase)) return { action: "allow", why: `phase "${task.phase}" has no gates to finish` }
  const user = waitsOnUser(task, facts)
  if (user !== null) return { action: "allow", why: user }
  if (facts.backgroundTasks > 0) return { action: "allow", why: "background tasks are still running" }

  const states = Object.fromEntries(Object.entries(facts.verdicts).map(([name, seen]) => [name, seen.state]))
  const blocked = unpassedRequiredGates(task, states)
  if (blocked.length === 0) return { action: "allow", why: "every required gate passed" }
  const stuck = Object.entries(task.gates).some(([name, gate]) =>
    gate.required && gate.failStreak >= STOP_GATE_FAIL_STREAK && states[name] === "fail")
  if (stuck) return { action: "allow", why: "a required gate keeps failing; the user decides on the plan" }

  const evidence = stopEvidence(task, facts.verdicts)
  const prior = task.stopGate?.phase === task.phase ? task.stopGate : undefined
  if (prior?.released === "cap") return { action: "allow", why: "the cap for this phase was reached" }
  if (prior?.released === "stall" && prior.evidence === evidence) return { action: "allow", why: "nothing changed since the last release" }

  const gates = blocked.join(", ")
  const blocks = prior?.blocks ?? 0
  const release = (released: "cap" | "stall", why: string): StopDecision => ({
    action: "release",
    message: `junto: Claude stopped with required gates not passed: ${gates}. ${why} Run /junto:verify before /junto:finish.`,
    state: { phase: task.phase, blocks, evidence, released },
    record: { what: `Stop gate let the turn end in phase ${task.phase} with required gates not passed: ${gates}`, why },
  })
  if (blocks >= facts.maxBlocks) return release("cap", `The stop gate already blocked ${blocks} times in this phase.`)
  if (blocks > 0 && prior?.released === undefined && prior?.evidence === evidence) {
    return release("stall", "Nothing changed since the last block (no edit and no gate run).")
  }

  return {
    action: "block",
    reason: `junto task "${task.id}" is in phase ${task.phase} and required gates have not passed: ${gates}. `
      + "Run /junto:verify (junto__verify) and fix what fails before ending your turn. "
      + "If you need the user's input, ask for it; this reminder does not repeat when nothing changed.",
    state: { phase: task.phase, blocks: blocks + 1, evidence },
  }
}
