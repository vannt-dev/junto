import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  decideStop, findProjectRoot, readActiveId, readConfig, readGateEvidence, readPlanDigest, readTask, stopGateConfigSchema, taskDir, updateTask,
  type StopGateConfig, type Task,
} from "@junto/core"
import { runHook } from "./lib/io.js"

export interface StopInput {
  hook_event_name?: string
  cwd?: string
  /** True when Claude is already continuing because a Stop hook blocked; the per-phase cap covers it. */
  stop_hook_active?: boolean
  background_tasks?: unknown[]
}

/**
 * Keep Claude working while the active task's required gates have not passed. The hook fails open:
 * anything it cannot read or record lets the turn end, so a broken hook never traps a session.
 */
export function handleStop(input: StopInput): string {
  const root = findProjectRoot(input.cwd ?? process.cwd())
  if (root === null) return ""
  const id = readActiveId(root)
  if (id === null) return ""

  let task: Task
  let stopConfig: StopGateConfig
  let autoApprove: Task["size"][]
  try {
    task = readTask(root, id)
    const config = readConfig(root)
    stopConfig = config.stopGate ?? stopGateConfigSchema.parse({})
    autoApprove = config.autoApprove
  } catch {
    return ""
  }

  const decision = decideStop(task, {
    ...stopConfig,
    autoApprove,
    planExists: existsSync(join(taskDir(root, id), "plan.md")),
    planDigest: readPlanDigest(root, id),
    verdicts: readGateEvidence(root, task),
    backgroundTasks: Array.isArray(input.background_tasks) ? input.background_tasks.length : 0,
  })
  if (decision.action === "allow") return ""

  // Record before answering: a block whose count was not saved could repeat without end.
  updateTask(root, id, (current) => {
    if (current.phase !== task.phase) throw new Error("The task changed phase while the stop gate ran.")
    current.stopGate = decision.state
    if (decision.action === "release") current.decisions.push({ at: new Date().toISOString(), ...decision.record })
  })

  if (decision.action === "release") return JSON.stringify({ systemMessage: decision.message })
  return JSON.stringify({ decision: "block", reason: decision.reason })
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/stop.js")) {
  await runHook(input => handleStop(input as StopInput))
}
