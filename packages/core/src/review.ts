import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execa } from "execa"
import { resolveExecutable } from "./exec.js"
import { OUTPUT_TAIL_BYTES, validGateName } from "./gates.js"
import { taskDir } from "./paths.js"
import { SCHEMA_VERSION, type GateState, type VerdictFile } from "./schema.js"
import type { ReviewScope } from "./review-scope.js"
import { appendReviewEvent } from "./review-report.js"
import { validReviewFinding } from "./finding-contract.js"

/**
 * Review findings share one vocabulary with governed-agent-sdlc (`agentkit.review`) so a
 * finding means the same thing in both projects. Provider-specific schemas stop at the adapter.
 */
export const REVIEW_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const
export type ReviewSeverity = typeof REVIEW_SEVERITIES[number]

export const REVIEW_CATEGORIES = [
  "security", "correctness", "performance", "maintainability", "testing", "architecture", "other",
] as const
export type ReviewCategory = typeof REVIEW_CATEGORIES[number]

export interface ReviewFinding {
  id: string
  source?: string
  metadata?: Record<string, unknown>
  file: string
  line?: number | null
  severity: ReviewSeverity
  category: ReviewCategory
  message: string
}

export type ReviewErrorKind = "unavailable" | "timeout" | "exit" | "parse" | "schema" | "output-too-large" | "incomplete"

/** Infrastructure failure of the reviewer. It is never a finding and never a pass. */
export interface ReviewError {
  kind: ReviewErrorKind
  message: string
}

export interface ReviewContext {
  root: string
  /** Scope hint for providers that accept one. OCR selects files from the diff itself. */
  files?: string[]
  /** Requirement/business context file; the provider decides how to pass it on. */
  backgroundFile?: string
  from?: string
  to?: string
  commit?: string
}

export interface ReviewResult {
  provider: string
  findings: ReviewFinding[]
  error?: ReviewError
  /** Reviewer had nothing to review (for example OCR status "skipped"). */
  nothingToReview?: boolean
  command?: string[]
  rawEvidence?: string
  runs?: Array<{ scope: ReviewScope; result: ReviewResult }>
}

export interface ReviewProvider {
  review(context: ReviewContext): Promise<ReviewResult>
}

const SEVERITY_MAP: Record<string, ReviewSeverity> = {
  critical: "critical", blocker: "critical", fatal: "critical",
  high: "high", error: "high", major: "high",
  medium: "medium", warn: "medium", warning: "medium", moderate: "medium",
  low: "low", minor: "low", style: "low",
  info: "info", informational: "info", note: "info", suggestion: "info",
}

const CATEGORY_MAP: Record<string, ReviewCategory> = {
  security: "security", vuln: "security", vulnerability: "security", auth: "security", injection: "security", cwe: "security", owasp: "security",
  correctness: "correctness", bug: "correctness", logic: "correctness", fault: "correctness", error: "correctness",
  performance: "performance", perf: "performance", memory: "performance", speed: "performance",
  maintainability: "maintainability", readability: "maintainability", complexity: "maintainability",
  style: "maintainability", documentation: "maintainability",
  testing: "testing", test: "testing", coverage: "testing",
  architecture: "architecture", design: "architecture",
}

/** An unknown or missing severity stays visible (`medium`) instead of silently becoming `info`. */
export function normalizeSeverity(raw: unknown): ReviewSeverity {
  if (typeof raw !== "string") return "medium"
  return SEVERITY_MAP[raw.trim().toLowerCase()] ?? "medium"
}

