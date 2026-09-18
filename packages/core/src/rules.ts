import { globToRegExp } from "./stale.js"

export interface Rule {
  id: string
  patterns: string[]
  skills?: string[]
  gates?: string[]
  approvalRequired?: boolean
}

export interface MatchResult {
  matchedRules: Rule[]
  skills: string[]
  gates: string[]
  approvalRequired: boolean
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "")
}

export class RuleMatcher {
  private compiled: Array<{ rule: Rule; regexes: RegExp[] }>

  constructor(public readonly rules: Rule[]) {
    this.compiled = rules.map(rule => ({
      rule,
      regexes: rule.patterns.map(p => globToRegExp(normalizePath(p))),
    }))
  }

  match(files: string[]): MatchResult {
    const normalizedFiles = files.map(normalizePath)
    const matchedRules: Rule[] = []
    const skillSet = new Set<string>()
    const gateSet = new Set<string>()
    let approvalRequired = false

    for (const { rule, regexes } of this.compiled) {
      const matches = normalizedFiles.some(file => regexes.some(r => r.test(file)))
      if (matches) {
        matchedRules.push(rule)
        rule.skills?.forEach(s => skillSet.add(s))
        rule.gates?.forEach(g => gateSet.add(g))
        if (rule.approvalRequired) {
          approvalRequired = true
        }
      }
    }

    return {
      matchedRules,
      skills: Array.from(skillSet),
      gates: Array.from(gateSet),
      approvalRequired,
    }
  }
}
