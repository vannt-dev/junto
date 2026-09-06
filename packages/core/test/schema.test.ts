import { describe, expect, it } from "vitest"
import { DEFAULT_STALE_IGNORE, parseConfig, parseTask, SchemaVersionError } from "../src/schema.js"

const validTask = {
  schemaVersion: 1,
  id: "2026-08-30-add-jwt",
  title: "Add JWT",
  size: "standard",
  phase: "build",
  baseCommit: null,
  createdAt: "2026-08-30T09:00:00Z",
  updatedAt: "2026-08-30T09:00:00Z",
  phases: { build: { status: "active" } },
  gates: { tests: { required: true, verdict: null, stale: false, failStreak: 0 } },
  decisions: [],
  consults: [],
}

describe("parseTask", () => {
  it("accepts a valid task", () => {
    expect(parseTask(validTask).id).toBe("2026-08-30-add-jwt")
  })

  it("rejects a schemaVersion newer than the code without guessing", () => {
    expect(() => parseTask({ ...validTask, schemaVersion: 2 })).toThrow(SchemaVersionError)
  })

  it("reports both versions in the error", () => {
    try {
      parseTask({ ...validTask, schemaVersion: 7 })
      expect.unreachable("expected an error")
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaVersionError)
      expect((e as SchemaVersionError).found).toBe(7)
      expect((e as SchemaVersionError).supported).toBe(1)
    }
  })

  it("rejects an unknown size", () => {
    expect(() => parseTask({ ...validTask, size: "huge" })).toThrow()
  })

  it("defaults consultTokensUsed to 0 when absent (old task.json files)", () => {
    expect(parseTask(validTask).consultTokensUsed).toBe(0)
  })

  it("accepts an explicit consultTokensUsed", () => {
    expect(parseTask({ ...validTask, consultTokensUsed: 4200 }).consultTokensUsed).toBe(4200)
  })
})

describe("parseConfig", () => {
  it("preserves fields unknown to this version of junto", () => {
    const cfg = parseConfig({
      schemaVersion: 1,
      gates: {},
      staleIgnore: [],
      autoApprove: [],
      aFutureFieldNotYetDefined: { anything: true },
    }) as Record<string, unknown>
    expect(cfg.aFutureFieldNotYetDefined).toEqual({ anything: true })
  })

  it("fills in the default staleIgnore when omitted", () => {
    const cfg = parseConfig({ schemaVersion: 1, gates: {} })
    expect(cfg.staleIgnore).toEqual(DEFAULT_STALE_IGNORE)
  })

  it("accepts a full backends/roles/consultBudget block", () => {
    const cfg = parseConfig({
      schemaVersion: 1,
      gates: {},
      backends: {
        anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY", model: "claude-sonnet-5", timeoutMs: 60000 },
        openai: { apiKeyEnv: "OPENAI_API_KEY" },
      },
      roles: { adversary: { provider: "openai" } },
      consultBudget: { maxTokensPerTask: 200000 },
    })
    expect(cfg.backends?.anthropic?.apiKeyEnv).toBe("ANTHROPIC_API_KEY")
    expect(cfg.roles?.adversary?.provider).toBe("openai")
    expect(cfg.consultBudget?.maxTokensPerTask).toBe(200000)
  })

  it("omits backends/roles/consultBudget cleanly when absent", () => {
    const cfg = parseConfig({ schemaVersion: 1, gates: {} })
    expect(cfg.backends).toBeUndefined()
    expect(cfg.roles).toBeUndefined()
    expect(cfg.consultBudget).toBeUndefined()
  })

  it("rejects a backend spec carrying a literal key value instead of an env var name", () => {
    expect(() => parseConfig({
      schemaVersion: 1,
      gates: {},
      backends: { anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY", apiKey: "sk-live-secret" } },
    })).toThrow()
  })

  it("rejects an unknown provider name in a role entry", () => {
    expect(() => parseConfig({
      schemaVersion: 1,
      gates: {},
      roles: { adversary: { provider: "cohere" } },
    })).toThrow()
  })
})
