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
  it("small bỏ qua brief và plan", () => {
    expect(requiredPhases("small")).toEqual(["build", "verify", "done"])
  })
  it("standard có approve qua plan", () => {
    expect(requiredPhases("standard")).toEqual(["brief", "plan", "build", "verify", "done"])
  })
  it("deep giống standard ở M1 (phase panel/review là M3)", () => {
    expect(requiredPhases("deep")).toEqual(["brief", "plan", "build", "verify", "done"])
  })
})

describe("L1 brief -> plan", () => {
  it("cho qua khi brief.md có nội dung", () => {
    expect(canEnter(makeTask({ phase: "brief" }), "plan", ctx())).toEqual({ ok: true })
  })

  it("chặn khi brief.md rỗng hoặc thiếu", () => {
    const r = canEnter(makeTask({ phase: "brief" }), "plan", ctx({ briefNonEmpty: false }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/brief\.md/)
  })
})

describe("L2 plan -> build", () => {
  const atPlan = makeTask({ phase: "plan", phases: { plan: { status: "active" } } })

  it("chặn khi plan.md chưa tồn tại", () => {
    const r = canEnter(atPlan, "build", ctx({ planExists: false }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/plan\.md/)
  })

  it("chặn khi plan chưa được người dùng duyệt", () => {
    const r = canEnter(atPlan, "build", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/junto:approve/)
  })

  it("cho qua khi approvedBy là user", () => {
    const approved = makeTask({
      phase: "plan",
      phases: { plan: { status: "done", approvedBy: "user" } },
    })
    expect(canEnter(approved, "build", ctx())).toEqual({ ok: true })
  })

  it("bỏ qua L2 khi cỡ nằm trong autoApprove", () => {
    const r = canEnter(atPlan, "build", ctx({ autoApprove: ["standard"] }))
    expect(r).toEqual({ ok: true })
  })

  it("autoApprove cỡ khác thì không giúp gì", () => {
    const r = canEnter(atPlan, "build", ctx({ autoApprove: ["deep"] }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/junto:approve/)
  })
})

describe("L3 build -> verify", () => {
  it("luôn cho qua", () => {
    expect(canEnter(makeTask({ phase: "build" }), "verify", ctx())).toEqual({ ok: true })
  })
})

describe("L4 verify -> done", () => {
  const atVerify = (gates: Record<string, GateStatus>) => makeTask({ phase: "verify", gates })

  it("cho qua khi mọi gate required đều pass và không stale", () => {
    const t = atVerify({ tests: gate() })
    expect(canEnter(t, "done", ctx({ verdictStates: { tests: "pass" } }))).toEqual({ ok: true })
  })

  it("chặn khi gate required chưa có verdict", () => {
    const t = atVerify({ tests: gate({ verdict: null }) })
    const r = canEnter(t, "done", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/tests/)
  })

  it("chặn khi verdict đã stale", () => {
    const t = atVerify({ tests: gate({ stale: true }) })
    const r = canEnter(t, "done", ctx({ verdictStates: { tests: "pass" } }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/hết hạn/)
  })

  it("chặn khi verdict fail", () => {
    const t = atVerify({ tests: gate() })
    const r = canEnter(t, "done", ctx({ verdictStates: { tests: "fail" } }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/tests/)
  })

  it("chặn khi gate required có verdict path nhưng ctx.verdictStates KHÔNG có tên gate (map rỗng) — fail-closed", () => {
    const t = atVerify({ tests: gate() })
    const r = canEnter(t, "done", ctx({ verdictStates: {} }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/tests/)
  })

  it("chặn khi ctx.verdictStates ghi rõ null cho gate — fail-closed, không coi null là pass", () => {
    const t = atVerify({ tests: gate() })
    const r = canEnter(t, "done", ctx({ verdictStates: { tests: null } }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/tests/)
  })

  it("skipped KHÔNG thoả mãn gate required", () => {
    const t = atVerify({ audit: gate() })
    const r = canEnter(t, "done", ctx({ verdictStates: { audit: "skipped" } }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/audit/)
  })

  it("gate không required thì bỏ qua hoàn toàn", () => {
    const t = atVerify({ lint: gate({ required: false, verdict: null }) })
    expect(canEnter(t, "done", ctx())).toEqual({ ok: true })
  })

  it("nêu tên MỌI gate còn thiếu, không chỉ cái đầu", () => {
    const t = atVerify({ tests: gate({ verdict: null }), typecheck: gate({ verdict: null }) })
    const r = canEnter(t, "done", ctx())
    expect(r.ok === false && r.reason).toMatch(/tests/)
    expect(r.ok === false && r.reason).toMatch(/typecheck/)
  })
})

describe("liền kề phase và chặn lùi", () => {
  it("không cho nhảy cóc phase", () => {
    const r = canEnter(makeTask({ phase: "brief" }), "build", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/liền kề/)
  })

  it("không cho lùi phase", () => {
    const r = canEnter(makeTask({ phase: "verify" }), "build", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/liền kề/)
  })

  it("task small vào thẳng verify từ build", () => {
    const t = makeTask({ size: "small", phase: "build" })
    expect(canEnter(t, "verify", ctx())).toEqual({ ok: true })
  })

  it("phase không thuộc vòng đời của cỡ này bị chặn (small không có plan)", () => {
    const t = makeTask({ size: "small", phase: "build" })
    const r = canEnter(t, "plan", ctx())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/plan/)
    expect(r.ok === false && r.reason).toMatch(/small/)
  })
})