export function normalizeCategory(raw: unknown): ReviewCategory {
  if (typeof raw !== "string") return "other"
  return CATEGORY_MAP[raw.trim().toLowerCase()] ?? "other"
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [REDACTED]"],
  [/((?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, "$1[REDACTED]"],
]

/** Review output is untrusted and may echo credentials found in source; redact before persisting. */
export function redactSecrets(text: string): string {
  let out = text
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

/** Redact string values before JSON encoding so escaped quotes cannot corrupt evidence. */
function redactedJson(value: unknown): string {
  return JSON.stringify(value, (key, item: unknown) => {
    if (typeof item !== "string") return item
    return /(?:api[_-]?key|secret|token|password)$/i.test(key) ? "[REDACTED]" : redactSecrets(item)
  }, 2)
}

function redactEvidence(text: string): string {
  try { return redactedJson(JSON.parse(text)) } catch { return redactSecrets(text) }
}

export class MockReviewProvider implements ReviewProvider {
  constructor(
    public readonly name: string = "mock",
    private readonly findings: ReviewFinding[] = [],
    private readonly error?: ReviewError,
  ) {}

  async review(_context: ReviewContext): Promise<ReviewResult> {
    return {
      provider: this.name,
      findings: this.findings,
      ...(this.error ? { error: this.error } : {}),
      rawEvidence: JSON.stringify(this.findings, null, 2),
    }
  }
}

export class OcrParseError extends Error {
  constructor(public readonly kind: "parse" | "schema" | "exit", message: string) {
    super(redactSecrets(message))
    this.name = "OcrParseError"
  }
}

export interface ParsedOcrOutput {
  findings: ReviewFinding[]
  nothingToReview: boolean
  /** Some files were not reviewed (item failures or the token budget). */
  incomplete: boolean
  message?: string
}

/**
 * Status values seen from `ocr review --format json`: the terminal states of a run plus the older
 * warning-derived ones. A successful run reports "complete".
 */
const COMPLETE_STATUSES = new Set(["complete", "success", "completed_with_warnings"])
const INCOMPLETE_STATUSES = new Set(["partial", "completed_with_errors"])

/**
 * Parse `ocr review --format json` output:
 * `{ status, comments: [{ path, content, start_line, end_line, category, severity }] }`.
 * The output is untrusted, so every field is validated rather than assumed.
 */
export function parseOcrOutput(stdout: string): ParsedOcrOutput {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new OcrParseError("parse", "OpenCodeReview output is not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OcrParseError("schema", "OpenCodeReview output must be a JSON object")
  }
  const doc = parsed as Record<string, unknown>
  const status = doc.status
  const message = typeof doc.message === "string" ? redactSecrets(doc.message) : "no message"
  if (status === "failed") {
    throw new OcrParseError("exit", `OpenCodeReview reported status "failed": ${message}`)
  }
  if (status === "skipped") return { findings: [], nothingToReview: true, incomplete: false }
  const incomplete = typeof status === "string" && INCOMPLETE_STATUSES.has(status)
  if (typeof status !== "string" || (!COMPLETE_STATUSES.has(status) && !incomplete)) {
    throw new OcrParseError("schema", `Unexpected OpenCodeReview status: ${JSON.stringify(status)}`)
  }
  // Go marshals an empty slice as null.
  const comments = doc.comments === null || doc.comments === undefined ? [] : doc.comments
  if (!Array.isArray(comments)) {
    throw new OcrParseError("schema", "OpenCodeReview comments must be an array or null")
  }

  const findings: ReviewFinding[] = []
  comments.forEach((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new OcrParseError("schema", `comments[${index}] must be an object`)
    }
    const c = item as Record<string, unknown>
    if (typeof c.path !== "string" || c.path === "" || typeof c.content !== "string") {
      throw new OcrParseError("schema", `comments[${index}] needs string path and content`)
    }
    const line = typeof c.start_line === "number" && Number.isInteger(c.start_line) && c.start_line > 0
      ? c.start_line
      : undefined
    findings.push({
      id: `ocr-${index + 1}`,
      source: "open-code-review",
      metadata: typeof c.end_line === "number" && Number.isInteger(c.end_line) && c.end_line > 0 ? { end_line: c.end_line } : {},
      file: c.path.replace(/\\/g, "/"),
      line: line ?? null,
      severity: normalizeSeverity(c.severity),
      category: normalizeCategory(c.category),
      message: redactSecrets(c.content.trim()),
    })
  })
  return { findings, nothingToReview: false, incomplete, ...(incomplete ? { message } : {}) }
}

export interface DelegatePreviewFile {
  path: string
  status: string
  insertions: number
  deletions: number
  excludeReason?: string
}

export interface DelegatePreview {
  mode: string
  mergeBase?: string
  reviewable: DelegatePreviewFile[]
  excluded: DelegatePreviewFile[]
}

export interface DelegateRules {
  schema_version: "1"
  groups: Array<{ group_id: number; source: string; pattern: string; files: string[]; rule: string }>
}

export function parseDelegateRules(stdout: string, paths: string[]): DelegateRules {
  let doc: unknown
  try { doc = JSON.parse(stdout) } catch { throw new OcrParseError("parse", "Delegate rules are not JSON") }
  if (!doc || typeof doc !== "object" || !("schema_version" in doc) || doc.schema_version !== "1"
    || !("groups" in doc) || !Array.isArray(doc.groups)) throw new OcrParseError("schema", "Unsupported delegate rule schema")
  const covered = new Set<string>()
  for (const group of doc.groups) {
    if (!group || typeof group !== "object" || !Number.isInteger(group.group_id) || group.group_id < 1
      || [group.source, group.pattern, group.rule].some(v => typeof v !== "string")
      || !Array.isArray(group.files) || group.files.some((p: unknown) => typeof p !== "string" || !paths.includes(p))) {
      throw new OcrParseError("schema", "Invalid delegate rule group")
    }
    for (const path of group.files as string[]) covered.add(path)
  }
  if (paths.some(p => !covered.has(p))) throw new OcrParseError("schema", "Delegate rules do not cover every requested file")
  return doc as DelegateRules
}

function previewFiles(raw: unknown, field: string): DelegatePreviewFile[] {
  if (raw === null) return [] // Go's nil slice is serialized as null.
  if (!Array.isArray(raw)) throw new OcrParseError("schema", `delegate preview is missing ${field}`)
  return raw.map((item, index) => {
    const f = item as Record<string, unknown> | null
    if (typeof f !== "object" || f === null || typeof f.path !== "string") {
      throw new OcrParseError("schema", `${field}[${index}] needs a string path`)
    }
    return {
      path: f.path.replace(/\\/g, "/"),
      status: typeof f.status === "string" ? f.status : "",
      insertions: typeof f.insertions === "number" ? f.insertions : 0,
      deletions: typeof f.deletions === "number" ? f.deletions : 0,
      ...(typeof f.exclude_reason === "string" ? { excludeReason: f.exclude_reason } : {}),
    }
  })
}

/** Parse `ocr delegate preview --format json`: OCR's deterministic file selection, no LLM involved. */
export function parseDelegatePreview(stdout: string): DelegatePreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new OcrParseError("parse", "OpenCodeReview delegate preview is not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new OcrParseError("schema", "OpenCodeReview delegate preview must be a JSON object")
  }
  const doc = parsed as Record<string, unknown>
  return {
    mode: typeof doc.mode === "string" ? doc.mode : "",
    ...(typeof doc.merge_base === "string" && doc.merge_base !== "" ? { mergeBase: doc.merge_base } : {}),
    reviewable: previewFiles(doc.reviewable_files, "reviewable_files"),
    excluded: previewFiles(doc.excluded_files ?? [], "excluded_files"),
  }
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode?: number | undefined
  timedOut?: boolean | undefined
  isMaxBuffer?: boolean | undefined
}

export type ExecFn = (
  file: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; maxBuffer: number; env: Record<string, string> },
) => Promise<ExecResult>

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const STDERR_EVIDENCE_BYTES = 2048
const ENV_ALLOWLIST = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
]
const ENV_PREFIXES = ["OCR_", "OPENCODEREVIEW_", "ANTHROPIC_", "OPENAI_"]

