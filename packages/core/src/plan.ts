import { randomUUID } from "node:crypto"
import { type RuleMatcher } from "./rules.js"

export interface JuntoPlan {
  id: string
  task: string
  files: string[]
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
}

export function buildPlan(
  task: string,
  files: string[],
  ruleMatcher?: RuleMatcher,
  options: BuildPlanOptions = {},
): JuntoPlan {
  const matched = ruleMatcher ? ruleMatcher.match(files) : { skills: [], gates: [], approvalRequired: false }

  const skillSet = new Set<string>([...(options.defaultSkills ?? []), ...matched.skills])
  const gateSet = new Set<string>([...(options.defaultGates ?? []), ...matched.gates])

  const approvalRequired = Boolean(options.requireApproval || matched.approvalRequired)

  return {
    id: options.id || randomUUID().slice(0, 8),
    task,
    files: Array.from(new Set(files)),
    skills: Array.from(skillSet),
    gates: Array.from(gateSet),
    approvalRequired,
    createdAt: new Date().toISOString(),
  }
}
