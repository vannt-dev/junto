import {
  findProjectRoot, planApproval, readActiveId, readPlanDigest, readTask, sizeRaisedPastPlan, updateTask,
  type PlanApproval, type Task,
} from "@junto/core"
import { runHook } from "./lib/io.js"
import { contextOutput } from "./lib/render.js"

export const APPROVE_SENTINEL = "JUNTO-APPROVE-SENTINEL-7f3a9c"

/** Only an exact command approves the plan; mentioning it inside a sentence is insufficient. */
const RAW_APPROVE = /^\s*\/junto:approve\s*$/

function isApproval(prompt: string): boolean {
  return RAW_APPROVE.test(prompt) || prompt.includes(APPROVE_SENTINEL)
}

export const ABANDON_SENTINEL = "JUNTO-ABANDON-SENTINEL-c41e8b"

/** The command must open the prompt; a reason may follow it. */
const RAW_ABANDON = /^\s*\/junto:abandon(?:\s[\s\S]*)?$/

function isAbandon(prompt: string): boolean {
  return RAW_ABANDON.test(prompt) || prompt.includes(ABANDON_SENTINEL)
}

const PLAN_LINE: Record<PlanApproval, string> = {
  none: "",
  approved: "Plan approved.",
  changed: "Plan changed after approval; the user must type /junto:approve again.",
}

export function renderStateBlock(task: Task, approval: PlanApproval = planApproval(task, null)): string {
  const gates = Object.entries(task.gates).map(([name, gate]) => {
    if (gate.verdict === null) return `${name}(not-run)`
    if (gate.stale) return `${name}(stale)`
    return `${name}(ok)`
  }).join(" ")

  const plan = PLAN_LINE[approval]
  const step = task.phases[task.phase]?.step
  const of = task.phases[task.phase]?.of
  const progress = step !== undefined && of !== undefined ? ` Step ${step}/${of}.` : ""

  const from = task.sizeChanges?.[0]?.from
  const escalated = from === undefined ? "" : ` escalated-from="${from}"`
  return `<junto task="${task.id}" phase="${task.phase}" size="${task.size}"${escalated}>\n`
    + `${plan}${progress}\n`
    + `Gates: ${gates || "not configured"}\n`
    + "</junto>"
}

export function handleState(input: { prompt?: string, cwd?: string }): string {
  const root = findProjectRoot(input.cwd ?? process.cwd())
  if (root === null) return ""

  const id = readActiveId(root)
  if (id === null) return ""

  let task: Task
  try {
    task = readTask(root, id)
  } catch {
    return ""
  }

  // Abandoning skips the gates, so like approval it must come from the user, never the model.
  if (isAbandon(input.prompt ?? "")) {
    const at = new Date().toISOString()
    updateTask(root, id, (current) => {
      current.abandonRequest = { by: "user", at }
    })
    return contextOutput(
      `The user asked to abandon task "${id}" (phase "${task.phase}"). `
      + "Call junto__task with action=\"abandon\" and the reason the user gave. The task is archived as abandoned, not finished.",
    )
  }

  const digest = readPlanDigest(root, id)
  const approval = planApproval(task, digest)

  if (isApproval(input.prompt ?? "")) {
    // A matched rule or a size raised past the plan step owes an approval outside the plan phase,
    // and so does a plan edited after the user approved it.
    const changed = approval === "changed"
    const checkpoint = (task.ruleApprovalRequired || sizeRaisedPastPlan(task) || changed) && task.phase !== "done"
    if (task.phase !== "plan" && !checkpoint) {
      return contextOutput(`Task "${id}" is not in the plan phase (current: "${task.phase}"); there is nothing to approve.`)
    }
    if (digest === null) {
      const cause = task.ruleApprovalRequired ? "A matched rule" : sizeRaisedPastPlan(task) ? "The raised task size" : "Approval"
      return contextOutput(`${cause} requires a plan. Write plan.md before requesting /junto:approve.`)
    }
    updateTask(root, id, (current) => {
      if (current.phase !== task.phase) throw new Error("The task changed phase while approval was being recorded.")
      // Bind the approval to the text the user saw; editing plan.md afterwards voids it.
      const planSha256 = readPlanDigest(root, id) ?? digest
      current.phases.plan = { ...(current.phases.plan ?? { status: "done" }), approvedBy: "user", planSha256 }
    })
    return contextOutput(
      `The user approved the ${changed ? "changed plan" : "plan"} for task "${id}". `
      + (task.phase === "plan"
        ? `Call junto__advance with to="${task.size === "deep" ? "panel" : "build"}" to enter the next phase.`
        : "The human approval checkpoint is satisfied. Continue the current phase."),
    )
  }

  return contextOutput(renderStateBlock(task, approval))
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/state.js")) {
  await runHook(input => handleState(input as { prompt?: string, cwd?: string }))
}
