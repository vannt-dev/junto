import { existsSync } from "node:fs"
import { dirname, join, parse } from "node:path"

export const JUNTO_DIR = ".junto"

/** Đường dẫn tương đối (so với project root) mà guard.ts từ chối cho model ghi. */
export const PROTECTED_GLOBS = [
  ".junto/active",
  ".junto/tasks/*/task.json",
  ".junto/tasks/*/verdicts/**",
]

export function juntoDir(root: string): string {
  return join(root, JUNTO_DIR)
}

export function taskDir(root: string, id: string): string {
  return join(juntoDir(root), "tasks", id)
}

/** Đi lên từ `from` tìm thư mục chứa `.junto/`. Trả null nếu tới gốc ổ đĩa vẫn không thấy. */
export function findProjectRoot(from: string): string | null {
  const stopAt = parse(from).root
  let dir = from
  for (;;) {
    if (existsSync(join(dir, JUNTO_DIR))) return dir
    if (dir === stopAt) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
