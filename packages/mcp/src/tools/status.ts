import {
  canEnter, readActiveId, readConfig, readTask, requiredPhases, sizeRaisedPastPlan,
  type GateState, type Size, type Task,
} from "@junto/core"
import type { ToolContext } from "../context.js"
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

/** Render a read-only summary using the same disk facts and policy as phase transitions. */
export async function statusTool(ctx: ToolContext): Promise<string> {
  const id = readActiveId(ctx.root)
  if (id === null) return "No active task. Run /junto:start to create one."

  const config = readConfig(ctx.root)
  const { task, unknownGates } = await resolveTaskPolicy(ctx.root, readTask(ctx.root, id), config)
  const transitionContext = { ...buildTransitionContext(ctx.root, task, config), unknownRuleGates: unknownGates }
  const phases = requiredPhases(task.size)
  const phaseIndex = phases.indexOf(task.phase)
  const nextPhase = phaseIndex >= 0 ? phases[phaseIndex + 1] : undefined

  let blocker = "none"
  if (nextPhase !== undefined) {
    const check = canEnter(task, nextPhase, transitionContext)
    if (!check.ok) blocker = check.reason
  }

  const gates = Object.entries(task.gates).map(([name, gate]) => {
    const requirement = gate.required ? "required" : "optional"
    return `- ${name}: ${requirement}, ${gateState(gate, transitionContext.verdictStates[name] ?? null)}`
  })

  const cap = config.consultBudget?.maxTokensPerTask
  const budget = cap === undefined
    ? `${task.consultTokensUsed} tokens recorded (no cap configured)`
    : `${task.consultTokensUsed}/${cap} tokens`

  return `# Junto status\n\n`
    + `Task: ${task.id} — ${task.title}\n`
    + `Size: ${sizeLabel(task)}\n`
    + `Phase: ${task.phase}\n`
    + `Next: ${nextAction(task, config.autoApprove, transitionContext.planExists)}\n`
    + `Next phase: ${nextPhase ?? "none"}\n`
    + `Blockers: ${blocker}\n`
    + `Consult budget: ${budget}\n\n`
    + `## Gates\n\n${gates.join("\n") || "(none)"}`
}
