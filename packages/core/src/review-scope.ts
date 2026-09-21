import { execa } from "execa"
import { ChangedFileResolver, ChangedFilesError, type ChangedFile } from "./changes.js"
import type { ReviewContext, ReviewProvider, ReviewResult } from "./review.js"

export interface ReviewScope {
  mode: "range" | "workspace"
  files: string[]
  from?: string
  to?: string
}

async function taskHead(root: string, baseCommit: string | null): Promise<string | null> {
  const head = await execa("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, reject: false })
  if (head.exitCode !== 0) {
    if (baseCommit) throw new ChangedFilesError("Cannot resolve HEAD for the task review")
    return null // An unborn repository can still have staged and untracked changes.
  }
  if (!baseCommit) {
    throw new ChangedFilesError("This task has no recorded base commit, but the repository now has commits. Its review scope cannot be reconstructed. Create tasks after the initial commit when commits will be made during the task.")
  }
  const to = head.stdout.trim()
  // OCR uses merge-base for ranges. Refuse a moved/rebased task base instead of silently changing scope.
  const ancestor = await execa("git", ["merge-base", "--is-ancestor", baseCommit, to], { cwd: root, reject: false })
  if (ancestor.exitCode !== 0) throw new ChangedFilesError("The task base is no longer an ancestor of HEAD. Start a new task after rebasing or switching history.")
  return to
}

/** Plans and rules use the same validated task base as the reviewer. */
export async function resolveTaskChanges(root: string, baseCommit: string | null): Promise<ChangedFile[]> {
  const to = await taskHead(root, baseCommit)
  const resolver = new ChangedFileResolver()
  const committed = baseCommit && to ? await resolver.resolve(root, { base: baseCommit, head: to }) : []
  const pending = await resolver.resolve(root)
  // A pending reversal of a committed edit still belongs to the two reviewed scopes.
  return [...new Map([...committed, ...pending].map(change => [change.path, change])).values()]
}

/** OCR range mode reads committed content; workspace mode reads pending edits. Both are needed. */
export async function resolveReviewScopes(root: string, baseCommit: string | null): Promise<ReviewScope[]> {
  const resolver = new ChangedFileResolver()
  const scopes: ReviewScope[] = []
  const to = await taskHead(root, baseCommit)
  if (baseCommit && to) {
    const committed = await resolver.resolve(root, { base: baseCommit, head: to })
    if (committed.length > 0) scopes.push({ mode: "range", from: baseCommit, to, files: committed.map(c => c.path) })
  }
  const pending = await resolver.resolve(root)
  if (pending.length > 0 || scopes.length === 0) {
    scopes.push({ mode: "workspace", files: pending.map(c => c.path) })
  }
  return scopes
}

/** Keep every scope's result in the evidence; no successful scope can hide another one's failure. */
export class ScopedReviewProvider implements ReviewProvider {
  constructor(private readonly provider: ReviewProvider, private readonly scopes: ReviewScope[]) {}

  async review(context: ReviewContext): Promise<ReviewResult> {
    if (this.scopes.length === 0) throw new Error("A task review must have at least one scope")
    const runs: Array<{ scope: ReviewScope; result: ReviewResult }> = []
    for (const scope of this.scopes) {
      const result = await this.provider.review({
        root: context.root,
        ...(context.backgroundFile ? { backgroundFile: context.backgroundFile } : {}),
        files: scope.files,
        ...(scope.from ? { from: scope.from } : {}),
        ...(scope.to ? { to: scope.to } : {}),
      })
      runs.push({ scope, result })
    }
    const failure = runs.find(r => r.result.error && r.result.error.kind !== "unavailable")
      ?? runs.find(r => r.result.error)
    const skipped = runs.filter(r => r.result.nothingToReview).length
    const error = failure?.result.error ?? (skipped > 0 && skipped < runs.length
      ? { kind: "incomplete" as const, message: "OpenCodeReview skipped part of the task scope; every scope must complete." }
      : undefined)
    return {
      provider: runs[0]?.result.provider ?? "open-code-review",
      findings: runs.flatMap(({ scope, result }) => result.findings.map(f => ({ ...f, id: `${scope.mode}-${f.id}` }))),
      ...(error ? { error } : {}),
      nothingToReview: skipped === runs.length,
      command: runs[0]?.result.command,
      runs: runs.map(({ scope, result }) => ({ scope, result: { ...result, rawEvidence: undefined } })),
      rawEvidence: JSON.stringify(runs.map(({ scope, result }) => ({ scope, output: result.rawEvidence ?? null })), null, 2),
    }
  }
}
