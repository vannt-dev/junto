import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  MockReviewProvider,
  OpenCodeReviewProvider,
  filterEnv,
  normalizeCategory,
  normalizeSeverity,
  parseDelegatePreview,
  parseOcrOutput,
  redactSecrets,
  runReviewGate,
  type ExecFn,
  type ExecResult,
  type ReviewFinding,
} from "../src/review.js"

// Shape taken from a real `ocr review --format json` run (v1.12.7): a successful run reports "complete".
const OCR_SUCCESS = JSON.stringify({
  status: "complete",
  comments: [
    {
      path: "src\\auth\\token.ts",
      content: "Token is logged with api_key=sk-abcdefghijklmnopqrstuvwxyz",
      start_line: 42,
      end_line: 44,
      category: "security",
      severity: "high",
    },
    { path: "src/util.ts", content: "Unused helper", start_line: 0, end_line: 0, category: "style" },
  ],
})

function fakeExec(result: Partial<ExecResult>, calls: string[][] = []): ExecFn {
  return async (_file, args) => {
    calls.push(args)
    if (args[0] === "--version") return { stdout: "ocr 1.12.7", stderr: "", exitCode: 0 }
    return { stdout: "", stderr: "", exitCode: 0, ...result }
  }
}

describe("normalization", () => {
  it("maps OCR vocabulary and never hides unknown severities", () => {
    expect(normalizeSeverity("critical")).toBe("critical")
    expect(normalizeSeverity("HIGH")).toBe("high")
    expect(normalizeSeverity(undefined)).toBe("medium")
    expect(normalizeSeverity("wat")).toBe("medium")
    expect(normalizeCategory("bug")).toBe("correctness")
    expect(normalizeCategory("test")).toBe("testing")
    expect(normalizeCategory("documentation")).toBe("maintainability")
    expect(normalizeCategory("unknown-thing")).toBe("other")
  })

  it("redacts common secret shapes", () => {
    expect(redactSecrets("key sk-abcdefghijklmnopqrstuvwxyz end")).not.toContain("sk-abcdef")
    expect(redactSecrets('password = "hunter2hunter2"')).toContain("[REDACTED]")
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here")
  })

  it("preserves Windows environment keys regardless of casing", () => {
    expect(filterEnv({ pAtH: "/bin", systemroot: "C:/Windows", GITHUB_TOKEN: "hidden" }))
      .toEqual({ pAtH: "/bin", systemroot: "C:/Windows" })
  })

  it("filterEnv keeps only what OCR needs", () => {
    const env = filterEnv({ PATH: "/bin", GITHUB_TOKEN: "x", OCR_HOME: "/o", ANTHROPIC_API_KEY: "k", NPM_TOKEN: "y" })
    expect(Object.keys(env).sort()).toEqual(["ANTHROPIC_API_KEY", "OCR_HOME", "PATH"])
  })
})

describe("parseOcrOutput", () => {
  it.each(["failed", "partial"])("redacts %s status messages", status => {
    const output = JSON.stringify({ status, message: "token=abcdefghijklmno", comments: [] })
    if (status === "failed") {
      expect(() => parseOcrOutput(output)).toThrow(/\[REDACTED\]/)
    } else {
      expect(parseOcrOutput(output).message).not.toContain("abcdefghijklmno")
    }
  })
  it("parses comments into normalized, redacted findings", () => {
    const { findings, nothingToReview } = parseOcrOutput(OCR_SUCCESS)
    expect(nothingToReview).toBe(false)
    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({ id: "ocr-1", file: "src/auth/token.ts", line: 42, severity: "high", category: "security" })
    expect(findings[0]?.message).not.toContain("sk-abcdef")
    // Missing severity stays visible; a zero line means "no line".
    expect(findings[1]).toMatchObject({ severity: "medium", category: "maintainability" })
    expect(findings[1]?.line).toBeNull()
  })

  it("treats status skipped as nothing to review", () => {
    expect(parseOcrOutput(JSON.stringify({ status: "skipped", comments: [] }))).toEqual({ findings: [], nothingToReview: true, incomplete: false })
  })

  it("accepts every completed status and treats null comments as none (Go marshals nil slices as null)", () => {
    for (const status of ["complete", "success", "completed_with_warnings"]) {
      expect(parseOcrOutput(JSON.stringify({ status, comments: null }))).toMatchObject({ findings: [], incomplete: false })
      expect(parseOcrOutput(JSON.stringify({ status }))).toMatchObject({ findings: [], incomplete: false })
    }
  })

  it("marks partial runs incomplete so a reviewed subset never reads as a clean review", () => {
    for (const status of ["partial", "completed_with_errors"]) {
      const parsed = parseOcrOutput(JSON.stringify({ status, message: "1 of 3 items failed", comments: [{ path: "a.ts", content: "x", severity: "low" }] }))
      expect(parsed.incomplete).toBe(true)
      expect(parsed.findings).toHaveLength(1)
      expect(parsed.message).toContain("1 of 3")
    }
  })

  it("rejects malformed output instead of guessing", () => {
    expect(() => parseOcrOutput("not json")).toThrow(/not valid JSON/)
    expect(() => parseOcrOutput("[]")).toThrow(/JSON object/)
    expect(() => parseOcrOutput(JSON.stringify({ status: "failed", message: "quota" }))).toThrow(/failed.*quota/)
    expect(() => parseOcrOutput(JSON.stringify({ status: "success", comments: {} }))).toThrow(/array or null/)
    expect(() => parseOcrOutput(JSON.stringify({ status: "success", comments: [{ path: "a" }] }))).toThrow(/path and content/)
    expect(() => parseOcrOutput(JSON.stringify({ comments: [] }))).toThrow(/Unexpected/)
  })
})

