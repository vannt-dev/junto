import { describe, expect, it } from "vitest"
import { canEnter, requiredPhases, type TransitionContext } from "../src/transitions.js"
import type { GateStatus, Task } from "../src/schema.js"

function makeTask(over: Partial<Task> = {}): Task {
  return {
    schemaVersion: 1,
    id: "t",
    title: "T",
    size: "standard",
    phase: "brief",
    baseCommit: null,
    createdAt: "2026-08-30T09:00:00Z",
    updatedAt: "2026-08-30T09:00:00Z",
    phases: {},
    gates: {},
    decisions: [],
    consults: [],
    consultTokensUsed: 0,
    ...over,
  }
}

function gate(over: Partial<GateStatus> = {}): GateStatus {
  return { required: true, verdict: "verdicts/g.json", stale: false, failStreak: 0, ...over }
}

const ctx = (over: Partial<TransitionContext> = {}): TransitionContext => ({
  briefNonEmpty: true,
  planExists: true,
  autoApprove: [],
  verdictStates: {},
  ...over,
})

describe("requiredPhases", () => {
  it("small skips brief and plan", () => {
    expect(requiredPhases("small")).toEqual(["build", "verify", "done"])
  })
  it("standard includes plan approval", () => {
    expect(requiredPhases("standard")).toEqual(["brief", "plan", "build", "verify", "done"])
  })
  it("deep includes advisory panel and review checkpoints", () => {
    expect(requiredPhases("deep")).toEqual(["brief", "plan", "panel", "build", "review", "verify", "done"])
  })
})

describe("L1 brief -> plan", () => {
  it("allows entry when brief.md has content", () => {
    expect(canEnter(makeTask({ phase: "brief" }), "plan", ctx())).toEqual({ ok: true })
  })

  it("blocks entry when brief.md is empty or missing", () => {
    const r = canEnter(makeTask({ phase: "brief" }), "plan", ctx({ briefNonEmpty: false }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/brief\.md/)
  })
})

describe("L2 plan -> build", () => {
  const atPlan = makeTask({ phase: "plan", phases: { plan: { status: "active" } } })

  it("blocks entry when plan.md does not exist", () => {
    const r = canEnter(atPlan, "build", ctx({ planExists: false }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/plan\.md/)
  })

  it("blocks entry until the user approves the plan", () => {
    const r = canEnter(atPlan, "build", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/junto:approve/)
  })

  it("allows entry when approvedBy is user", () => {
    const approved = makeTask({
      phase: "plan",
      phases: { plan: { status: "done", approvedBy: "user" } },
    })
    expect(canEnter(approved, "build", ctx())).toEqual({ ok: true })
  })

  it("bypasses L2 when the size is in autoApprove", () => {
    const r = canEnter(atPlan, "build", ctx({ autoApprove: ["standard"] }))
    expect(r).toEqual({ ok: true })
  })

  it("does not bypass L2 for a different autoApprove size", () => {
    const r = canEnter(atPlan, "build", ctx({ autoApprove: ["deep"] }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/junto:approve/)
  })
})

describe("deep advisory checkpoints", () => {
  it("requires plan approval before entering panel", () => {
    const task = makeTask({ size: "deep", phase: "plan", phases: { plan: { status: "active" } } })
    const r = canEnter(task, "panel", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/junto:approve/)
  })

  it("allows an approved plan to enter panel", () => {
    const task = makeTask({
      size: "deep",
      phase: "plan",
      phases: { plan: { status: "done", approvedBy: "user" } },
    })
    expect(canEnter(task, "panel", ctx())).toEqual({ ok: true })
  })

  it("allows panel -> build and build -> review -> verify", () => {
    expect(canEnter(makeTask({ size: "deep", phase: "panel" }), "build", ctx())).toEqual({ ok: true })
    expect(canEnter(makeTask({ size: "deep", phase: "build" }), "review", ctx())).toEqual({ ok: true })
    expect(canEnter(makeTask({ size: "deep", phase: "review" }), "verify", ctx())).toEqual({ ok: true })
  })

  it("does not let a deep task skip either checkpoint", () => {
    expect(canEnter(makeTask({ size: "deep", phase: "plan" }), "build", ctx()).ok).toBe(false)
    expect(canEnter(makeTask({ size: "deep", phase: "build" }), "verify", ctx()).ok).toBe(false)
  })
})

describe("L3 build -> verify", () => {
  it("always allows entry", () => {
    expect(canEnter(makeTask({ phase: "build" }), "verify", ctx())).toEqual({ ok: true })
  })
})

describe("L4 verify -> done", () => {
  const atVerify = (gates: Record<string, GateStatus>) => makeTask({ phase: "verify", gates })

  it("allows entry when every required gate passes and is fresh", () => {
    const t = atVerify({ tests: gate() })
    expect(canEnter(t, "done", ctx({ verdictStates: { tests: "pass" } }))).toEqual({ ok: true })
  })

  it("blocks entry when a required gate has no verdict", () => {
    const t = atVerify({ tests: gate({ verdict: null }) })
    const r = canEnter(t, "done", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/tests/)
  })

  it("blocks entry when a verdict is stale", () => {
    const t = atVerify({ tests: gate({ stale: true }) })
    const r = canEnter(t, "done", ctx({ verdictStates: { tests: "pass" } }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/stale/)
  })

  it("blocks entry when a verdict fails", () => {
    const t = atVerify({ tests: gate() })
    const r = canEnter(t, "done", ctx({ verdictStates: { tests: "fail" } }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/tests/)
  })

  it("fails closed when a required gate has a verdict path but no verdict state", () => {
    const t = atVerify({ tests: gate() })
    const r = canEnter(t, "done", ctx({ verdictStates: {} }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/tests/)
  })

  it("fails closed when a gate verdict state is explicitly null", () => {
    const t = atVerify({ tests: gate() })
    const r = canEnter(t, "done", ctx({ verdictStates: { tests: null } }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/tests/)
  })

  it("does not satisfy a required gate with a skipped verdict", () => {
    const t = atVerify({ audit: gate() })
    const r = canEnter(t, "done", ctx({ verdictStates: { audit: "skipped" } }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/audit/)
  })

  it("ignores optional gates", () => {
    const t = atVerify({ lint: gate({ required: false, verdict: null }) })
    expect(canEnter(t, "done", ctx())).toEqual({ ok: true })
  })

  it("reports every missing gate, not only the first", () => {
    const t = atVerify({ tests: gate({ verdict: null }), typecheck: gate({ verdict: null }) })
    const r = canEnter(t, "done", ctx())
    expect(r.ok === false && r.reason).toMatch(/tests/)
    expect(r.ok === false && r.reason).toMatch(/typecheck/)
  })
})

describe("adjacent phases and backward transitions", () => {
  it("does not allow skipping phases", () => {
    const r = canEnter(makeTask({ phase: "brief" }), "build", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/adjacent/)
  })

  it("does not allow moving backward", () => {
    const r = canEnter(makeTask({ phase: "verify" }), "build", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/adjacent/)
  })

  it("moves a small task directly from build to verify", () => {
    const t = makeTask({ size: "small", phase: "build" })
    expect(canEnter(t, "verify", ctx())).toEqual({ ok: true })
  })

  it("blocks phases outside the lifecycle for the task size", () => {
    const t = makeTask({ size: "small", phase: "build" })
    const r = canEnter(t, "plan", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/plan/)
    expect(r.ok === false && r.reason).toMatch(/small/)
  })
})
