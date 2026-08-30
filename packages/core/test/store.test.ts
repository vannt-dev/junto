import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { findProjectRoot, readActiveId, readConfig, readTask, setActiveId, writeTask } from "../src/store.js"
import type { Config, Task } from "../src/schema.js"

let root: string
const tmpDirs: string[] = []

/** mkdtemp có theo dõi, để afterEach dọn hết — kể cả thư mục tạo trong từng test lẻ. */
function mktemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

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
  root = mktemp("junto-")
  mkdirSync(join(root, ".junto", "tasks", "2026-08-30-x"), { recursive: true })
})

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("findProjectRoot", () => {
  it("tìm được từ thư mục con lồng sâu", () => {
    const deep = join(root, "a", "b", "c")
    mkdirSync(deep, { recursive: true })
    expect(findProjectRoot(deep)).toBe(root)
  })

  it("trả null khi không có .junto ở đâu cả", () => {
    const orphan = mktemp("junto-none-")
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

  it("ghi đè đúng nội dung khi ghi hợp lệ hai lần liên tiếp (đi qua nhánh rename đè)", () => {
    writeTask(root, task)
    writeTask(root, { ...task, title: "Y" })
    expect(readTask(root, task.id).title).toBe("Y")
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

describe("readConfig", () => {
  it("đọc đúng config.json hợp lệ, giữ nguyên trường lạ nhờ .passthrough()", () => {
    const raw = {
      schemaVersion: 1,
      gates: { lint: { argv: ["pnpm", "lint"], required: true } },
      staleIgnore: ["**/*.md"],
      autoApprove: ["small"],
      futureField: "trường lạ của M2, phải sống sót qua parseConfig",
    }
    writeFileSync(join(root, ".junto", "config.json"), JSON.stringify(raw))

    const config = readConfig(root)

    expect(config.gates.lint?.argv).toEqual(["pnpm", "lint"])
    expect(config.staleIgnore).toEqual(["**/*.md"])
    expect((config as Config & { futureField?: string }).futureField).toBe(
      "trường lạ của M2, phải sống sót qua parseConfig",
    )
  })

  it("ném lỗi khi config.json không tồn tại (hành vi hiện tại — ENOENT thô, chưa qua xử lý mềm)", () => {
    expect(() => readConfig(root)).toThrow()
  })
})
