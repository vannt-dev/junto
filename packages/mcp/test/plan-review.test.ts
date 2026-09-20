import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readActiveId, readTask, writeTask } from "@junto/core"
import { advanceTool } from "../src/tools/advance.js"
import { statusTool } from "../src/tools/status.js"
import { planTool, resolvePlan } from "../src/tools/plan.js"
import { taskTool } from "../src/tools/task.js"
import { verifyTool } from "../src/tools/verify.js"

let root: string
const ctx = () => ({ root, runner: "test@0" })
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" })
const write = (rel: string, body = "x\n") => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), body)
}
const savedBin = process.env.OPEN_CODE_REVIEW_BIN

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-plan-"))
  git("init", "-q")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "t")
  git("config", "commit.gpgsign", "false")
  write("README.txt")
  git("add", ".")
  git("commit", "-q", "-m", "init")

  write("skills/security-review/SKILL.md", "---\nname: security-review\ndescription: Security.\n---\n\nCheck authz.\n")
  git("add", ".")
  git("commit", "-q", "-m", "skills")
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({
    schemaVersion: 1,
    gates: {
      tests: { argv: ["node", "-e", "process.exit(0)"], required: true },
      "code-review": { type: "review", provider: "open-code-review", required: true },
    },
    rules: [
      { id: "auth", match: ["**/auth/**"], skills: ["security-review", "no-such-skill"], gates: ["audit"], approvalRequired: true },
      { id: "ts", match: ["**/*.ts"] },
    ],
    skills: { roots: ["."] },
  }))
  process.env.OPEN_CODE_REVIEW_BIN = "nonexistent-ocr-cli-bin-999"
})

afterEach(() => {
  if (savedBin === undefined) delete process.env.OPEN_CODE_REVIEW_BIN
  else process.env.OPEN_CODE_REVIEW_BIN = savedBin
  rmSync(root, { recursive: true, force: true })
})

describe("junto__plan", () => {
  it("builds a deterministic plan from git, rules and the skill registry", async () => {
    await taskTool(ctx(), { action: "start", title: "Add login", size: "standard" })
    write("src/auth/login.ts")
    write("src/util.ts")

    const plan = await resolvePlan(ctx())
    expect(plan.files.sort()).toEqual(["src/auth/login.ts", "src/util.ts"])
    expect(plan.rules).toEqual(["auth", "ts"])
    expect(plan.skills).toEqual(["security-review", "no-such-skill"])
    expect(plan.skillDetails.find(s => s.name === "no-such-skill")?.found).toBe(false)
    expect(plan.gates).toEqual(["tests", "code-review"])
    expect(plan.unknownGates).toEqual(["audit"])
    expect(plan.approvalRequired).toBe(true)
    expect(plan.reviewPreviewNote).toMatch(/not available/)

    const id = readActiveId(root)!
    const saved = JSON.parse(readFileSync(join(root, ".junto", "tasks", id, "plan.resolved.json"), "utf-8"))
    expect(saved.rules).toEqual(["auth", "ts"])
  })

  it("renders a readable summary and flags missing skills and unknown gates", async () => {
    await taskTool(ctx(), { action: "start", title: "Add login", size: "standard" })
    write("src/auth/login.ts")
    const text = await planTool(ctx())
    expect(text).toContain("no-such-skill (NOT FOUND)")
    expect(text).toContain("missing from .junto/config.json: audit")
  })

  it("fails loudly when git cannot report changes", async () => {
    await taskTool(ctx(), { action: "start", title: "Add login", size: "standard" })
    rmSync(join(root, ".git"), { recursive: true, force: true })
    await expect(resolvePlan(ctx())).rejects.toThrow(/Cannot resolve HEAD/)
  })
})

describe("junto__verify with a review gate", () => {
  it("records a missing reviewer as skipped, never as a pass, and writes the requirement background", async () => {
    await taskTool(ctx(), { action: "start", title: "Add login", size: "small" })
    const id = readActiveId(root)!
    write(`.junto/tasks/${id}/brief.md`, "Users must log in with refresh tokens\n")

    const out = await verifyTool(ctx(), { gates: ["code-review"] })
    expect(out).toMatch(/code-review - skipped/)
    expect(out).toMatch(/does not satisfy a required gate/)

    const task = readTask(root, id)
    expect(task.gates["code-review"]?.verdict).toBe("verdicts/code-review.json")
    const verdict = JSON.parse(readFileSync(join(root, ".junto", "tasks", id, "verdicts", "code-review.json"), "utf-8"))
    expect(verdict.state).toBe("skipped")
    expect(existsSync(join(root, ".junto", "tasks", id, "review-background.md"))).toBe(true)
    expect(readFileSync(join(root, ".junto", "tasks", id, "review-background.md"), "utf-8")).toContain("refresh tokens")
  })
})

