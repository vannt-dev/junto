import { describe, expect, it } from "vitest"
import { decideStop, stopEvidence, type StopFacts } from "../src/stop-gate.js"
import { unpassedRequiredGates } from "../src/transitions.js"
import type { GateStatus, Task } from "../src/schema.js"

function makeTask(over: Partial<Task> = {}): Task {
  return {
    schemaVersion: 1,
    id: "t",
    title: "T",
    size: "standard",
    phase: "build",
    baseCommit: null,
    createdAt: "2026-11-24T09:00:00Z",
    updatedAt: "2026-11-24T09:00:00Z",
    phases: { plan: { status: "done", approvedBy: "user" }, build: { status: "active" } },
    gates: { tests: gate() },
    decisions: [],
    consults: [],
    consultTokensUsed: 0,
    ...over,
  }
}

function gate(over: Partial<GateStatus> = {}): GateStatus {
  return { required: true, verdict: null, stale: false, failStreak: 0, ...over }
}

function facts(over: Partial<StopFacts> = {}): StopFacts {
  return {
    enabled: true,
    maxBlocks: 3,
    autoApprove: [],
    planExists: true,
    planDigest: null,
    verdicts: {},
    backgroundTasks: 0,
    ...over,
  }
}

describe("unpassedRequiredGates", () => {
  it("names required gates that are not run, stale, failing, skipped or unreadable", () => {
    const task = makeTask({
      gates: {
        a: gate(),
        b: gate({ verdict: "verdicts/b.json", stale: true }),
        c: gate({ verdict: "verdicts/c.json" }),
        d: gate({ verdict: "verdicts/d.json" }),
        e: gate({ verdict: "verdicts/e.json" }),
        ok: gate({ verdict: "verdicts/ok.json" }),
        optional: gate({ required: false }),
      },
    })
    expect(unpassedRequiredGates(task, { c: "fail", d: "skipped", e: null, ok: "pass" })).toEqual([
      "a (not run)",
      "b (stale evidence; code changed)",
      "c (fail)",
      "d (skipped)",
      "e (unreadable verdict)",
    ])
  })
})

