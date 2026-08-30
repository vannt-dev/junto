import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { juntoDir, taskDir } from "./paths.js"
import { parseConfig, parseTask, type Config, type Task } from "./schema.js"

export * from "./paths.js"

/** Ghi nguyên tử: validate trước, ghi ra .tmp cùng thư mục, rồi rename đè. */
function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
  try {
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

export function readConfig(root: string): Config {
  const path = join(juntoDir(root), "config.json")
  return parseConfig(JSON.parse(readFileSync(path, "utf-8")))
}

export function readActiveId(root: string): string | null {
  const path = join(juntoDir(root), "active")
  if (!existsSync(path)) return null
  const id = readFileSync(path, "utf-8").trim()
  return id === "" ? null : id
}

export function setActiveId(root: string, id: string | null): void {
  const path = join(juntoDir(root), "active")
  if (id === null) {
    rmSync(path, { force: true })
    return
  }
  mkdirSync(juntoDir(root), { recursive: true })
  writeFileSync(path, `${id}\n`, "utf-8")
}

export function readTask(root: string, id: string): Task {
  const path = join(taskDir(root, id), "task.json")
  return parseTask(JSON.parse(readFileSync(path, "utf-8")))
}

/** Validate TRƯỚC khi chạm đĩa — task hỏng không bao giờ ghi đè task tốt. */
export function writeTask(root: string, task: Task): void {
  const next = parseTask({ ...task, updatedAt: new Date().toISOString() })
  const dir = taskDir(root, next.id)
  mkdirSync(dir, { recursive: true })
  writeJsonAtomic(join(dir, "task.json"), next)
}