describe("parseDelegatePreview", () => {
  it("reads reviewable and excluded files", () => {
    const preview = parseDelegatePreview(JSON.stringify({
      mode: "workspace",
      merge_base: "abc",
      reviewable_files: [{ path: "src/a.ts", status: "M", insertions: 3, deletions: 1 }],
      excluded_files: [{ path: "package-lock.json", status: "M", insertions: 9, deletions: 9, exclude_reason: "lockfile" }],
    }))
    expect(preview.mergeBase).toBe("abc")
    expect(preview.reviewable[0]?.path).toBe("src/a.ts")
    expect(preview.excluded[0]?.excludeReason).toBe("lockfile")
  })

  it("rejects a preview without reviewable_files", () => {
    expect(() => parseDelegatePreview(JSON.stringify({ mode: "workspace" }))).toThrow(/reviewable_files/)
  })
})

describe("OpenCodeReviewProvider", () => {
  it("rejects truncated delegation output even if the retained JSON is valid", async () => {
    const provider = new OpenCodeReviewProvider({ exec: fakeExec({
      stdout: JSON.stringify({ reviewable_files: [] }), isMaxBuffer: true,
    }) })
    await expect(provider.delegatePreview({ root: "/repo" })).rejects.toThrow(/output limit/)
  })
  it("uses the real ocr CLI flags and never --files/--context", async () => {
    const calls: string[][] = []
    const provider = new OpenCodeReviewProvider({ executable: "ocr", exec: fakeExec({ stdout: OCR_SUCCESS }, calls) })
    const res = await provider.review({ root: "/repo", files: ["a.ts"], backgroundFile: "/repo/bg.md", from: "main", to: "HEAD" })

    const args = calls.find(c => c[0] === "review") ?? []
    expect(args).toEqual(expect.arrayContaining(["--repo", "/repo", "--format", "json", "--background-file", "/repo/bg.md", "--from", "main", "--to", "HEAD"]))
    expect(args).not.toContain("--files")
    expect(args).not.toContain("--context")
    expect(res.error).toBeUndefined()
    expect(res.findings).toHaveLength(2)
    expect(res.rawEvidence).not.toContain("sk-abcdef")
  })

  it("reports an unavailable executable as a provider error, not a finding", async () => {
    const provider = new OpenCodeReviewProvider({ executable: "nonexistent-ocr-cli-bin-999" })
    expect(await provider.isAvailable()).toBe(false)
    const res = await provider.review({ root: process.cwd() })
    expect(res.error?.kind).toBe("unavailable")
    expect(res.findings).toHaveLength(0)
  })

  it.each([
    ["timeout", { timedOut: true }, "timeout"],
    ["non-zero exit", { exitCode: 2, stderr: "boom" }, "exit"],
    ["oversized output", { isMaxBuffer: true }, "output-too-large"],
    ["malformed JSON", { stdout: "<html>" }, "parse"],
    ["schema violation", { stdout: JSON.stringify({ status: "success", comments: {} }) }, "schema"],
    ["partial run", { stdout: JSON.stringify({ status: "partial", message: "budget", comments: [] }) }, "incomplete"],
    ["reported failure", { stdout: JSON.stringify({ status: "failed", message: "x" }) }, "exit"],
  ])("maps %s to a provider error", async (_label, partial, kind) => {
    const provider = new OpenCodeReviewProvider({ executable: "ocr", exec: fakeExec(partial as Partial<ExecResult>) })
    const res = await provider.review({ root: "/repo" })
    expect(res.error?.kind).toBe(kind)
    expect(res.findings).toHaveLength(0)
  })

  it("delegatePreview calls ocr delegate preview and parses the result", async () => {
    const calls: string[][] = []
    const provider = new OpenCodeReviewProvider({
      executable: "ocr",
      exec: fakeExec({ stdout: JSON.stringify({ mode: "workspace", reviewable_files: [], excluded_files: [] }) }, calls),
    })
    const preview = await provider.delegatePreview({ root: "/repo" })
    expect(preview.reviewable).toEqual([])
    expect(calls.find(c => c[0] === "delegate")).toEqual(expect.arrayContaining(["delegate", "preview", "--format", "json"]))
  })
})

