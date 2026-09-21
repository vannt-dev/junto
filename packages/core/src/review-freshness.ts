import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, realpathSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { taskDir } from "./paths.js"
import type { Config, Task } from "./schema.js"

const IGNORED_UNTRACKED = new Set(["node_modules", "dist", "build", ".temp", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"])
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex")

function fileDigest(path: string): string {
  const fd = openSync(path, "r")
  try {
    const hash = createHash("sha256")
    const buffer = Buffer.alloc(65536)
    let count: number
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count))
    return hash.digest("hex")
  } finally { closeSync(fd) }
}

/** Bind review evidence to source and policy without storing source text or reading environment files. */
export function captureReviewFingerprint(root: string, task: Task, config: Config): string {
  const canonicalRoot = realpathSync(root)
  const git = (...args: string[]): Buffer => execFileSync("git", args, {
    cwd: root, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  })
  if (realpathSync(git("rev-parse", "--show-toplevel").toString().trim()) !== canonicalRoot) {
    throw new Error("Review root must be the Git repository root")
  }
  let head: string | null = null
  // An unborn repository is valid; other Git failures still fail the enumeration below.
  try { head = git("rev-parse", "--verify", "HEAD").toString().trim() } catch { /* no HEAD yet */ }
  const index = git("ls-files", "--stage", "-z")
  const tracked = new Set(index.toString("utf8").split("\0").filter(Boolean).map(entry => entry.slice(entry.indexOf("\t") + 1)))
  const paths = new Set([...tracked, ...git("ls-files", "--others", "--exclude-standard", "-z").toString("utf8").split("\0").filter(Boolean)])
  const files: Array<[string, number | null, string]> = []
  for (const path of [...paths].sort()) {
    const parts = path.split("/")
    if (parts[0] === ".junto" || basename(path) === ".env" || basename(path).startsWith(".env.")) continue
    if (!tracked.has(path) && parts.some(part => IGNORED_UNTRACKED.has(part))) continue
    const full = resolve(canonicalRoot, path)
    const rel = relative(canonicalRoot, full)
    if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) throw new Error("Source path escapes review root")
    let stat
    try { stat = lstatSync(full) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      files.push([path, null, "deleted"])
      continue
    }
    if (stat.isSymbolicLink()) files.push([path, stat.mode, digest(readlinkSync(full))])
    else if (stat.isFile()) {
      const target = relative(canonicalRoot, realpathSync(full))
      if (target === ".." || target.startsWith("../") || target.startsWith("..\\") || isAbsolute(target)) throw new Error("Source path escapes review root")
      files.push([path, stat.mode, fileDigest(full)])
    } else throw new Error("Review fingerprints do not support source directories or submodules")
  }
  const context = ["brief.md", "plan.md", "review-background.md"].map(name => {
    const path = join(taskDir(root, task.id), name)
    return existsSync(path) ? digest(readFileSync(path)) : null
  })
  return digest(JSON.stringify({ version: 1, head, index: digest(index), files,
    base: task.baseCommit, title: task.title, context, config }))
}
