import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { juntoDir, taskDir } from "./paths.js"
import { parseConfig, parseTask, type Config, type Task } from "./schema.js"

export * from "./paths.js"

/** Atomic write: validate first, write a sibling .tmp file, then rename over the target. */
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

const LOCK_RETRY_MS = 5
const LOCK_ATTEMPTS = 50
const STALE_LOCK_MS = 30_000
const lockWaiter = new Int32Array(new SharedArrayBuffer(4))

function withTaskLock<T>(root: string, id: string, fn: () => T): T {
  const dir = taskDir(root, id)
  if (!existsSync(join(dir, "task.json"))) {
    throw new Error(`Task "${id}" was not found for update.`)
  }
  const lock = join(dir, "task.json.lock")

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    let fd: number
    try {
      fd = openSync(lock, "wx")
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EEXIST") throw error
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) {
          rmSync(lock, { force: true })
          continue
        }
      } catch {
        continue
      }
      Atomics.wait(lockWaiter, 0, 0, LOCK_RETRY_MS)
      continue
    }

    try {
      return fn()
    } finally {
      closeSync(fd)
      rmSync(lock, { force: true })
    }
  }
  throw new Error(`Task "${id}" is being updated by another process. Try again.`)
}

export function readConfig(root: string): Config {
  const path = join(juntoDir(root), "config.json")
  if (!existsSync(path)) {
    throw new Error(
      "Missing .junto/config.json. Run /junto:start to initialize and confirm the project's quality gates.",
    )
  }
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

/** Validate before touching disk so invalid state never overwrites valid state. */
export function writeTask(root: string, task: Task): void {
  const next = parseTask({ ...task, updatedAt: new Date().toISOString() })
  const dir = taskDir(root, next.id)
  mkdirSync(dir, { recursive: true })
  writeJsonAtomic(join(dir, "task.json"), next)
}

/** Read, modify, and write under one lock so concurrent hooks cannot lose updates. */
export function updateTask(root: string, id: string, update: (task: Task) => boolean | void): Task {
  return withTaskLock(root, id, () => {
    const task = readTask(root, id)
    if (update(task) === false) return task
    writeTask(root, task)
    return readTask(root, id)
  })
}