describe("runReviewGate", () => {
  let tmpRoot: string
  beforeEach(() => { tmpRoot = mkdtempSync(join(tmpdir(), "junto-review-gate-")) })
  afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }) })

  const finding = (severity: ReviewFinding["severity"]): ReviewFinding => ({
    id: "f-1", file: "src/auth.ts", line: 10, severity, category: "security", message: "Hardcoded secret",
  })
  const run = (provider: MockReviewProvider | OpenCodeReviewProvider, failOn?: ReviewFinding["severity"][]) =>
    runReviewGate({ root: tmpRoot, taskId: "task-1", name: "code-review", provider, context: {}, runner: "test", ...(failOn ? { failOn } : {}) })

  it("passes with no findings and writes standard evidence", async () => {
    const verdict = await run(new MockReviewProvider("mock-pass"))
    expect(verdict.state).toBe("pass")
    expect(verdict.exitCode).toBe(0)
    const dir = join(tmpRoot, ".junto", "tasks", "task-1", "verdicts")
    for (const f of ["code-review.json", "code-review.log", "code-review.review.json"]) expect(existsSync(join(dir, f))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, "code-review.review.json"), "utf-8")).provider).toBe("mock-pass")
  })

  it("fails on critical/high findings by default", async () => {
    const verdict = await run(new MockReviewProvider("m", [finding("high")]))
    expect(verdict.state).toBe("fail")
    expect(verdict.reason).toContain("1 review finding(s)")
  })

  it("lets medium findings pass unless failOn includes them", async () => {
    expect((await run(new MockReviewProvider("m", [finding("medium")]))).state).toBe("pass")
    expect((await run(new MockReviewProvider("m", [finding("medium")]), ["critical", "high", "medium"])).state).toBe("fail")
  })

  it("a broken reviewer fails the gate and a missing reviewer is skipped, never a pass", async () => {
    const broken = await run(new MockReviewProvider("m", [], { kind: "timeout", message: "slow" }))
    expect(broken.state).toBe("fail")
    expect(broken.reason).toContain("timeout")

    const missing = await run(new OpenCodeReviewProvider({ executable: "nonexistent-ocr-cli-bin-999" }))
    expect(missing.state).toBe("skipped")
    expect(missing.exitCode).toBeNull()
  })

  it("keeps raw provider output separate from normalized evidence", async () => {
    const provider = new OpenCodeReviewProvider({ executable: "ocr", exec: fakeExec({ stdout: OCR_SUCCESS }) })
    await run(provider)
    const dir = join(tmpRoot, ".junto", "tasks", "task-1", "verdicts")
    expect(existsSync(join(dir, "code-review.raw.json"))).toBe(true)
    expect(readFileSync(join(dir, "code-review.raw.json"), "utf-8")).not.toContain("sk-abcdef")
    expect(readFileSync(join(dir, "code-review.review.json"), "utf-8")).not.toContain("rawEvidence")
  })

  it("removes obsolete raw evidence when the next reviewer cannot run", async () => {
    await run(new MockReviewProvider("mock"))
    const raw = join(tmpRoot, ".junto", "tasks", "task-1", "verdicts", "code-review.raw.json")
    expect(existsSync(raw)).toBe(true)
    await run(new OpenCodeReviewProvider({ executable: "missing-reviewer-999" }))
    expect(existsSync(raw)).toBe(false)
  })

  it("redacts evidence from every provider, including normalized error messages", async () => {
    await run(new MockReviewProvider("mock", [], { kind: "exit", message: 'token="abcdefghijklmno"' }))
    const dir = join(tmpRoot, ".junto", "tasks", "task-1", "verdicts")
    for (const suffix of ["json", "log", "review.json", "raw.json"]) {
      expect(readFileSync(join(dir, `code-review.${suffix}`), "utf-8")).not.toContain("abcdefghijklmno")
      if (suffix.endsWith("json")) JSON.parse(readFileSync(join(dir, `code-review.${suffix}`), "utf-8"))
    }
  })

  it("rejects gate names that could escape verdicts/", async () => {
    await expect(runReviewGate({ root: tmpRoot, taskId: "t", name: "../x", provider: new MockReviewProvider(), context: {}, runner: "t" }))
      .rejects.toThrow(/Invalid gate name/)
  })
})
