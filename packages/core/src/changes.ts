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

/** Git could not tell us what changed. Callers must not treat this as "nothing changed". */
export class ChangedFilesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ChangedFilesError"
  }
}

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.junto/**",
  "**/dist/**",
  "**/.temp/**",
]

type Status = ChangedFile["status"]

/** Parse a git status or diff status code into a standard status string. */
function parseStatus(code: string): Status {
  const c = code.trim().toUpperCase()[0]
  switch (c) {
    case "A":
    case "C":
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

  private collect(entries: Array<{ path: string; status: Status }>, ignorePatterns: string[]): ChangedFile[] {
    const combinedIgnore = [...this.defaultIgnore, ...ignorePatterns]
    const results: ChangedFile[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
      const path = normalizePath(entry.path)
      if (path === "" || seen.has(path)) continue
      if (!shouldStale(path, combinedIgnore)) continue
      seen.add(path)
      results.push({ path, status: entry.status })
    }
    return results
  }

  /**
   * Parse text `git diff --name-status` output (tab separated). Paths that contain spaces survive
   * because tabs, not whitespace, delimit fields. Prefer `parseNameStatusZ` for real git output.
   */
  parseNameStatusOutput(output: string, ignorePatterns: string[] = []): ChangedFile[] {
    const entries: Array<{ path: string; status: Status }> = []
    for (const line of output.split(/\r?\n/)) {
      if (line.trim().length === 0) continue
      const parts = line.includes("\t") ? line.split("\t") : line.trim().split(/\s+/)
      if (parts.length < 2) continue
      const [statusCode, ...paths] = parts
      // For renames (R100 old new) the new path is the last field.
      const path = paths[paths.length - 1]
      if (statusCode === undefined || path === undefined) continue
      // Moving a file out of a protected directory still changes that directory.
      if (statusCode.startsWith("R") && paths.length > 1 && paths[0]) {
        entries.push({ path: paths[0], status: "deleted" })
      }
      entries.push({ path, status: parseStatus(statusCode) })
    }
    return this.collect(entries, ignorePatterns)
  }

  /** Parse `git diff --name-status -z`: NUL separated, with two paths for renames and copies. */
  parseNameStatusZ(output: string, ignorePatterns: string[] = []): ChangedFile[] {
    const tokens = output.split("\0")
    const entries: Array<{ path: string; status: Status }> = []
    for (let i = 0; i < tokens.length;) {
      const code = tokens[i]
      if (code === undefined || code === "") { i += 1; continue }
      const pathCount = /^[RC]/.test(code) ? 2 : 1
      const path = tokens[i + pathCount]
      const oldPath = tokens[i + 1]
      if (code.startsWith("R") && oldPath) entries.push({ path: oldPath, status: "deleted" })
      if (path !== undefined && path !== "") entries.push({ path, status: parseStatus(code) })
      i += 1 + pathCount
    }
    return this.collect(entries, ignorePatterns)
  }

  /** Untracked files from `git ls-files --others -z`; they are new to the working tree. */
  parsePathList(output: string, status: Status, ignorePatterns: string[] = []): ChangedFile[] {
    const entries = output.split("\0").filter(p => p !== "").map(path => ({ path, status }))
    return this.collect(entries, ignorePatterns)
  }

  private async git(root: string, args: string[]): Promise<string> {
    const res = await execa("git", args, { cwd: root, reject: false })
    if (res.exitCode !== 0) {
      const detail = typeof res.stderr === "string" && res.stderr.trim() !== "" ? res.stderr.trim() : `exit ${res.exitCode}`
      throw new ChangedFilesError(`git ${args.join(" ")} failed: ${detail}`)
    }
    return typeof res.stdout === "string" ? res.stdout : ""
  }

  /**
   * Resolve changed files from git in the specified repository root. Throws
   * `ChangedFilesError` when git fails: an empty list would look like "nothing to review".
   */
  async resolve(root: string, options: ResolveChangesOptions = {}): Promise<ChangedFile[]> {
    const ignore = options.ignore ?? []

    if (options.base && options.head) {
      const out = await this.git(root, ["diff", "--name-status", "-z", "--find-renames", options.base, options.head])
      return this.parseNameStatusZ(out, ignore)
    }

    // Working tree against `base` (default HEAD) covers committed, staged and unstaged edits.
    let against = options.base
    if (against === undefined) {
      const head = await execa("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, reject: false })
      against = head.exitCode === 0 ? "HEAD" : undefined
    }

    const tracked = against === undefined
      ? this.parsePathList(await this.git(root, ["ls-files", "-z", "--cached"]), "added", ignore)
      : this.parseNameStatusZ(await this.git(root, ["diff", "--name-status", "-z", "--find-renames", against]), ignore)
    const untracked = this.parsePathList(
      await this.git(root, ["ls-files", "-z", "--others", "--exclude-standard"]),
      "added",
      ignore,
    )

    const map = new Map<string, ChangedFile>()
    for (const item of tracked) map.set(item.path, item)
    for (const item of untracked) if (!map.has(item.path)) map.set(item.path, item)
    return Array.from(map.values())
  }
}
