import { execa } from "execa"
import type { Task } from "./schema.js"

/** The base branch tip that verify evidence was checked against. */
export interface VerifyBase {
  /** Full ref name, for example `refs/remotes/origin/main`. */
  ref: string
  commit: string
}

export interface BaseDrift {
  /** Short ref name for messages, for example `origin/main`. */
  ref: string
  /** Commits added to the base since verify that the branch does not contain. */
  newCommits: number
}

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const res = await execa("git", args, { cwd: root, reject: false, timeout: 30_000 })
    return res.exitCode === 0 ? res.stdout.trim() : null
  } catch {
    return null
  }
}

/**
 * The remote default branch: `origin/HEAD` when the clone recorded it, else `origin/main` or
 * `origin/master`. Remote-tracking refs move only on the user's fetch; junto never fetches.
 */
async function baseRef(root: string): Promise<string | null> {
  const head = await git(root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
  if (head) return head
  for (const ref of ["refs/remotes/origin/main", "refs/remotes/origin/master"]) {
    if (await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) return ref
  }
  return null
}

/** Record the base tip at verify time; null when no remote base exists, so nothing is checked later. */
export async function captureVerifyBase(root: string): Promise<VerifyBase | null> {
  const ref = await baseRef(root)
  if (ref === null) return null
  const commit = await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
  return commit ? { ref, commit } : null
}

/**
 * Did the base move past the recorded tip with commits the branch does not contain? A clean Git
 * merge can still combine into broken code, so evidence from before the move no longer covers it.
 * Returns null when nothing was recorded, the ref is gone, or the branch already contains the tip.
 */
export async function baseDrift(root: string, base: VerifyBase | null | undefined): Promise<BaseDrift | null> {
  if (!base) return null
  const tip = await git(root, ["rev-parse", "--verify", "--quiet", `${base.ref}^{commit}`])
  if (tip === null || tip === base.commit) return null
  const contained = await execa("git", ["merge-base", "--is-ancestor", tip, "HEAD"], { cwd: root, reject: false })
    .then(res => res.exitCode === 0, () => false)
  if (contained) return null
  const count = Number(await git(root, ["rev-list", "--count", `${base.commit}..${tip}`]))
  return { ref: base.ref.replace(/^refs\/remotes\//, ""), newCommits: Number.isFinite(count) ? count : 0 }
}

/**
 * The largest drift among the bases that current evidence was verified against. Stale or missing
 * verdicts are skipped: they must be rerun anyway, and the rerun records the new base.
 */
export async function taskBaseDrift(root: string, task: Task): Promise<BaseDrift | null> {
  const bases = new Map<string, NonNullable<Task["gates"][string]["base"]>>()
  for (const gate of Object.values(task.gates)) {
    if (gate.verdict !== null && !gate.stale && gate.base) bases.set(`${gate.base.ref} ${gate.base.commit}`, gate.base)
  }
  let worst: BaseDrift | null = null
  for (const base of bases.values()) {
    const drift = await baseDrift(root, base)
    if (drift && (worst === null || drift.newCommits > worst.newCommits)) worst = drift
  }
  return worst
}

/** One line naming what to do; shared by status, the board and the done transition. */
export function baseDriftMessage(drift: BaseDrift): string {
  const commits = drift.newCommits === 1 ? "1 new commit" : `${drift.newCommits} new commits`
  return `${drift.ref} moved since verify (${commits} as of the last fetch). `
    + `Merge ${drift.ref} into this branch and run /junto:verify again; gates passed on the old base.`
}
