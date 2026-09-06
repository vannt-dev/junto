import { existsSync, statSync } from "node:fs"
import { dirname, join, parse } from "node:path"

export const JUNTO_DIR = ".junto"

/** Project-relative paths that guard.ts prevents the model from writing. */
export const PROTECTED_GLOBS = [
  ".junto/active",
  ".junto/tasks/*/task.json*",
  ".junto/tasks/*/verdicts/**",
  ".junto/tasks/*/consults/**",
]

export function juntoDir(root: string): string {
  return join(root, JUNTO_DIR)
}

export function taskDir(root: string, id: string): string {
  return join(juntoDir(root), "tasks", id)
}

/** Walk upward from `from` to find `.junto/`; return null at the filesystem root. */
export function findProjectRoot(from: string): string | null {
  const stopAt = parse(from).root
  let dir = from
  for (;;) {
    const candidate = join(dir, JUNTO_DIR)
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) return dir
      } catch {
        // The path may disappear between existsSync and statSync; continue upward.
      }
    }
    if (dir === stopAt) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
