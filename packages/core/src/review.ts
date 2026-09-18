import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execa } from "execa"
import { OUTPUT_TAIL_BYTES } from "./gates.js"
import { taskDir } from "./paths.js"
import { SCHEMA_VERSION, type GateState, type VerdictFile } from "./schema.js"

export interface ReviewFinding {
  file: string
  line?: number
  severity: "info" | "warning" | "error"
  category?: string
  message: string
}

export interface ReviewResult {
  provider: string
  passed: boolean
  findings: ReviewFinding[]
  rawEvidence?: string
}

export interface ReviewProvider {
  review(files: string[], options?: { root?: string; context?: string }): Promise<ReviewResult>
}

export class MockReviewProvider implements ReviewProvider {
  constructor(
    public readonly name: string = "mock",
    private readonly findings: ReviewFinding[] = [],
    private readonly explicitPassed?: boolean,
  ) {}

  async review(_files: string[]): Promise<ReviewResult> {
    const passed = this.explicitPassed !== undefined ? this.explicitPassed : this.findings.length === 0
    return {
      provider: this.name,
      passed,
      findings: this.findings,
      rawEvidence: JSON.stringify(this.findings, null, 2),
    }
  }
}

export class OpenCodeReviewProvider implements ReviewProvider {
  constructor(
    public readonly executable: string = process.env.OPEN_CODE_REVIEW_BIN || "open-code-review",
    public readonly timeoutMs: number = 180_000,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await execa(this.executable, ["--version"])
      return true
    } catch {
      return false
    }
  }

  async review(files: string[], options: { root?: string; context?: string } = {}): Promise<ReviewResult> {
    if (!await this.isAvailable()) {
      return {
        provider: "open-code-review",
        passed: false,
        findings: [
          {
            file: ".",
            severity: "error",
            message: `OpenCodeReview executable '${this.executable}' is not available`,
          },
        ],
      }
    }

    const root = options.root || process.cwd()
    const args = ["review", "--repo", root, "--format", "json"]
    if (files.length > 0) {
      args.push("--files", ...files)
    }
    if (options.context) {
      args.push("--context", options.context)
    }

    try {
      const { stdout, exitCode } = await execa(this.executable, args, {
        cwd: root,
        timeout: this.timeoutMs,
        reject: false,
      })

      const findings: ReviewFinding[] = []
      try {
        const parsed = stdout ? JSON.parse(stdout) : []
        const list = Array.isArray(parsed) ? parsed : (parsed.findings || [])
        for (const item of list) {
          const rawSev = String(item.severity || item.level || "").toLowerCase()
          const severity = (rawSev === "error" || rawSev === "critical" || rawSev === "high")
            ? "error"
            : (rawSev === "warn" || rawSev === "warning" || rawSev === "medium")
              ? "warning"
              : "info"

          findings.push({
            file: String(item.file || item.path || "unknown"),
            line: typeof item.line === "number" ? item.line : undefined,
            severity,
            category: item.category || item.rule_type,
            message: String(item.message || item.description || ""),
          })
        }
      } catch {
        findings.push({
          file: ".",
          severity: "error",
          message: `Failed to parse OpenCodeReview JSON output (exit code ${exitCode})`,
        })
      }

      return {
        provider: "open-code-review",
        passed: exitCode === 0 && findings.filter(f => f.severity === "error").length === 0,
        findings,
        rawEvidence: stdout,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        provider: "open-code-review",
        passed: false,
        findings: [
          {
            file: ".",
            severity: "error",
            message: `OpenCodeReview execution error: ${message}`,
          },
        ],
      }
    }
  }
}

export interface RunReviewGateOptions {
  root: string
  taskId: string
  name: string
  provider: ReviewProvider
  files?: string[]
  context?: string
  runner: string
}

export async function runReviewGate(opts: RunReviewGateOptions): Promise<VerdictFile> {
  const { root, taskId, name, provider, files = [], context, runner } = opts
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  const result = await provider.review(files, { root, context })
  const errors = result.findings.filter(f => f.severity === "error")
  const warnings = result.findings.filter(f => f.severity === "warning")
  const state: GateState = result.passed ? "pass" : "fail"
  const exitCode = result.passed ? 0 : 1

  let logOutput = `Review Provider: ${result.provider}\n`
    + `Status: ${state.toUpperCase()} (Errors: ${errors.length}, Warnings: ${warnings.length})\n\n`

  if (result.findings.length > 0) {
    logOutput += "Findings:\n"
    for (const f of result.findings) {
      logOutput += `[${f.severity.toUpperCase()}] ${f.file}${f.line ? `:${f.line}` : ""} - ${f.message}\n`
    }
  } else {
    logOutput += "No findings reported.\n"
  }

  const dir = join(taskDir(root, taskId), "verdicts")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.log`), logOutput, "utf-8")
  writeFileSync(join(dir, `${name}.review.json`), JSON.stringify(result, null, 2), "utf-8")

  const reason = errors.length > 0
    ? `${errors.length} review defect(s) reported by ${result.provider}.`
    : undefined

  const verdict: VerdictFile = {
    schemaVersion: SCHEMA_VERSION,
    gate: name,
    argv: [result.provider, "review", ...files],
    cwd: root,
    exitCode,
    state,
    startedAt,
    durationMs: Date.now() - t0,
    outputTail: logOutput.slice(-OUTPUT_TAIL_BYTES),
    outputBytes: Buffer.byteLength(logOutput, "utf-8"),
    outputFile: `verdicts/${name}.log`,
    runner,
    ...(reason ? { reason } : {}),
  }

  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(verdict, null, 2)}\n`, "utf-8")
  return verdict
}

