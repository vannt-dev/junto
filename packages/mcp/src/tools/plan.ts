import { mkdirSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import {
  OpenCodeReviewProvider, RuleMatcher, SkillResolver, buildPlan,
  readActiveId, readConfig, readTask, resolveReviewScopes, resolveTaskChanges, taskDir,
  type DelegatePreview, type JuntoPlan, type ReviewScope,
} from "@junto/core"
import type { ToolContext } from "../context.js"
import { configRules, persistTaskPolicy, resolveTaskPolicy } from "./policy.js"

export interface ResolvedPlan extends JuntoPlan {
  base: string | null
  skillDetails: Array<{ name: string; found: boolean; path: string }>
  unknownGates: string[]
  reviewScopes?: Array<{ scope: ReviewScope; preview: DelegatePreview }>
  reviewPreviewNote?: string
}

/**
 * Deterministic plan: git decides the changed files, config rules decide skills and gates, and
 * the skill registry decides what guidance exists. No model is involved, so the same repository
 * state always yields the same plan.
 */
export async function resolvePlan(ctx: ToolContext): Promise<ResolvedPlan> {
  const id = readActiveId(ctx.root)
  if (id === null) throw new Error("No active task. Run /junto:start first.")
  const config = readConfig(ctx.root)
  const stored = readTask(ctx.root, id)

  const changes = await resolveTaskChanges(ctx.root, stored.baseCommit)
  const files = changes.filter(c => c.status !== "deleted").map(c => c.path)

  const { task, unknownGates } = await resolveTaskPolicy(ctx.root, stored, config, changes)
  persistTaskPolicy(ctx.root, stored, task)
  const rules = configRules(config)

  const plan = buildPlan(task.title, files, new RuleMatcher(rules), {
    id,
    defaultGates: Object.keys(task.gates),
    requireApproval: task.ruleApprovalRequired || !config.autoApprove.includes(task.size),
    changes,
  })

  const roots = (config.skills?.roots ?? []).map(r => (isAbsolute(r) ? r : resolve(ctx.root, r)))
  const skills = new SkillResolver(roots).resolveForFiles(files, plan.skills)
  const knownGates = new Set(Object.keys(config.gates))

  const resolved: ResolvedPlan = {
    ...plan,
    skills: skills.map(s => s.name),
    gates: plan.gates.filter(g => knownGates.has(g)),
    base: task.baseCommit,
    skillDetails: skills.map(s => ({ name: s.name, found: s.found, path: s.path })),
    unknownGates,
  }

  // Delegation preview: OCR selects reviewable files deterministically, without an LLM.
  const reviewGate = Object.values(config.gates).find(g => g.type === "review")
  if (reviewGate) {
    const provider = new OpenCodeReviewProvider()
    if (await provider.isAvailable(ctx.root)) {
      try {
        resolved.reviewScopes = []
        for (const scope of await resolveReviewScopes(ctx.root, task.baseCommit)) {
          const preview = await provider.delegatePreview({ root: ctx.root, ...scope })
          resolved.reviewScopes.push({ scope, preview })
        }
      } catch (err) {
        resolved.reviewPreviewNote = `OpenCodeReview preview failed: ${(err as Error).message}`
      }
    } else {
      resolved.reviewPreviewNote = `OpenCodeReview executable "${provider.executable}" is not available`
    }
  }

  const dir = taskDir(ctx.root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "plan.resolved.json"), `${JSON.stringify(resolved, null, 2)}\n`, "utf-8")
  return resolved
}

export async function planTool(ctx: ToolContext): Promise<string> {
  const plan = await resolvePlan(ctx)
  const lines = [
    `## Plan for "${plan.task}"`,
    `- changed files (${plan.files.length}): ${plan.files.join(", ") || "none"}`,
    `- matched rules: ${plan.rules.join(", ") || "none"}`,
    `- skills: ${plan.skillDetails.map(s => (s.found ? s.name : `${s.name} (NOT FOUND)`)).join(", ") || "none"}`,
    `- gates: ${plan.gates.join(", ") || "none"}`,
    `- approval required: ${plan.approvalRequired}`,
  ]
  if (plan.unknownGates.length > 0) {
    lines.push(`- rules reference gates missing from .junto/config.json: ${plan.unknownGates.join(", ")}`)
  }
  for (const { scope, preview } of plan.reviewScopes ?? []) {
    lines.push(`- review scope (OCR ${scope.mode}): ${preview.reviewable.length} reviewable, ${preview.excluded.length} excluded`)
  }
  if (plan.reviewPreviewNote) {
    lines.push(`- review scope: ${plan.reviewPreviewNote}`)
  }
  lines.push("", "Evidence: .junto/tasks/<id>/plan.resolved.json (written by junto, not editable by the model).")
  return lines.join("\n")
}