function configureRule(overrides: Record<string, unknown> = {}): void {
  const path = join(root, ".junto", "config.json")
  const config = JSON.parse(readFileSync(path, "utf-8"))
  config.rules = [{ id: "auth", match: ["**/auth/**"], gates: ["code-review"], ...overrides }]
  config.autoApprove = ["standard", "small"]
  writeFileSync(path, JSON.stringify(config))
}

describe("rule enforcement without calling plan", () => {
  it("adds rule gates omitted at task creation and blocks completion after a skipped review", async () => {
    configureRule()
    await taskTool(ctx(), { action: "start", title: "Fix auth", size: "small", gates: ["tests"] })
    write("src/auth/login.ts")
    await advanceTool(ctx(), { to: "verify" })
    const output = await verifyTool(ctx(), {})
    expect(output).toContain("code-review - skipped")
    const task = readTask(root, readActiveId(root)!)
    expect(task.gates["code-review"]?.required).toBe(true)
    await expect(advanceTool(ctx(), { to: "done" })).rejects.toThrow(/code-review \(skipped\)/)
  })

  it("does not let an explicit verify subset waive a rule gate", async () => {
    configureRule()
    await taskTool(ctx(), { action: "start", title: "Fix auth", size: "small", gates: ["tests"] })
    write("src/auth/login.ts")
    await verifyTool(ctx(), { gates: ["tests"] })
    await advanceTool(ctx(), { to: "verify" })
    await expect(advanceTool(ctx(), { to: "done" })).rejects.toThrow(/code-review \(not run\)/)
  })

  it("requires human approval despite autoApprove and supports small tasks", async () => {
    configureRule({ approvalRequired: true })
    await taskTool(ctx(), { action: "start", title: "Fix auth", size: "small", gates: [] })
    const id = readActiveId(root)!
    write("src/auth/login.ts")
    write(`.junto/tasks/${id}/plan.md`, "Protect token verification.\n")
    await expect(advanceTool(ctx(), { to: "verify" })).rejects.toThrow(/requires human approval/)
    const task = readTask(root, id)
    expect(task.ruleApprovalRequired).toBe(true)
    task.phases.plan = { status: "done", approvedBy: "user" }
    writeTask(root, task)
    await expect(advanceTool(ctx(), { to: "verify" })).resolves.toContain("phase verify")
  })

  it("overrides autoApprove at the standard plan checkpoint", async () => {
    configureRule({ approvalRequired: true })
    await taskTool(ctx(), { action: "start", title: "Fix auth", size: "standard" })
    const id = readActiveId(root)!
    write(`.junto/tasks/${id}/brief.md`, "Fix authentication.\n")
    write("src/auth/login.ts")
    await advanceTool(ctx(), { to: "plan" })
    write(`.junto/tasks/${id}/plan.md`, "Protect token verification.\n")
    await expect(advanceTool(ctx(), { to: "build" })).rejects.toThrow(/requires human approval/)
  })

  it("blocks unknown rule gates and matches deleted protected files", async () => {
    configureRule({ gates: ["missing-audit"] })
    write("src/auth/login.ts")
    git("add", "src/auth/login.ts")
    git("commit", "-q", "-m", "auth")
    await taskTool(ctx(), { action: "start", title: "Remove auth", size: "small", gates: [] })
    rmSync(join(root, "src/auth/login.ts"))
    const plan = await resolvePlan(ctx())
    expect(plan.rules).toContain("auth")
    expect(plan.unknownGates).toContain("missing-audit")
    await expect(verifyTool(ctx(), {})).rejects.toThrow(/unconfigured gates: missing-audit/)
    await expect(advanceTool(ctx(), { to: "verify" })).rejects.toThrow(/unconfigured gates: missing-audit/)
  })

  it("shows fresh rule obligations without writing task state in status", async () => {
    configureRule({ approvalRequired: true })
    await taskTool(ctx(), { action: "start", title: "Fix auth", size: "small", gates: [] })
    write("src/auth/login.ts")
    const path = join(root, ".junto", "tasks", readActiveId(root)!, "task.json")
    const before = readFileSync(path, "utf-8")
    const output = await statusTool(ctx())
    expect(output).toContain("code-review: required, not run")
    expect(output).toContain("requires a plan and human approval")
    expect(readFileSync(path, "utf-8")).toBe(before)
  })
})
