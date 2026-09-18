import { execa } from "execa"
import { shouldStale } from "./stale.js"

export interface ChangedFile {
  path: string
  status: "added" | "modified" | "deleted" | "renamed"
}

export interface ResolveChangesOptions {
  base?: string
  head?: string
  ignore?: string[]
}

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.junto/**",
  "**/dist/**",
  "**/.temp/**",
]

/** Parse a git status or diff status code into a standard status string. */
function parseStatus(code: string): "added" | "modified" | "deleted" | "renamed" {
  const c = code.trim().toUpperCase()[0]
  switch (c) {
    case "A":
    case "?":
      return "added"
    case "D":
      return "deleted"
    case "R":
      return "renamed"
    default:
      return "modified"
  }
}

/** Normalize file path to forward slashes without leading ./ */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "")
}

export class ChangedFileResolver {
  constructor(private readonly defaultIgnore: string[] = DEFAULT_IGNORE) {}

  /**
   * Parse raw git diff name-status output lines.
   */
  parseNameStatusOutput(output: string, ignorePatterns: string[] = []): ChangedFile[] {
    const combinedIgnore = [...this.defaultIgnore, ...ignorePatterns]
    const lines = output.split(/\r?\n/).filter(line => line.trim().length > 0)
    const results: ChangedFile[] = []
    const seen = new Set<string>()

    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 2) continue

      const statusChar = parts[0]
      // In case of rename (R100 old new), the new path is the last element
      const rawPath = parts[parts.length - 1]
      const path = normalizePath(rawPath)

      if (seen.has(path)) continue
      if (!shouldStale(path, combinedIgnore)) continue

      seen.add(path)
      results.push({
        path,
        status: parseStatus(statusChar),
      })
    }

    return results
  }

  /**
   * Resolve changed files from git in the specified repository root.
   */
  async resolve(root: string, options: ResolveChangesOptions = {}): Promise<ChangedFile[]> {
    const ignore = options.ignore ?? []
    try {
      if (options.base && options.head) {
        const { stdout } = await execa("git", ["diff", "--name-status", options.base, options.head], { cwd: root })
        return this.parseNameStatusOutput(stdout, ignore)
      } else if (options.base) {
        const { stdout } = await execa("git", ["diff", "--name-status", options.base], { cwd: root })
        return this.parseNameStatusOutput(stdout, ignore)
      }

      // Default: inspect unstaged + staged changes against HEAD
      const { stdout: diffStdout } = await execa("git", ["diff", "--name-status", "HEAD"], { cwd: root })
      const diffResults = this.parseNameStatusOutput(diffStdout, ignore)

      // Also pick up untracked files with status porcelain
      const { stdout: statusStdout } = await execa("git", ["status", "--porcelain"], { cwd: root })
      const statusResults = this.parseNameStatusOutput(statusStdout, ignore)

      // Merge results deduplicated by path
      const map = new Map<string, ChangedFile>()
      for (const item of diffResults) map.set(item.path, item)
      for (const item of statusResults) {
        if (!map.has(item.path)) map.set(item.path, item)
      }

      return Array.from(map.values())
    } catch {
      return []
    }
  }
}
