import { canEnter, readActiveId, readConfig, readTask, requiredPhases, type GateState, type Task } from "@junto/core"
import type { ToolContext } from "../context.js"
import { buildTransitionContext } from "./advance.js"

function nextAction(task: Task): string {
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
export function statusTool(ctx: ToolContext): string {
  const id = readActiveId(ctx.root)
  if (id === null) return "No active task. Run /junto:start to create one."

  const task = readTask(ctx.root, id)
  const config = readConfig(ctx.root)
  const transitionContext = buildTransitionContext(ctx.root, task, config)
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
    + `Size: ${task.size}\n`
    + `Phase: ${task.phase}\n`
    + `Next: ${nextAction(task)}\n`
    + `Next phase: ${nextPhase ?? "none"}\n`
    + `Blockers: ${blocker}\n`
    + `Consult budget: ${budget}\n\n`
    + `## Gates\n\n${gates.join("\n") || "(none)"}`
}