describe("decideStop", () => {
  it("blocks in build when a required gate has not run, naming the gate and /junto:verify", () => {
    const decision = decideStop(makeTask(), facts())
    expect(decision.action).toBe("block")
    if (decision.action !== "block") return
    expect(decision.reason).toMatch(/tests \(not run\)/)
    expect(decision.reason).toMatch(/\/junto:verify/)
    expect(decision.state).toMatchObject({ phase: "build", blocks: 1 })
  })

  it("blocks in verify when a required gate fails", () => {
    const task = makeTask({ phase: "verify", gates: { tests: gate({ verdict: "verdicts/tests.json", failStreak: 1 }) } })
    const decision = decideStop(task, facts({ verdicts: { tests: { state: "fail", startedAt: "x" } } }))
    expect(decision.action).toBe("block")
    if (decision.action === "block") expect(decision.reason).toMatch(/tests \(fail\)/)
  })

  it("allows when every required gate passed", () => {
    const task = makeTask({ phase: "verify", gates: { tests: gate({ verdict: "verdicts/tests.json" }), lint: gate({ required: false }) } })
    expect(decideStop(task, facts({ verdicts: { tests: { state: "pass", startedAt: "x" } } })).action).toBe("allow")
  })

  it.each(["brief", "plan", "panel", "done"] as const)("allows in phase %s", (phase) => {
    expect(decideStop(makeTask({ phase }), facts()).action).toBe("allow")
  })

  it("allows when the stop gate is disabled", () => {
    expect(decideStop(makeTask(), facts({ enabled: false })).action).toBe("allow")
  })

  it("allows while a matched rule waits for the user's approval", () => {
    const task = makeTask({ ruleApprovalRequired: true, phases: { build: { status: "active" } } })
    expect(decideStop(task, facts())).toMatchObject({ action: "allow", why: expect.stringMatching(/approv/) })
  })

  it("allows while a raised size owes a plan or the user's approval", () => {
    const raised = makeTask({
      size: "standard",
      phases: { build: { status: "active" } },
      sizeChanges: [{ from: "small", to: "standard", at: "x", phase: "build", reason: "grew" }],
    })
    expect(decideStop(raised, facts()).action).toBe("allow")
    expect(decideStop(raised, facts({ planExists: false, autoApprove: ["standard"] })).action).toBe("allow")
    expect(decideStop(raised, facts({ autoApprove: ["standard"] })).action).toBe("block")
  })

  it("allows when the user asked to abandon the task", () => {
    const task = makeTask({ abandonRequest: { by: "user", at: "x" } })
    expect(decideStop(task, facts()).action).toBe("allow")
  })

  it("allows when a required gate keeps failing, so the user can decide on the plan", () => {
    const task = makeTask({ gates: { tests: gate({ verdict: "verdicts/tests.json", failStreak: 3 }) } })
    expect(decideStop(task, facts({ verdicts: { tests: { state: "fail", startedAt: "x" } } })).action).toBe("allow")
  })

  it("allows while a plan changed after approval waits for the user to approve it again", () => {
    const task = makeTask({ phases: { plan: { status: "done", approvedBy: "user", planSha256: "a" }, build: { status: "active" } } })
    expect(decideStop(task, facts({ planDigest: "b" })).action).toBe("allow")
    expect(decideStop(task, facts({ planDigest: "a" })).action).toBe("block")
  })

  it("allows while background tasks are still running", () => {
    expect(decideStop(makeTask(), facts({ backgroundTasks: 1 })).action).toBe("allow")
  })

  it("releases once nothing changed since the last block, and records it once", () => {
    const task = makeTask()
    const first = decideStop(task, facts())
    if (first.action !== "block") throw new Error("expected a block")
    const second = decideStop({ ...task, stopGate: first.state }, facts())
    expect(second.action).toBe("release")
    if (second.action !== "release") return
    expect(second.state.released).toBe("stall")
    expect(second.record.what).toMatch(/tests \(not run\)/)
    expect(second.message).toMatch(/\/junto:verify/)
    expect(decideStop({ ...task, stopGate: second.state }, facts()).action).toBe("allow")
  })

  it("blocks again after a stall release when the evidence changes", () => {
    const task = makeTask()
    const first = decideStop(task, facts())
    if (first.action !== "block") throw new Error("expected a block")
    const released = decideStop({ ...task, stopGate: first.state }, facts())
    if (released.action !== "release") throw new Error("expected a release")
    const edited = { ...task, gates: { tests: gate({ invalidationVersion: 1 }) }, stopGate: released.state }
    expect(decideStop(edited, facts()).action).toBe("block")
  })

  it("releases at the cap for the phase even when evidence keeps changing", () => {
    let task = makeTask()
    for (let i = 1; i <= 3; i++) {
      task = { ...task, gates: { tests: gate({ invalidationVersion: i }) } }
      const decision = decideStop(task, facts())
      if (decision.action !== "block") throw new Error(`expected block ${i}`)
      expect(decision.state.blocks).toBe(i)
      task = { ...task, stopGate: decision.state }
    }
    task = { ...task, gates: { tests: gate({ invalidationVersion: 9 }) } }
    const capped = decideStop(task, facts())
    expect(capped.action).toBe("release")
    if (capped.action !== "release") return
    expect(capped.state.released).toBe("cap")
    expect(capped.record.why).toMatch(/3/)
    task = { ...task, stopGate: capped.state, gates: { tests: gate({ invalidationVersion: 10 }) } }
    expect(decideStop(task, facts()).action).toBe("allow")
  })

  it("honours a configured cap", () => {
    const task = makeTask()
    const first = decideStop(task, facts({ maxBlocks: 1 }))
    if (first.action !== "block") throw new Error("expected a block")
    const next = { ...task, gates: { tests: gate({ invalidationVersion: 1 }) }, stopGate: first.state }
    expect(decideStop(next, facts({ maxBlocks: 1 }))).toMatchObject({ action: "release", state: { released: "cap" } })
  })

  it("starts a fresh count in a new phase", () => {
    const task = makeTask({ stopGate: { phase: "build", blocks: 3, evidence: "old", released: "cap" } })
    const decision = decideStop({ ...task, phase: "verify" }, facts())
    expect(decision).toMatchObject({ action: "block", state: { phase: "verify", blocks: 1 } })
  })

  it("changes the evidence key when a gate runs again", () => {
    const task = makeTask({ gates: { tests: gate({ verdict: "verdicts/tests.json", failStreak: 1 }) } })
    const before = stopEvidence(task, { tests: { state: "fail", startedAt: "2026-11-24T10:00:00Z" } })
    const after = stopEvidence(task, { tests: { state: "fail", startedAt: "2026-11-24T10:05:00Z" } })
    expect(before).not.toBe(after)
  })
})
