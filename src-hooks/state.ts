import { existsSync } from "node:fs"
import { join } from "node:path"
import { findProjectRoot, readActiveId, readTask, taskDir, updateTask, type Task } from "@junto/core"
import { runHook } from "./lib/io.js"
import { contextOutput } from "./lib/render.js"

export const APPROVE_SENTINEL = "JUNTO-APPROVE-SENTINEL-7f3a9c"

/** Only an exact command approves the plan; mentioning it inside a sentence is insufficient. */
const RAW_APPROVE = /^\s*\/junto:approve\s*$/

function isApproval(prompt: string): boolean {
  return RAW_APPROVE.test(prompt) || prompt.includes(APPROVE_SENTINEL)
}

export function renderStateBlock(task: Task): string {
  const gates = Object.entries(task.gates).map(([name, gate]) => {
    if (gate.verdict === null) return `${name}(not-run)`
    if (gate.stale) return `${name}(stale)`
    return `${name}(ok)`
  }).join(" ")

  const plan = task.phases.plan?.approvedBy === "user" ? "Plan approved." : ""
  const step = task.phases[task.phase]?.step
  const of = task.phases[task.phase]?.of
  const progress = step !== undefined && of !== undefined ? ` Step ${step}/${of}.` : ""

  return `<junto task="${task.id}" phase="${task.phase}" size="${task.size}">\n`
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

  if (isApproval(input.prompt ?? "")) {
    const ruleCheckpoint = task.ruleApprovalRequired && task.phase !== "done"
    if (task.phase !== "plan" && !ruleCheckpoint) {
      return contextOutput(`Task "${id}" is not in the plan phase (current: "${task.phase}"); there is nothing to approve.`)
    }
    if (ruleCheckpoint && !existsSync(join(taskDir(root, id), "plan.md"))) {
      return contextOutput("A matched rule requires a plan. Write plan.md before requesting /junto:approve.")
    }
    updateTask(root, id, (current) => {
      if (current.phase !== task.phase) throw new Error("The task changed phase while approval was being recorded.")
      current.phases.plan = { ...(current.phases.plan ?? { status: "done" }), approvedBy: "user" }
    })
    return contextOutput(
      `The user approved the plan for task "${id}". `
      + (task.phase === "plan"
        ? `Call junto__advance with to="${task.size === "deep" ? "panel" : "build"}" to enter the next phase.`
        : "The rule's human approval checkpoint is satisfied. Continue the current phase."),
    )
  }

  return contextOutput(renderStateBlock(task))
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/state.js")) {
  await runHook(input => handleState(input as { prompt?: string, cwd?: string }))
}
