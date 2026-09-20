import { describe, expect, it } from "vitest"
import { RuleMatcher, type Rule } from "../src/rules.js"

describe("RuleMatcher", () => {
  const rules: Rule[] = [
    {
      id: "ts-rule",
      patterns: ["**/*.ts", "**/*.tsx"],
      skills: ["typescript-engineering"],
      gates: ["typecheck"],
    },
    {
      id: "auth-rule",
      patterns: ["**/auth/**"],
      skills: ["security-review"],
      approvalRequired: true,
    },
    {
      id: "test-rule",
      patterns: ["**/*.test.ts", "**/*.spec.ts"],
      skills: ["testing"],
      gates: ["unit-test"],
    },
  ]

  const matcher = new RuleMatcher(rules)

  it("matches typescript and test patterns", () => {
    const files = ["packages/core/src/index.ts", "packages/core/test/sample.test.ts"]
    const result = matcher.match(files)

    expect(result.matchedRules.map(r => r.id)).toEqual(["ts-rule", "test-rule"])
    expect(result.skills).toContain("typescript-engineering")
    expect(result.skills).toContain("testing")
    expect(result.gates).toContain("typecheck")
    expect(result.gates).toContain("unit-test")
    expect(result.approvalRequired).toBe(false)
  })

  it("flags approvalRequired when auth rules match", () => {
    const files = ["src/auth/jwt.ts"]
    const result = matcher.match(files)

    expect(result.matchedRules.map(r => r.id)).toEqual(["ts-rule", "auth-rule"])
    expect(result.skills).toContain("typescript-engineering")
    expect(result.skills).toContain("security-review")
    expect(result.approvalRequired).toBe(true)
  })

  it("returns empty matches when files don't match any pattern", () => {
    const files = ["README.md", "docs/architecture.png"]
    const result = matcher.match(files)

    expect(result.matchedRules).toHaveLength(0)
    expect(result.skills).toHaveLength(0)
    expect(result.gates).toHaveLength(0)
    expect(result.approvalRequired).toBe(false)
  })
})
