import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readActiveId, readTask, taskDir } from "@junto/core"
import { taskTool } from "../src/tools/task.js"
import { consultTool } from "../src/tools/consult.js"

let root: string
const roots: string[] = []
const ctx = () => ({ root, runner: "test@0" })

function setup(config: Record<string, unknown>) {
  root = mkdtempSync(join(tmpdir(), "junto-consult-"))
  roots.push(root)
  mkdirSync(join(root, ".junto"), { recursive: true })
  writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates: {}, ...config }))
}

function mockAnthropicSuccess(text: string, tokens = 100) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      content: [{ type: "text", text }],
      usage: { input_tokens: tokens, output_tokens: 0 },
      model: "claude-sonnet-5",
    }),
  }))
}

beforeEach(() => {
  process.env.JUNTO_TEST_KEY = "sk-test"
  setup({ backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY" } } })
})

afterEach(() => {
  delete process.env.JUNTO_TEST_KEY
  vi.unstubAllGlobals()
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

describe("consultTool", () => {
  it("writes a consult file and updates task.consultTokensUsed", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    mockAnthropicSuccess("go ahead")
    const out = await consultTool(ctx(), { role: "architect", question: "Is this sound?" })
    expect(out).toMatch(/architect/)

    const id = readActiveId(root)
    if (id === null) throw new Error("Test requires an active task")
    const task = readTask(root, id)
    expect(task.consultTokensUsed).toBe(100)
    expect(task.consults).toHaveLength(1)
    const relPath = task.consults[0]
    expect(relPath).toMatch(/^consults\/001-architect\.md$/)
    const content = readFileSync(join(taskDir(root, id), relPath ?? ""), "utf-8")
    expect(content).toMatch(/go ahead/)
    expect(content).toMatch(/role: architect/)
  })

  it("reports an error when there is no active task", async () => {
    mockAnthropicSuccess("x")
    await expect(consultTool(ctx(), { role: "architect", question: "?" })).rejects.toThrow(/no active task/i)
  })

  it("refuses without calling the network once the budget is exhausted", async () => {
    setup({ backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY" } }, consultBudget: { maxTokensPerTask: 50 } })
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    const id = readActiveId(root)
    if (id === null) throw new Error("Test requires an active task")
    // Preset usage at the cap — a fresh task starts at 0, which the cap check would not reject,
    // so this test must simulate a task that already spent its budget in an earlier call.
    const { updateTask } = await import("@junto/core")
    updateTask(root, id, (t) => { t.consultTokensUsed = 50 })

    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(consultTool(ctx(), { role: "architect", question: "?" })).rejects.toThrow(/budget/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reports a clear error naming the missing environment variable", async () => {
    setup({ backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY_MISSING" } } })
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    await expect(consultTool(ctx(), { role: "architect", question: "?" }))
      .rejects.toThrow(/JUNTO_TEST_KEY_MISSING/)
  })

  it("rejects an unknown role", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    await expect(consultTool(ctx(), { role: "philosopher", question: "?" })).rejects.toThrow(/unknown role/i)
  })

  it("rejects a role name that could escape the consults directory", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(consultTool(ctx(), { role: "../../../evil", question: "?" }))
      .rejects.toThrow(/invalid role name/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("includes brief.md and plan.md content in the request", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "standard" })
    const id = readActiveId(root)
    if (id === null) throw new Error("Test requires an active task")
    writeFileSync(join(taskDir(root, id), "brief.md"), "Add JWT auth.", "utf-8")
    writeFileSync(join(taskDir(root, id), "plan.md"), "1. Add jose dependency.", "utf-8")
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: "claude-sonnet-5",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    await consultTool(ctx(), { role: "architect", question: "Sound?" })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { messages: { content: string }[] }
    expect(body.messages[0]?.content).toMatch(/Add JWT auth/)
    expect(body.messages[0]?.content).toMatch(/Add jose dependency/)
  })
})
