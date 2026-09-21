import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { CliReviewProvider } from "../src/cli-review.js"
import { OpenCodeReviewProvider } from "../src/review.js"

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repo(empty = true): string {
  const root = mkdtempSync(join(tmpdir(), "junto-cli-review-")); roots.push(root)
  execFileSync("git", ["init", "-q", root])
  if (empty) execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "fixture"], { cwd: root })
  return root
}

it("fails closed when the trusted host command is unavailable or malformed", async () => {
  for (const command of ["[]", "invalid", "{}", '[""]']) {
    vi.stubEnv("JUNTO_REVIEW_COMMAND", command)
    expect((await new CliReviewProvider().review({ root: "/repo" })).error).toBeDefined()
  }
})

it("sends selected input to a real process and rejects out-of-scope or incomplete output", async () => {
  const root = repo(false)
  writeFileSync(join(root, "a.py"), "x = 1\n")
  execFileSync("git", ["add", "a.py"], { cwd: root })
  execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "root commit"], { cwd: root })
  vi.spyOn(OpenCodeReviewProvider.prototype, "delegatePreview").mockResolvedValue({ mode: "workspace", excluded: [], reviewable: [{ path: "a.py", status: "A", insertions: 1, deletions: 0 }] })
  vi.spyOn(OpenCodeReviewProvider.prototype, "delegateRules").mockResolvedValue({ schema_version: "1", groups: [] })
  const script = "let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>{if(!input.includes('x = 1'))process.exit(2);process.stdout.write(process.argv[1])})"
  for (const [doc, failed] of [
    [{ status: "complete", comments: [] }, false],
    [{ status: "partial", comments: [] }, true],
    [{ status: "complete", comments: [{ path: "outside.py", content: "bad" }] }, true],
  ] as const) {
    vi.stubEnv("JUNTO_REVIEW_COMMAND", JSON.stringify([process.execPath, "-e", script, JSON.stringify(doc)]))
    expect(Boolean((await new CliReviewProvider().review({ root, commit: "HEAD" })).error)).toBe(failed)
  }
})

it("keeps wildcard filenames literal in workspace, range and commit review input", async () => {
  const root = repo()
  for (const name of ["[id]", "i"]) {
    mkdirSync(join(root, "app", name), { recursive: true })
    writeFileSync(join(root, "app", name, "page.ts"), "export const value = 1\n")
  }
  execFileSync("git", ["add", "app"], { cwd: root })
  execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "baseline"], { cwd: root })
  writeFileSync(join(root, "app", "[id]", "page.ts"), "export const value = 'selected-marker'\n")
  writeFileSync(join(root, "app", "i", "page.ts"), "export const value = 'excluded-marker'\n")
  vi.spyOn(OpenCodeReviewProvider.prototype, "delegatePreview").mockResolvedValue({ mode: "workspace", excluded: [], reviewable: [{ path: "app/[id]/page.ts", status: "M", insertions: 1, deletions: 1 }] })
  vi.spyOn(OpenCodeReviewProvider.prototype, "delegateRules").mockResolvedValue({ schema_version: "1", groups: [] })
  const script = "let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>{if(!input.includes('selected-marker')||input.includes('excluded-marker'))process.exit(2);process.stdout.write(JSON.stringify({status:'complete',comments:[]}))})"
  vi.stubEnv("JUNTO_REVIEW_COMMAND", JSON.stringify([process.execPath, "-e", script]))
  expect((await new CliReviewProvider().review({ root })).error).toBeUndefined()
  execFileSync("git", ["add", "app"], { cwd: root })
  execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "changes"], { cwd: root })
  for (const refs of [{ commit: "HEAD" }, { from: "HEAD~1", to: "HEAD" }]) {
    expect((await new CliReviewProvider().review({ root, ...refs })).error).toBeUndefined()
  }
})

it.skipIf(process.env.REVIEW_LIVE !== "1")("live CLI evaluation detects a bug without high-severity false positives on clean control", async () => {
  const root = repo()
  const file = join(root, "average.py")
  const provider = new CliReviewProvider(120_000)
  writeFileSync(file, "def average(values):\n    if not values:\n        return 0\n    return sum(values) / len(values)\n")
  const clean = await provider.review({ root })
  expect(clean.error).toBeUndefined()
  expect(clean.nothingToReview).toBe(false)
  expect(clean.findings.filter(f => ["critical", "high"].includes(f.severity))).toEqual([])
  writeFileSync(file, "def average(values):\n    return sum(values) / 0\n")
  const buggy = await provider.review({ root })
  expect(buggy.error).toBeUndefined()
  expect(buggy.findings.some(f => f.file === "average.py" && f.category === "correctness")).toBe(true)
}, 260_000)
