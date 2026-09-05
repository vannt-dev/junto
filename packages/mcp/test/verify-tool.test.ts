import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readActiveId, readTask } from "@junto/core"
import { taskTool } from "../src/tools/task.js"
import { verifyTool } from "../src/tools/verify.js"

let root: string
let roots: string[] = []
const ctx = () => ({ root, runner: "test@0" })

function setup(gates: Record<string, { argv: string[], required: boolean }>) {
  root = mkdtempSync(join(tmpdir(), "junto-verify-"))
  roots.push(root)
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates }))
}

function updateConfig(gates: Record<string, { argv: string[], required: boolean }>) {
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates }))
}

const OK = { argv: ["node", "-e", "console.log('het xanh')"], required: true }
const BAD = { argv: ["node", "-e", "console.error('failed'); process.exit(1)"], required: true }

beforeEach(() => {
  roots = []
  setup({ tests: OK })
})

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

describe("verifyTool", () => {
  it("does not include command output when a gate passes", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const out = await verifyTool(ctx(), {})
    expect(out).toMatch(/tests/)
    expect(out).toMatch(/pass/)
    expect(out).not.toMatch(/het xanh/)
  })

  it("returns the output tail when a gate fails", async () => {
    setup({ tests: BAD })
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const out = await verifyTool(ctx(), {})
    expect(out).toMatch(/failed/)
  })

  it("writes the verdict and clears the stale flag in task.json", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = readActiveId(root)!
    const before = readTask(root, id)
    before.gates.tests!.stale = true
    const { writeTask } = await import("@junto/core")
    writeTask(root, before)

    await verifyTool(ctx(), {})
    const after = readTask(root, id)
    expect(after.gates.tests?.verdict).toBe("verdicts/tests.json")
    expect(after.gates.tests?.stale).toBe(false)
  })

  it("increments failStreak on failure and resets it on success", async () => {
    setup({ tests: BAD })
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = readActiveId(root)!
    await verifyTool(ctx(), {})
    await verifyTool(ctx(), {})
    expect(readTask(root, id).gates.tests?.failStreak).toBe(2)
  })

  it("suggests revisiting the plan after three consecutive failures", async () => {
    setup({ tests: BAD })
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    await verifyTool(ctx(), {})
    await verifyTool(ctx(), {})
    const out = await verifyTool(ctx(), {})
    expect(out).toMatch(/plan.*wrong/i)
  })

  it("runs only the requested gate", async () => {
    setup({ tests: OK, lint: BAD })
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const out = await verifyTool(ctx(), { gates: ["tests"] })
    expect(out).toMatch(/tests/)
    expect(out).not.toMatch(/lint/)
  })

  it("reports an error when there is no active task", async () => {
    await expect(verifyTool(ctx(), {})).rejects.toThrow(/no active task/i)
  })

  it("skips a gate with a missing tool and makes clear it did not pass", async () => {
    setup({ audit: { argv: ["junto-command-does-not-exist-xyz"], required: true } })
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const out = await verifyTool(ctx(), {})
    expect(out).toMatch(/skipped/)
    expect(out).toMatch(/does not satisfy|not a pass/i)
  })

  it("leaves failStreak unchanged when a gate is skipped", async () => {
    setup({ tests: BAD })
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = readActiveId(root)!

    await verifyTool(ctx(), {}) // fail -> streak 1
    expect(readTask(root, id).gates.tests?.failStreak).toBe(1)

    updateConfig({ tests: { argv: ["junto-command-does-not-exist-xyz"], required: true } })
    await verifyTool(ctx(), {}) // skipped -> streak remains unchanged
    expect(readTask(root, id).gates.tests?.failStreak).toBe(1)

    updateConfig({ tests: BAD })
    await verifyTool(ctx(), {}) // fail -> streak 2
    expect(readTask(root, id).gates.tests?.failStreak).toBe(2)

    updateConfig({ tests: OK })
    await verifyTool(ctx(), {}) // pass -> reset 0
    expect(readTask(root, id).gates.tests?.failStreak).toBe(0)
  })

  it("preserves completed gate updates when a later gate errors", async () => {
    setup({ tests: OK, "bad/name": BAD })
    await taskTool(ctx(), { action: "start", title: "X", size: "small" })
    const id = readActiveId(root)!

    await expect(verifyTool(ctx(), {})).rejects.toThrow()

    const after = readTask(root, id)
    expect(after.gates.tests?.verdict).toBe("verdicts/tests.json")
    expect(after.gates.tests?.stale).toBe(false)
  })
})
