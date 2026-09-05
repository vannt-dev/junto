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
})

describe("parseConfig", () => {
  it("preserves M2 fields unknown to M1", () => {
    const cfg = parseConfig({
      schemaVersion: 1,
      gates: {},
      staleIgnore: [],
      autoApprove: [],
      roles: { architect: "gpt-5" },
    }) as Record<string, unknown>
    expect(cfg.roles).toEqual({ architect: "gpt-5" })
  })

  it("fills in the default staleIgnore when omitted", () => {
    const cfg = parseConfig({ schemaVersion: 1, gates: {} })
    expect(cfg.staleIgnore).toEqual(DEFAULT_STALE_IGNORE)
  })
})
