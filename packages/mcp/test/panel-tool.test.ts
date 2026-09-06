import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readActiveId, readTask } from "@junto/core"
import { taskTool } from "../src/tools/task.js"
import { panelTool } from "../src/tools/panel.js"

let root: string
const roots: string[] = []
const ctx = () => ({ root, runner: "test@0" })

function writeConfig(config: Record<string, unknown>) {
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates: {}, ...config }))
}

function setup() {
  root = mkdtempSync(join(tmpdir(), "junto-panel-"))
  roots.push(root)
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeConfig({ backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY" }, openai: { apiKeyEnv: "JUNTO_TEST_KEY" } } })
}

beforeEach(() => {
  process.env.JUNTO_TEST_KEY = "sk-test"
  setup()
})

afterEach(() => {
  delete process.env.JUNTO_TEST_KEY
  vi.unstubAllGlobals()
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** anthropic roles succeed; the openai role (adversary) fails with a 500. */
function mockMixedBackends() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("anthropic")) {
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "anthropic says yes" }],
          usage: { input_tokens: 10, output_tokens: 10 },
          model: "claude-sonnet-5",
        }),
      }
    }
    return { ok: false, status: 500, text: async () => "openai is down" }
  }))
}

describe("panelTool", () => {
  it("runs every built-in role and isolates one provider's failure from the rest", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "deep" })
    mockMixedBackends()
    const out = await panelTool(ctx(), { question: "Review this plan" })
    expect(out).toMatch(/architect - ok/)
    expect(out).toMatch(/adversary - failed/)
    expect(out).toMatch(/pragmatist - ok/)
    expect(out).toMatch(/reviewer - ok/)

    const id = readActiveId(root)
    if (id === null) throw new Error("Test requires an active task")
    // architect, pragmatist, reviewer succeed (anthropic); adversary fails (openai) -> 3 files.
    expect(readTask(root, id).consults).toHaveLength(3)
  })

  it("stops spending budget once the cap is reached mid-panel", async () => {
    writeConfig({
      backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY" }, openai: { apiKeyEnv: "JUNTO_TEST_KEY" } },
      consultBudget: { maxTokensPerTask: 15 },
    })
    await taskTool(ctx(), { action: "start", title: "X", size: "deep" })
    mockMixedBackends()
    const out = await panelTool(ctx(), { question: "Review this plan", roles: ["architect", "pragmatist"] })
    expect(out).toMatch(/architect - ok/)
    expect(out).toMatch(/pragmatist - failed/)
    expect(out).toMatch(/budget/i)
  })

  it("reports a single clear error when there is no active task", async () => {
    await expect(panelTool(ctx(), { question: "?" })).rejects.toThrow(/no active task/i)
  })

  it("accepts an explicit, smaller role list", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "deep" })
    mockMixedBackends()
    const out = await panelTool(ctx(), { question: "?", roles: ["architect"] })
    expect(out).toMatch(/architect - ok/)
    expect(out).not.toMatch(/adversary/)
  })
})
