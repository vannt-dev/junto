import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { planApproval, planDigest, readPlanDigest } from "../src/plan-approval.js"
import { taskDir } from "../src/paths.js"
import type { Task } from "../src/schema.js"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function task(plan: Task["phases"][string] | undefined): Task {
  return {
    schemaVersion: 1,
    id: "t",
    title: "T",
    size: "standard",
    phase: "build",
    baseCommit: null,
    createdAt: "x",
    updatedAt: "x",
    phases: plan === undefined ? {} : { plan },
    gates: {},
    decisions: [],
    consults: [],
    consultTokensUsed: 0,
  }
}

describe("planDigest", () => {
  it("is a sha256 hex digest", () => {
    expect(planDigest("1. Do it\n")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes when the plan text changes", () => {
    expect(planDigest("1. Do it\n")).not.toBe(planDigest("1. Do something else\n"))
  })

  it("ignores line endings and ticked checkboxes", () => {
    const plan = "## Steps\n- [ ] one\n* [ ] two\n\n## Manual checks\n- [ ] open it in a browser\n"
    const ticked = "## Steps\r\n- [x] one\r\n* [X] two\r\n\r\n## Manual checks\r\n- [x] open it in a browser\r\n"
    expect(planDigest(ticked)).toBe(planDigest(plan))
  })

  it("still notices a checklist item whose text changed", () => {
    expect(planDigest("- [x] one\n")).not.toBe(planDigest("- [ ] one, and two\n"))
  })
})

describe("readPlanDigest", () => {
  it("is null without plan.md and the digest of its contents otherwise", () => {
    const root = mkdtempSync(join(tmpdir(), "junto-plan-digest-"))
    roots.push(root)
    mkdirSync(taskDir(root, "t"), { recursive: true })
    expect(readPlanDigest(root, "t")).toBeNull()
    writeFileSync(join(taskDir(root, "t"), "plan.md"), "1. Do it\n")
    expect(readPlanDigest(root, "t")).toBe(planDigest("1. Do it\n"))
  })
})

describe("planApproval", () => {
  const digest = planDigest("1. Do it\n")

  it("is none without a user approval", () => {
    expect(planApproval(task(undefined), digest)).toBe("none")
    expect(planApproval(task({ status: "active" }), digest)).toBe("none")
  })

  it("is approved while plan.md matches the approved digest", () => {
    expect(planApproval(task({ status: "done", approvedBy: "user", planSha256: digest }), digest)).toBe("approved")
  })

  it("is changed when plan.md differs from or no longer has the approved digest", () => {
    const approved = task({ status: "done", approvedBy: "user", planSha256: digest })
    expect(planApproval(approved, planDigest("2. Something else\n"))).toBe("changed")
    expect(planApproval(approved, null)).toBe("changed")
  })

  it("keeps an approval recorded before plan digests existed", () => {
    expect(planApproval(task({ status: "done", approvedBy: "user" }), digest)).toBe("approved")
  })
})
