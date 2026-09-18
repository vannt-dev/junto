import { describe, expect, it } from "vitest"
import { MockReviewProvider, OpenCodeReviewProvider, type ReviewFinding } from "../src/review.js"

describe("ReviewProvider in Junto", () => {
  it("MockReviewProvider returns passed true when no findings", async () => {
    const provider = new MockReviewProvider("test-mock")
    const res = await provider.review(["src/index.ts"])
    expect(res.provider).toBe("test-mock")
    expect(res.passed).toBe(true)
    expect(res.findings).toHaveLength(0)
  })

  it("MockReviewProvider returns findings when configured", async () => {
    const findings: ReviewFinding[] = [
      {
        file: "src/auth.ts",
        line: 12,
        severity: "error",
        category: "security",
        message: "Insecure hashing",
      },
    ]
    const provider = new MockReviewProvider("test-mock", findings)
    const res = await provider.review(["src/auth.ts"])
    expect(res.passed).toBe(false)
    expect(res.findings).toEqual(findings)
    expect(res.rawEvidence).toBeDefined()
  })

  it("OpenCodeReviewProvider handles nonexistent CLI gracefully", async () => {
    const provider = new OpenCodeReviewProvider("nonexistent-ocr-cli-bin-999")
    const isAvail = await provider.isAvailable()
    expect(isAvail).toBe(false)

    const res = await provider.review(["src/index.ts"])
    expect(res.provider).toBe("open-code-review")
    expect(res.passed).toBe(false)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0].severity).toBe("error")
  })

  it("runReviewGate writes standard verdict and review evidence", async () => {
    const { mkdtempSync, rmSync, existsSync, readFileSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { runReviewGate } = await import("../src/review.js")

    const tmpRoot = mkdtempSync(join(tmpdir(), "junto-review-gate-"))
    try {
      const provider = new MockReviewProvider("mock-pass")
      const verdict = await runReviewGate({
        root: tmpRoot,
        taskId: "task-test-1",
        name: "code-review",
        provider,
        files: ["src/index.ts"],
        runner: "test-runner",
      })

      expect(verdict.state).toBe("pass")
      expect(verdict.exitCode).toBe(0)
      expect(verdict.gate).toBe("code-review")

      const verdictPath = join(tmpRoot, ".junto", "tasks", "task-test-1", "verdicts", "code-review.json")
      const logPath = join(tmpRoot, ".junto", "tasks", "task-test-1", "verdicts", "code-review.log")
      const reviewPath = join(tmpRoot, ".junto", "tasks", "task-test-1", "verdicts", "code-review.review.json")

      expect(existsSync(verdictPath)).toBe(true)
      expect(existsSync(logPath)).toBe(true)
      expect(existsSync(reviewPath)).toBe(true)

      const reviewData = JSON.parse(readFileSync(reviewPath, "utf-8"))
      expect(reviewData.passed).toBe(true)
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it("runReviewGate fails and includes reason when errors exist", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { runReviewGate } = await import("../src/review.js")

    const tmpRoot = mkdtempSync(join(tmpdir(), "junto-review-gate-fail-"))
    try {
      const provider = new MockReviewProvider("mock-fail", [
        { file: "src/auth.ts", line: 10, severity: "error", message: "Hardcoded secret" },
      ])
      const verdict = await runReviewGate({
        root: tmpRoot,
        taskId: "task-test-2",
        name: "code-review",
        provider,
        files: ["src/auth.ts"],
        runner: "test-runner",
      })

      expect(verdict.state).toBe("fail")
      expect(verdict.exitCode).toBe(1)
      expect(verdict.reason).toContain("1 review defect(s)")
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})

