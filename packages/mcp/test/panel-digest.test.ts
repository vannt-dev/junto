import { describe, expect, it } from "vitest"
import {
  buildPanelDigest, panelDigestSummary, panelRoleOutcome, parsePanelAnswer, renderPanelDigest,
} from "../src/tools/panel-digest.js"

function answer(findings: string[], verdict?: string): string {
  return "Some reasoning first.\n\n## Findings\n\n"
    + findings.map(line => `- ${line}`).join("\n")
    + (verdict === undefined ? "" : `\n\nVerdict: ${verdict}`)
}

const ok = (role: string, text: string, n = 1) =>
  panelRoleOutcome({ role, ok: true, path: `consults/00${n}-${role}.md`, text })

describe("parsePanelAnswer", () => {
  it("reads severity, location and message from each bullet, and the verdict", () => {
    const parsed = parsePanelAnswer(answer([
      "high | `src/parser.ts:42` | Empty input throws.",
      "Medium | src\\cli.ts | No exit code on failure.",
      "low | - | Naming is inconsistent.",
      "info | Consider a changelog note.",
      "sev-9 | src/a.ts:3-9 | Unknown severity.",
    ], "**concerns**"))

    expect(parsed.structured).toBe(true)
    expect(parsed.verdict).toBe("concerns")
    expect(parsed.findings).toEqual([
      { severity: "high", file: "src/parser.ts", line: 42, message: "Empty input throws." },
      { severity: "medium", file: "src/cli.ts", line: null, message: "No exit code on failure." },
      { severity: "low", file: null, line: null, message: "Naming is inconsistent." },
      { severity: "info", file: null, line: null, message: "Consider a changelog note." },
      { severity: "info", file: "src/a.ts", line: 3, message: "Unknown severity." },
    ])
  })

  it("treats '- none' as an empty list and prose without the format as unstructured", () => {
    expect(parsePanelAnswer(answer(["none"], "approve"))).toEqual({ structured: true, findings: [], verdict: "approve" })
    expect(parsePanelAnswer("Looks fine to me overall.")).toEqual({ structured: false, findings: [], verdict: null })
  })

  it("stops the list at the next heading", () => {
    const parsed = parsePanelAnswer(answer(["high | a.ts:1 | one"]) + "\n\n## Notes\n\n- not a finding")
    expect(parsed.findings).toHaveLength(1)
  })
})

describe("buildPanelDigest", () => {
  it("merges the same location across roles, orders by severity and names disagreements", () => {
    const digest = buildPanelDigest([
      ok("architect", answer(["medium | src/parser.ts:42 | Empty input throws.", "low | - | Rename parseAll."], "approve"), 1),
      panelRoleOutcome({ role: "adversary", ok: false, skipped: true, error: "Consult budget exhausted for this task: 20/15 tokens used." }),
      ok("pragmatist", "No format here, just prose.", 2),
      ok("reviewer", answer([
        "high | ./src/parser.ts:42 | parse('') crashes.",
        "critical | src/auth.ts:7 | Token is logged.",
        "low | - | rename parseAll",
      ], "reject"), 3),
      panelRoleOutcome({ role: "custom", ok: false, error: "OpenAI request failed (429): monthly budget exhausted" }),
    ])

    expect(digest.ran).toEqual(["architect", "pragmatist", "reviewer"])
    expect(digest.skipped).toEqual(["adversary"])
    expect(digest.failed).toEqual(["custom"])
    expect(digest.unstructured).toEqual(["pragmatist"])
    expect(digest.rawFindingCount).toBe(5)
    expect(digest.groups.map(g => [g.severity, g.file, g.line, g.raisedBy.map(r => r.role)])).toEqual([
      ["critical", "src/auth.ts", 7, ["reviewer"]],
      ["high", "src/parser.ts", 42, ["architect", "reviewer"]],
      ["low", null, null, ["architect", "reviewer"]],
    ])
    expect(digest.disagreements).toEqual([
      "Verdicts differ: architect approve, reviewer reject.",
      "src/parser.ts:42: severity differs: architect medium, reviewer high.",
    ])

    const text = renderPanelDigest(digest)
    expect(text).toContain("Ran 3 of 5 roles: architect, pragmatist, reviewer.")
    expect(text).toContain("- Skipped adversary: Consult budget exhausted")
    expect(text).toContain("- Failed custom: OpenAI request failed (429)")
    expect(text).toContain("No findings list from pragmatist")
    expect(text).toContain("### Findings (3 unique of 5 raised)")
    expect(text).toContain("2. [high] src/parser.ts:42 - parse('') crashes. (raised by 2 of 3: architect, reviewer)")
    expect(text).toContain("   - architect: Empty input throws.")
    expect(text).toContain("### Disagreements")
    expect(text).toContain("reviewer: consults/003-reviewer.md")
    expect(panelDigestSummary(digest)).toBe(
      "3 of 5 roles ran, 1 skipped, 1 failed; 3 findings (1 critical, 1 high, 1 low), 2 disagreement(s)",
    )
  })

  it("counts a role that repeats a point once", () => {
    const digest = buildPanelDigest([
      ok("architect", answer(["low | a.ts:1 | first", "high | a.ts:1 | second"])),
    ])
    expect(digest.groups).toHaveLength(1)
    expect(digest.groups[0]?.severity).toBe("high")
    expect(digest.groups[0]?.raisedBy).toEqual([{ role: "architect", severity: "high", message: "first" }])
    expect(digest.disagreements).toEqual([])
  })

  it("gives the same digest for the same answers", () => {
    const roles = () => [
      ok("architect", answer(["low | b.ts | x", "low | a.ts | y", "high | c.ts:2 | z"])),
      ok("reviewer", answer(["low | a.ts | y"])),
    ]
    expect(renderPanelDigest(buildPanelDigest(roles()))).toBe(renderPanelDigest(buildPanelDigest(roles())))
    expect(buildPanelDigest(roles()).groups.map(g => g.file)).toEqual(["c.ts", "a.ts", "b.ts"])
  })

  it("says so when nothing ran", () => {
    const digest = buildPanelDigest([
      panelRoleOutcome({ role: "architect", ok: false, skipped: true, error: "Consult budget exhausted" }),
    ])
    expect(renderPanelDigest(digest)).toContain("Ran 0 of 1 roles.")
    expect(panelDigestSummary(digest)).toBe("0 of 1 roles ran, 1 skipped; 0 findings")
  })
})
