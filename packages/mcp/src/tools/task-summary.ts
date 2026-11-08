import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  baseDrift, baseDriftMessage, canEnter, readActiveId, readConfig, readTask, requiredPhases, sizeRaisedPastPlan, taskDir,
  type BaseDrift, type BoardGate, type GateState, type Phase, type Size, type Task,
} from "@junto/core"
import { buildTransitionContext } from "./advance.js"
import { resolveTaskPolicy } from "./policy.js"
import { sizeLabel } from "./task.js"

function nextAction(task: Task, autoApprove: Size[], planExists: boolean): string {
  const approved = task.phases.plan?.approvedBy === "user"
  if (task.ruleApprovalRequired && !approved) return "/junto:plan, then /junto:approve"
  if (sizeRaisedPastPlan(task) && !approved && !autoApprove.includes(task.size)) {
    return planExists ? "/junto:approve" : "/junto:plan, then /junto:approve"
  }
  if (sizeRaisedPastPlan(task) && !planExists) return "/junto:plan"
  switch (task.phase) {
    case "brief": return "/junto:plan"
    case "plan": return "/junto:approve"
    case "panel": return "/junto:panel"
    case "build": return task.size === "deep" ? "advance to review, then run /junto:panel" : "/junto:verify"
    case "review": return "/junto:panel"
    case "verify": return "/junto:verify"
    case "done": return "/junto:finish"
  }
}

function gateState(
  gate: Task["gates"][string],
  verdictState: GateState | null,
): string {
  if (gate.verdict === null) return "not run"
  if (gate.stale) return "stale"
  return verdictState ?? "unreadable verdict"
}

/** The newest panel digest's one-line summary, or null when no panel has run for this task. */
function lastPanel(root: string, id: string): string | null {
  const dir = join(taskDir(root, id), "panels")
  if (!existsSync(dir)) return null
  const newest = readdirSync(dir)
    .map(name => ({ name, seq: /^(\d+)-digest\.md$/.exec(name)?.[1] }))
    .filter((entry): entry is { name: string, seq: string } => entry.seq !== undefined)
    .sort((a, b) => Number(b.seq) - Number(a.seq))[0]
  if (newest === undefined) return null
  const summary = /^summary: (.*)$/m.exec(readFileSync(join(dir, newest.name), "utf-8"))?.[1]
  return `panels/${newest.name}${summary === undefined ? "" : ` (${summary.trim()})`}`
}

/**
 * The largest drift among the bases that current evidence was verified against. Stale or missing
 * verdicts are skipped: they must be rerun anyway, and the rerun records the new base.
 */
export async function taskBaseDrift(root: string, task: Task): Promise<BaseDrift | null> {
  const bases = new Map<string, NonNullable<Task["gates"][string]["base"]>>()
  for (const gate of Object.values(task.gates)) {
    if (gate.verdict !== null && !gate.stale && gate.base) bases.set(`${gate.base.ref} ${gate.base.commit}`, gate.base)
  }
  let worst: BaseDrift | null = null
  for (const base of bases.values()) {
    const drift = await baseDrift(root, base)
    if (drift && (worst === null || drift.newCommits > worst.newCommits)) worst = drift
  }
  return worst
}

export interface TaskSummary {
  task: Task
  size: string
  next: string
  nextPhase: Phase | undefined
  blocker: string
  gates: BoardGate[]
  budget: string
  panel: string | null
  baseWarning: string | null
}

/** Read-only summary of a project's active task, using the same disk facts and policy as transitions. */
export async function summarizeActiveTask(root: string): Promise<TaskSummary | null> {
  const id = readActiveId(root)
  if (id === null) return null

  const config = readConfig(root)
  const { task, unknownGates } = await resolveTaskPolicy(root, readTask(root, id), config)
  const transitionContext = { ...buildTransitionContext(root, task, config), unknownRuleGates: unknownGates }
  const phases = requiredPhases(task.size)
  const phaseIndex = phases.indexOf(task.phase)
  const nextPhase = phaseIndex >= 0 ? phases[phaseIndex + 1] : undefined

  let blocker = "none"
  if (nextPhase !== undefined) {
    const check = canEnter(task, nextPhase, transitionContext)
    if (!check.ok) blocker = check.reason
  }

  const gates = Object.entries(task.gates).map(([name, gate]) => ({
    name, required: gate.required, state: gateState(gate, transitionContext.verdictStates[name] ?? null),
  }))

  const cap = config.consultBudget?.maxTokensPerTask
  const budget = cap === undefined
    ? `${task.consultTokensUsed} tokens recorded (no cap configured)`
    : `${task.consultTokensUsed}/${cap} tokens`

  const drift = await taskBaseDrift(root, task)
  return {
    task,
    size: sizeLabel(task),
    next: nextAction(task, config.autoApprove, transitionContext.planExists),
    nextPhase,
    blocker,
    gates,
    budget,
    panel: lastPanel(root, task.id),
    baseWarning: drift === null ? null : baseDriftMessage(drift),
  }
}
