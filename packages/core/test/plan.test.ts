import { describe, expect, it } from "vitest"
import { buildPlan } from "../src/plan.js"
import { RuleMatcher } from "../src/rules.js"

describe("buildPlan", () => {
  const matcher = new RuleMatcher([
    {
      id: "auth",
      patterns: ["**/auth/**"],
      skills: ["security-review"],
      gates: ["security-scan"],
      approvalRequired: true,
    },
  ])

  it("builds a plan matching files against rules", () => {
    const plan = buildPlan(
      "Add OAuth2 login flow",
      ["src/auth/oauth.ts", "src/user/model.ts"],
      matcher,
      { defaultGates: ["lint", "typecheck"] },
    )

    expect(plan.task).toBe("Add OAuth2 login flow")
    expect(plan.files).toEqual(["src/auth/oauth.ts", "src/user/model.ts"])
    expect(plan.skills).toEqual(["security-review"])
    expect(plan.gates).toContain("lint")
    expect(plan.gates).toContain("typecheck")
    expect(plan.gates).toContain("security-scan")
    expect(plan.approvalRequired).toBe(true)
    expect(plan.id).toBeDefined()
    expect(plan.createdAt).toBeDefined()
  })

  it("builds default plan without rules", () => {
    const plan = buildPlan("Fix typo", ["README.md"])
    expect(plan.files).toEqual(["README.md"])
    expect(plan.skills).toHaveLength(0)
    expect(plan.approvalRequired).toBe(false)
  })
})