/** Pass OCR only what it needs; the rest of the environment (other tokens, CI secrets) stays out. */
export function filterEnv(env: NodeJS.ProcessEnv, extra: string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (ENV_ALLOWLIST.some(k => k.toUpperCase() === key.toUpperCase()) || extra.includes(key) || ENV_PREFIXES.some(p => key.startsWith(p))) {
      out[key] = value
    }
  }
  return out
}

const defaultExec: ExecFn = async (file, args, options) => {
  const res = await execa(file, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer,
    env: options.env,
    extendEnv: false,
    reject: false,
  })
  return {
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr : "",
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    isMaxBuffer: (res as { isMaxBuffer?: boolean }).isMaxBuffer,
  }
}

export interface OpenCodeReviewOptions {
  /** Binary name or path. Deliberately not read from repository config so repo content cannot pick the executable. */
  executable?: string
  timeoutMs?: number
  exec?: ExecFn
  passEnv?: string[]
}

export class OpenCodeReviewProvider implements ReviewProvider {
  public readonly executable: string
  public readonly timeoutMs: number
  private readonly exec: ExecFn
  private readonly passEnv: string[]

  constructor(options: OpenCodeReviewOptions = {}) {
    this.executable = options.executable ?? process.env.OPEN_CODE_REVIEW_BIN ?? "ocr"
    this.timeoutMs = options.timeoutMs ?? 180_000
    this.exec = options.exec ?? defaultExec
    this.passEnv = options.passEnv ?? []
  }

  private env(): Record<string, string> {
    return filterEnv(process.env, this.passEnv)
  }

  async isAvailable(root: string = process.cwd()): Promise<boolean> {
    if (this.exec === defaultExec && !resolveExecutable(this.executable, root)) return false
    try {
      const res = await this.exec(this.executable, ["--version"], {
        cwd: root, timeoutMs: 15_000, maxBuffer: 64 * 1024, env: this.env(),
      })
      return res.exitCode === 0
    } catch {
      return false
    }
  }

