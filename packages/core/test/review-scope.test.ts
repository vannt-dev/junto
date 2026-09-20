import { describe, expect, it } from "vitest"
import { ScopedReviewProvider, type ReviewScope } from "../src/review-scope.js"
import type { ReviewContext, ReviewResult } from "../src/review.js"

const scopes: ReviewScope[] = [
  { mode: "range", from: "base", to: "head", files: ["a.ts"] },
  { mode: "workspace", files: ["b.ts"] },
]
const clean: ReviewResult = { provider: "ocr", findings: [] }

describe("reviewing all task scopes", () => {
  it.each(["first", "last"])("retains a %s scope failure and the other scope's evidence", async (position) => {
    const failure: ReviewResult = { ...clean, error: { kind: "timeout", message: "slow" } }
    const results = position === "first" ? [failure, clean] : [clean, failure]
    const contexts: ReviewContext[] = []
    const provider = new ScopedReviewProvider({ review: async context => {
      contexts.push(context)
      const result = results.shift()
      if (!result) throw new Error("Unexpected additional review call")
      return result
    } }, scopes)
    const result = await provider.review({ root: "/repo", backgroundFile: "/repo/background.md" })
    expect(result.error?.kind).toBe("timeout")
    expect(result.runs).toHaveLength(2)
    expect(contexts[0]).toMatchObject({ from: "base", to: "head" })
    expect(contexts[1]?.from).toBeUndefined()
    expect(contexts.every(c => c.backgroundFile === "/repo/background.md")).toBe(true)
  })

  it("does not let a complete scope hide a skipped scope", async () => {
    const result = await new ScopedReviewProvider({ review: async context => context.from
      ? clean : { ...clean, nothingToReview: true } }, scopes).review({ root: "/repo" })
    expect(result.error?.kind).toBe("incomplete")
  })

  it("keeps findings from both scopes with distinct ids", async () => {
    const result = await new ScopedReviewProvider({ review: async () => ({
      ...clean,
      findings: [{ id: "ocr-1", severity: "high", category: "security", file: "a.ts", message: "Issue" }],
    }) }, scopes).review({ root: "/repo" })
    expect(result.findings.map(f => f.id)).toEqual(["range-ocr-1", "workspace-ocr-1"])
  })
})
