import { describe, expect, it } from "vitest"
import { DEFAULT_STALE_IGNORE, parseConfig, parseTask, SchemaVersionError } from "../src/schema.js"

const validTask = {
  schemaVersion: 1,
  id: "2026-08-30-add-jwt",
  title: "Thêm JWT",
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
  it("chấp nhận task hợp lệ", () => {
    expect(parseTask(validTask).id).toBe("2026-08-30-add-jwt")
  })

  it("từ chối schemaVersion mới hơn code, không đoán", () => {
    expect(() => parseTask({ ...validTask, schemaVersion: 2 })).toThrow(SchemaVersionError)
  })

  it("nêu rõ hai phiên bản trong lỗi", () => {
    try {
      parseTask({ ...validTask, schemaVersion: 7 })
      expect.unreachable("lẽ ra phải ném")
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaVersionError)
      expect((e as SchemaVersionError).found).toBe(7)
      expect((e as SchemaVersionError).supported).toBe(1)
    }
  })

  it("từ chối size lạ", () => {
    expect(() => parseTask({ ...validTask, size: "huge" })).toThrow()
  })
})

describe("parseConfig", () => {
  it("giữ nguyên trường của M2 mà M1 chưa biết", () => {
    const cfg = parseConfig({
      schemaVersion: 1,
      gates: {},
      staleIgnore: [],
      autoApprove: [],
      roles: { architect: "gpt-5" },
    }) as Record<string, unknown>
    expect(cfg.roles).toEqual({ architect: "gpt-5" })
  })

  it("điền staleIgnore mặc định khi thiếu", () => {
    const cfg = parseConfig({ schemaVersion: 1, gates: {} })
    expect(cfg.staleIgnore).toEqual(DEFAULT_STALE_IGNORE)
  })
})
