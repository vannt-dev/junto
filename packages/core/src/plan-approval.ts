import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { taskDir } from "./paths.js"
import type { Task } from "./schema.js"

/** Ticking a task-list box records progress on the plan; it does not change what was approved. */
const CHECKBOX = /^(\s*[-*+]\s+)\[[ xX]\]/gm

/**
 * sha256 of plan.md as approved. Line endings and the ticked state of checkboxes are normalized,
 * so an editor's CRLF or a ticked manual check keeps the approval; any other edit voids it.
 */
export function planDigest(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").replace(CHECKBOX, "$1[ ]")
  return createHash("sha256").update(normalized, "utf-8").digest("hex")
}

/** Digest of the task's plan.md, or null when there is none. */
export function readPlanDigest(root: string, taskId: string): string | null {
  const path = join(taskDir(root, taskId), "plan.md")
  if (!existsSync(path)) return null
  return planDigest(readFileSync(path, "utf-8"))
}

export type PlanApproval = "none" | "approved" | "changed"

/**
 * Whether the user's approval still covers plan.md. Approvals recorded before junto stored the
 * digest have nothing to compare and stay valid.
 */
export function planApproval(task: Task, currentDigest: string | null): PlanApproval {
  const plan = task.phases.plan
  if (plan?.approvedBy !== "user") return "none"
  if (plan.planSha256 === undefined) return "approved"
  return plan.planSha256 === currentDigest ? "approved" : "changed"
}

export const PLAN_CHANGED_REASON = "The plan changed after approval: plan.md differs from the version the user approved. "
  + "Show the user what changed; they must type /junto:approve again. The model cannot re-approve its own plan."
