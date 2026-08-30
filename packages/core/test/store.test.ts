import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { findProjectRoot, readActiveId, readTask, setActiveId, writeTask } from "../src/store.js"
import type { Task } from "../src/schema.js"

let root: string

const task: Task = {
  schemaVersion: 1,
  id: "2026-08-30-x",
  title: "X",
  size: "small",
  phase: "build",
  baseCommit: null,
  createdAt: "2026-08-30T09:00:00Z",
  updatedAt: "2026-08-30T09:00:00Z",
  phases: { build: { status: "active" } },
  gates: {},
  decisions: [],
  consults: [],
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "junto-"))
  mkdirSync(join(root, ".junto", "tasks", "2026-08-30-x"), { recursive: true })
})

describe("findProjectRoot", () => {
  it("tìm được từ thư mục con lồng sâu", () => {
    const deep = join(root, "a", "b", "c")
    mkdirSync(deep, { recursive: true })
    expect(findProjectRoot(deep)).toBe(root)
  })

  it("trả null khi không có .junto ở đâu cả", () => {
    const orphan = mkdtempSync(join(tmpdir(), "junto-none-"))
    expect(findProjectRoot(orphan)).toBeNull()
  })
})

describe("task round-trip", () => {
  it("ghi rồi đọc lại ra đúng task", () => {
    writeTask(root, task)
    expect(readTask(root, task.id).title).toBe("X")
  })

  it("cập nhật updatedAt mỗi lần ghi", () => {
    writeTask(root, task)
    const after = readTask(root, task.id)
    expect(after.updatedAt).not.toBe(task.updatedAt)
  })

  it("không để lại file tạm sau khi ghi", () => {
    writeTask(root, task)
    expect(existsSync(join(root, ".junto", "tasks", task.id, "task.json.tmp"))).toBe(false)
  })

  it("giữ nguyên file cũ nếu nội dung mới không hợp lệ", () => {
    writeTask(root, task)
    const bad = { ...task, size: "huge" } as unknown as Task
    expect(() => writeTask(root, bad)).toThrow()
    expect(readTask(root, task.id).size).toBe("small")
  })
})

describe("active", () => {
  it("null khi chưa có file active", () => {
    expect(readActiveId(root)).toBeNull()
  })

  it("ghi rồi đọc lại", () => {
    setActiveId(root, "2026-08-30-x")
    expect(readActiveId(root)).toBe("2026-08-30-x")
  })

  it("xoá được bằng null", () => {
    setActiveId(root, "2026-08-30-x")
    setActiveId(root, null)
    expect(readActiveId(root)).toBeNull()
  })

  it("bỏ qua khoảng trắng thừa trong file", () => {
    writeFileSync(join(root, ".junto", "active"), "  2026-08-30-x \n")
    expect(readActiveId(root)).toBe("2026-08-30-x")
  })
})
