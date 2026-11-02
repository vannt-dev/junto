import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readActiveId, readTask } from "@junto/core"
import { taskTool } from "../src/tools/task.js"
import { panelTool } from "../src/tools/panel.js"
import { statusTool } from "../src/tools/status.js"

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
    expect(out).toMatch(/pragmatist - skipped/)
    expect(out).toMatch(/budget/i)
  })

  it("reports a provider error that mentions a budget as failed, not as junto's own skip", async () => {
    await taskTool(ctx(), { action: "start", title: "X", size: "deep" })
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 429, text: async () => "Your organization's monthly budget exhausted",
    })))
    const out = await panelTool(ctx(), { question: "?", roles: ["architect"] })
    expect(out).toMatch(/architect - failed/)
    expect(out).not.toMatch(/skipped/)
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

  it("persists one bounded context snapshot for the whole panel", async () => {
    writeConfig({
      backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY" }, openai: { apiKeyEnv: "JUNTO_TEST_KEY" } },
      consultContext: { enabled: true, maxChars: 12000, persist: true },
    })
    await taskTool(ctx(), { action: "start", title: "X", size: "deep" })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: "claude-sonnet-5",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const out = await panelTool(ctx(), {
      question: "Review this implementation",
      roles: ["architect", "reviewer"],
      context: {
        source: "code-review-graph",
        purpose: "review",
        summary: "Changed parser; callers and tests are listed.",
        files: ["src/parser.ts", "test/parser.test.ts"],
      },
    })

    expect(out).toMatch(/Context: contexts\/001-review\.json/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit]
      const body = JSON.parse(init.body as string) as { messages: { content: string }[] }
      expect(body.messages[0]?.content).toContain("Changed parser")
    }
    const id = readActiveId(root)
    if (id === null) throw new Error("Test requires an active task")
    expect(readdirSync(join(root, ".junto", "tasks", id, "contexts"))).toEqual(["001-review.json"])
  })

  it("puts a digest first, saves it under panels/ and shows it in status", async () => {
    writeConfig({
      backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY" }, openai: { apiKeyEnv: "JUNTO_TEST_KEY" } },
      consultBudget: { maxTokensPerTask: 50 },
    })
    await taskTool(ctx(), { action: "start", title: "X", size: "deep" })
    const answers = [
      "## Findings\n\n- high | src/parser.ts:42 | Empty input throws.\n\nVerdict: concerns",
      "## Findings\n\n- medium | src/parser.ts:42 | parse('') crashes.\n- low | - | Add a test.\n\nVerdict: approve",
    ]
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: answers.shift() ?? "no format" }],
        usage: { input_tokens: 15, output_tokens: 15 },
        model: "claude-sonnet-5",
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const out = await panelTool(ctx(), { question: "Review this plan", roles: ["architect", "reviewer", "pragmatist"] })

    expect(out.startsWith("## Panel digest")).toBe(true)
    expect(out).toContain("Ran 2 of 3 roles: architect, reviewer.")
    expect(out).toContain("- Skipped pragmatist: Consult budget exhausted")
    expect(out).toContain("1. [high] src/parser.ts:42 - Empty input throws. (raised by 2 of 2: architect, reviewer)")
    expect(out).toContain("Verdicts differ: architect concerns, reviewer approve.")
    expect(out).toContain("Digest saved to panels/001-digest.md.")
    // The per-role sections stay after the digest.
    expect(out).toMatch(/## architect - ok\nSaved to consults\/001-architect\.md/)
    expect(out).toMatch(/## pragmatist - skipped/)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { messages: { content: string }[] }
    expect(body.messages[0]?.content).toContain("## Answer format")

    const id = readActiveId(root)
    if (id === null) throw new Error("Test requires an active task")
    const saved = readFileSync(join(root, ".junto", "tasks", id, "panels", "001-digest.md"), "utf-8")
    expect(saved).toContain("summary: 2 of 3 roles ran, 1 skipped; 2 findings (1 high, 1 low), 2 disagreement(s)")
    expect(saved).toContain("## Question\n\nReview this plan")
    expect(readTask(root, id).consults).toEqual(["consults/001-architect.md", "consults/002-reviewer.md"])

    expect(await statusTool(ctx())).toContain(
      "Last panel: panels/001-digest.md (2 of 3 roles ran, 1 skipped; 2 findings (1 high, 1 low), 2 disagreement(s))",
    )
    await panelTool(ctx(), { question: "Again", roles: ["architect"] })
    expect(await statusTool(ctx())).toContain("Last panel: panels/002-digest.md (0 of 1 roles ran, 1 skipped; 0 findings)")
  })
})
