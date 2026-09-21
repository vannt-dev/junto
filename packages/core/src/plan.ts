import { randomUUID } from "node:crypto"
import { type ChangedFile } from "./changes.js"
import { type RuleMatcher } from "./rules.js"

export interface JuntoPlan {
  id: string
  task: string
  files: string[]
  /** Changed files with their git status; deleted files are listed here but not reviewed. */
  changes: ChangedFile[]
  /** Ids of the rules that matched, so the selection can be explained and debugged. */
  rules: string[]
  skills: string[]
  gates: string[]
  approvalRequired: boolean
  createdAt: string
}

export interface BuildPlanOptions {
  id?: string
  defaultGates?: string[]
  defaultSkills?: string[]
  requireApproval?: boolean
  changes?: ChangedFile[]
}

export function buildPlan(
  task: string,
  files: string[],
  ruleMatcher?: RuleMatcher,
  options: BuildPlanOptions = {},
): JuntoPlan {
  const matched = ruleMatcher
    ? ruleMatcher.match(options.changes?.map(c => c.path) ?? files)
    : { matchedRules: [], skills: [], gates: [], approvalRequired: false }

  const skillSet = new Set<string>([...(options.defaultSkills ?? []), ...matched.skills])
  const gateSet = new Set<string>([...(options.defaultGates ?? []), ...matched.gates])

  const approvalRequired = Boolean(options.requireApproval || matched.approvalRequired)

  return {
    id: options.id || randomUUID().slice(0, 8),
    task,
    files: Array.from(new Set(files)),
    changes: options.changes ?? files.map(path => ({ path, status: "modified" as const })),
    rules: matched.matchedRules.map(r => r.id),
    skills: Array.from(skillSet),
    gates: Array.from(gateSet),
    approvalRequired,
    createdAt: new Date().toISOString(),
  }
}
