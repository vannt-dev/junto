import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { MockReviewProvider, parseDelegateRules, parseOcrOutput, runReviewGate } from "../src/review.js"
import { exportReviewReport, renderReviewReport, reviewReport } from "../src/review-report.js"
import { validReviewFinding } from "../src/finding-contract.js"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe("review completion", () => {
  it("records review events and exports escaped read-only evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "junto-report-")); roots.push(root)
    await runReviewGate({ root, taskId: "test", name: "review", runner: "test", context: {},
      provider: new MockReviewProvider("mock", [{ id: "f1", file: "a.ts", severity: "high", category: "correctness", message: "<script>alert(1)</script>" }]) })
    const report = reviewReport(root, "test")
    expect(report.events).toHaveLength(2)
    expect(report.reviews).toHaveLength(1)
    const html = renderReviewReport(report)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(readFileSync(exportReviewReport(root, "test"), "utf-8")).toBe(html)
    expect(reviewReport(root, "test")).toEqual(report)
  })

  it("rejects malformed, future and partial delegate rule contracts", () => {
    const group = { group_id: 1, source: "system", pattern: "*.py", files: ["a.py"], rule: "check" }
    const doc = JSON.stringify({ schema_version: "1", groups: [group] })
    expect(parseDelegateRules(doc, ["a.py"]).groups).toEqual([group])
    expect(() => parseDelegateRules(doc, ["a.py", "b.py"])).toThrow(/cover/)
    for (const doc of [{ schema_version: "2", groups: [] }, { schema_version: "1", groups: [null] }, []]) {
      expect(() => parseDelegateRules(JSON.stringify(doc), ["a.py"])).toThrow()
    }
  })

  it("emits the shared versioned finding contract including source, null line and metadata", () => {
    const fixture = JSON.parse(readFileSync(new URL("../contracts/review-contract.fixture.json", import.meta.url), "utf-8"))
    expect(parseOcrOutput(JSON.stringify(fixture.input)).findings).toEqual(fixture.findings)
    expect(fixture.findings.every(validReviewFinding)).toBe(true)
    expect(validReviewFinding({ ...fixture.findings[0], metadata: null })).toBe(false)
    const schema = JSON.parse(readFileSync(new URL("../contracts/review-finding.schema.json", import.meta.url), "utf-8"))
    const finding = parseOcrOutput('{"status":"complete","comments":[{"path":"a.py","content":"bad","end_line":2}]}').findings[0]
    expect(schema["x-contract-version"]).toBe(1)
    expect(Object.keys(finding ?? {}).sort()).toEqual(schema.required.sort())
    expect(finding).toMatchObject({ source: "open-code-review", line: null, metadata: { end_line: 2 } })
  })
})