  private diffArgs(context: ReviewContext): string[] {
    const args: string[] = []
    if (context.commit) args.push("--commit", context.commit)
    if (context.from) args.push("--from", context.from)
    if (context.to) args.push("--to", context.to)
    return args
  }

  async review(context: ReviewContext): Promise<ReviewResult> {
    const provider = "open-code-review"
    if (!await this.isAvailable(context.root)) {
      return {
        provider,
        findings: [],
        error: { kind: "unavailable", message: `OpenCodeReview executable "${this.executable}" is not available` },
      }
    }

    const args = ["review", "--repo", context.root, "--format", "json", ...this.diffArgs(context)]
    if (context.backgroundFile) args.push("--background-file", context.backgroundFile)
    const command = [this.executable, ...args]

    let res: ExecResult
    try {
      res = await this.exec(this.executable, args, {
        cwd: context.root, timeoutMs: this.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env: this.env(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { provider, findings: [], command, error: { kind: "exit", message: redactSecrets(`Failed to run OpenCodeReview: ${message}`) } }
    }

    const rawEvidence = redactEvidence(res.stdout)
    const fail = (kind: ReviewErrorKind, message: string): ReviewResult => ({
      provider, findings: [], command, rawEvidence, error: { kind, message },
    })

    if (res.timedOut) return fail("timeout", `OpenCodeReview exceeded its ${this.timeoutMs}ms timeout`)
    if (res.isMaxBuffer) return fail("output-too-large", `OpenCodeReview output exceeded ${MAX_OUTPUT_BYTES} bytes`)
    if (res.exitCode !== 0) {
      const tail = redactSecrets(res.stderr).slice(-STDERR_EVIDENCE_BYTES)
      return fail("exit", `OpenCodeReview exited with code ${res.exitCode ?? "unknown"}${tail ? `: ${tail}` : ""}`)
    }

    try {
      const parsed = parseOcrOutput(res.stdout)
      if (parsed.incomplete) {
        // Reviewing only part of the change must not read as a clean review, but the findings are kept.
        return {
          provider, findings: parsed.findings, command, rawEvidence,
          error: { kind: "incomplete", message: `OpenCodeReview did not cover every file: ${parsed.message ?? "partial"}` },
        }
      }
      return { provider, findings: parsed.findings, nothingToReview: parsed.nothingToReview, command, rawEvidence }
    } catch (err) {
      if (err instanceof OcrParseError) return fail(err.kind, err.message)
      throw err
    }
  }

  /**
   * Delegation mode: let OCR do the deterministic part (file selection, exclusions) and leave the
   * semantic review to the host agent, so no OCR LLM configuration is needed.
   */
  async delegatePreview(context: ReviewContext): Promise<DelegatePreview> {
    const args = ["delegate", "preview", "--repo", context.root, "--format", "json", ...this.diffArgs(context)]
    if (context.backgroundFile) args.push("--background-file", context.backgroundFile)
    const res = await this.exec(this.executable, args, {
      cwd: context.root, timeoutMs: this.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env: this.env(),
    })
    if (res.timedOut) throw new OcrParseError("exit", "OpenCodeReview delegate preview timed out")
    if (res.isMaxBuffer) throw new OcrParseError("exit", "OpenCodeReview delegate preview exceeded its output limit")
    if (res.exitCode !== 0) {
      throw new OcrParseError("exit", `OpenCodeReview delegate preview exited with code ${res.exitCode ?? "unknown"}`)
    }
    return parseDelegatePreview(res.stdout)
  }

  async delegateRules(context: ReviewContext, paths: string[]): Promise<DelegateRules> {
    if (!paths.length) return { schema_version: "1", groups: [] }
    const args = ["delegate", "rule", "--repo", context.root, "--format", "json", ...this.diffArgs(context)]
    if (context.backgroundFile) args.push("--background-file", context.backgroundFile)
    args.push("--", ...paths)
    const res = await this.exec(this.executable, args, {
      cwd: context.root, timeoutMs: this.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env: this.env(),
    })
    if (res.timedOut || res.isMaxBuffer || res.exitCode !== 0) throw new OcrParseError("exit", "OpenCodeReview delegate rule failed or exceeded its limits")
    return parseDelegateRules(res.stdout, paths)
  }
}

export interface RunReviewGateOptions {
  root: string
  taskId: string
  name: string
  provider: ReviewProvider
  context: Omit<ReviewContext, "root">
  /** Severities that fail the gate. Defaults to critical and high. */
  failOn?: ReviewSeverity[]
  runner: string
  reviewFingerprint?: string
}

export const DEFAULT_FAIL_ON: ReviewSeverity[] = ["critical", "high"]

/**
 * Run a review provider as a gate. Only the provider's real result decides the state:
 * a missing reviewer is `skipped` (never a pass), a broken reviewer is `fail`, and findings at or
 * above a failOn severity are `fail`. Nothing the model says can change that.
 */
export async function runReviewGate(opts: RunReviewGateOptions): Promise<VerdictFile> {
  const { root, taskId, name, provider, runner } = opts
  if (!validGateName(name)) {
    throw new Error(
      `Invalid gate name "${name}". Use only letters, digits, ".", "_", and "-", `
      + "and do not use a reserved Windows device name.",
    )
  }
  const failOn = opts.failOn ?? DEFAULT_FAIL_ON
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  appendReviewEvent(root, taskId, { gate: name, type: "review.started" })
  let result: ReviewResult
  try { result = await provider.review({ ...opts.context, root }) }
  catch (error) {
    appendReviewEvent(root, taskId, { gate: name, type: "review.failed", state: "fail" })
    throw error
  }
  result.findings = result.findings.map(f => ({ ...f, source: f.source ?? result.provider, line: f.line ?? null, metadata: f.metadata ?? {} }))
  if (result.findings.some(f => !validReviewFinding(f))) {
    result.error = { kind: "schema", message: "Review findings do not satisfy the shared version-1 contract" }
  }
  const blocking = result.findings.filter(f => failOn.includes(f.severity))

  let state: GateState
  let reason: string | undefined
  let exitCode: number | null
  if (result.error?.kind === "unavailable") {
    state = "skipped"
    exitCode = null
    reason = `Gate "${name}" could not run: ${result.error.message}. `
      + "Install the reviewer and retry, or set required: false in .junto/config.json."
  } else if (result.error) {
    state = "fail"
    exitCode = 1
    reason = `Review provider ${result.provider} failed (${result.error.kind}): ${result.error.message}`
  } else if (blocking.length > 0) {
    state = "fail"
    exitCode = 1
    reason = `${blocking.length} review finding(s) at ${failOn.join("/")} severity reported by ${result.provider}.`
  } else if (result.nothingToReview) {
    state = "skipped"
    exitCode = null
    reason = "OpenCodeReview selected no files. A skipped review does not satisfy a required gate."
  } else {
    state = "pass"
    exitCode = 0
  }

  const counts = Object.fromEntries(REVIEW_SEVERITIES.map(s => [s, result.findings.filter(f => f.severity === s).length]))
  let logOutput = `Review Provider: ${result.provider}\nStatus: ${state.toUpperCase()}\n`
    + `Findings: ${REVIEW_SEVERITIES.map(s => `${s}=${counts[s]}`).join(" ")}\n`
  if (result.nothingToReview) logOutput += "Reviewer reported nothing to review.\n"
  if (reason) logOutput += `Reason: ${reason}\n`
  if (result.findings.length > 0) {
    logOutput += "\nFindings:\n"
    for (const f of result.findings) {
      logOutput += `[${f.severity.toUpperCase()}/${f.category}] ${f.file}${f.line ? `:${f.line}` : ""} - ${f.message}\n`
    }
  }

  const dir = join(taskDir(root, taskId), "verdicts")
  mkdirSync(dir, { recursive: true })
  logOutput = redactSecrets(logOutput)
  if (reason) reason = redactSecrets(reason)
  writeFileSync(join(dir, `${name}.log`), logOutput, "utf-8")
  // The normalized result is evidence; the raw provider output is kept beside it, never merged into it.
  writeFileSync(join(dir, `${name}.review.json`), redactedJson({ ...result, rawEvidence: undefined }), "utf-8")
  const rawPath = join(dir, `${name}.raw.json`)
  if (result.rawEvidence) writeFileSync(rawPath, redactEvidence(result.rawEvidence), "utf-8")
  else rmSync(rawPath, { force: true })

  const verdict: VerdictFile = {
    schemaVersion: SCHEMA_VERSION,
    gate: name,
    argv: (result.command ?? [result.provider, "review"]).map(redactSecrets),
    cwd: root,
    exitCode,
    state,
    startedAt,
    durationMs: Date.now() - t0,
    outputTail: logOutput.slice(-OUTPUT_TAIL_BYTES),
    outputBytes: Buffer.byteLength(logOutput, "utf-8"),
    outputFile: `verdicts/${name}.log`,
    runner,
    ...(opts.reviewFingerprint ? { reviewFingerprint: opts.reviewFingerprint } : {}),
    ...(reason ? { reason } : {}),
  }

  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(verdict, null, 2)}\n`, "utf-8")
  appendReviewEvent(root, taskId, { gate: name, type: result.error ? "review.failed" : "review.completed", state })
  return verdict
}
