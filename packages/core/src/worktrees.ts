import { execa } from "execa"

export interface Worktree {
  path: string
  /** Short branch name, or null for a detached HEAD. */
  branch: string | null
  head: string | null
}

/** Parse `git worktree list --porcelain`: blank-line separated blocks, bare repositories skipped. */
export function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = []
  for (const block of output.split(/\r?\n\r?\n/)) {
    let path: string | null = null
    let branch: string | null = null
    let head: string | null = null
    let bare = false
    for (const line of block.split(/\r?\n/)) {
      const space = line.indexOf(" ")
      const key = space === -1 ? line : line.slice(0, space)
      const value = space === -1 ? "" : line.slice(space + 1)
      if (key === "worktree") path = value
      else if (key === "branch") branch = value.replace(/^refs\/heads\//, "")
      else if (key === "HEAD") head = value
      else if (key === "bare") bare = true
    }
    if (path !== null && !bare) worktrees.push({ path, branch, head })
  }
  return worktrees
}

/** Every checkout of the repository that contains `root`, the main worktree first. */
export async function listWorktrees(root: string): Promise<Worktree[]> {
  const res = await execa("git", ["worktree", "list", "--porcelain"], { cwd: root, reject: false, timeout: 30_000 })
  if (res.exitCode !== 0) throw new Error(`Cannot list Git worktrees: ${res.stderr.trim() || "not a Git repository"}`)
  return parseWorktreeList(res.stdout)
}

/** The Git top level of `root`, so a `.junto/` below it maps to the same offset in other worktrees. */
export async function gitTopLevel(root: string): Promise<string | null> {
  const res = await execa("git", ["rev-parse", "--show-toplevel"], { cwd: root, reject: false, timeout: 30_000 })
  return res.exitCode === 0 ? res.stdout.trim() : null
}
