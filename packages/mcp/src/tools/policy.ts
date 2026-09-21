import { RuleMatcher, resolveTaskChanges, type ChangedFile, type Config, type Rule, type Task } from "@junto/core"

export function configRules(config: Config): Rule[] {
  return (config.rules ?? []).map(r => ({
    id: r.id, patterns: r.match,
    ...(r.skills ? { skills: r.skills } : {}),
    ...(r.gates ? { gates: r.gates } : {}),
    ...(r.approvalRequired === undefined ? {} : { approvalRequired: r.approvalRequired }),
  }))
}

/** Resolve current rule obligations at every enforcement boundary, even if plan was never called. */
export async function resolveTaskPolicy(root: string, task: Task, config: Config, changes?: ChangedFile[]): Promise<{ task: Task; unknownGates: string[] }> {
  if (!config.rules?.length) return { task, unknownGates: [] }
  const scope = changes ?? await resolveTaskChanges(root, task.baseCommit)
  // Deleting a protected file still triggers its rules.
  const matched = new RuleMatcher(configRules(config)).match(scope.map(c => c.path))
  const gates = { ...task.gates }
  const unknownGates: string[] = []
  for (const name of matched.gates) {
    const spec = config.gates[name]
    if (!spec) { unknownGates.push(name); continue }
    const prior = gates[name]
    gates[name] = prior
      ? { ...prior, required: prior.required || spec.required }
      : { required: spec.required, verdict: null, stale: false, failStreak: 0 }
  }
  return {
    task: { ...task, gates, ruleApprovalRequired: task.ruleApprovalRequired || matched.approvalRequired },
    unknownGates,
  }
}
