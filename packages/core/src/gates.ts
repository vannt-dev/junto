import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { execa } from "execa"
import { resolveExecutable } from "./exec.js"
import { taskDir } from "./paths.js"
import {
  gateCwdProblem, gateStateSchema, SCHEMA_VERSION, type GateSpec, type GateState, type Task, type VerdictFile,
} from "./schema.js"

export const OUTPUT_TAIL_BYTES = 8192
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Gate names are interpolated into `verdicts/<name>.json` and `.log` paths.
 * Restrict characters so a config key cannot escape `verdicts/` or `.junto/`.
 */
const VALID_GATE_NAME = /^[A-Za-z0-9._-]+$/
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export interface RunGateOptions {
  root: string
  taskId: string
  name: string
  spec: GateSpec
  runner: string
  sourceFingerprint?: string
}

/** Take a byte-limited tail without splitting a UTF-8 character. */
function tail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8")
  if (buf.byteLength <= maxBytes) return text
  return new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(buf.byteLength - maxBytes))
}

/** Shared by command and review gates, which write the same verdict file names. */
export function validGateName(name: string): boolean {
  return VALID_GATE_NAME.test(name)
    && name !== "."
    && name !== ".."
    && !WINDOWS_DEVICE_NAME.test(name)
}

interface Outcome {
  state: GateState
  exitCode: number | null
  output: string
  reason?: string
}

/**
 * `skipped` means no process was started. It therefore has no exit code and
 * must include an explanation in its log.
 * (ruling R-Q).
 */
function skipOutcome(name: string, detail: string): Outcome {
  const reason = `Gate "${name}" could not run: ${detail}. `
    + "Install the tool and retry, or set required: false in .junto/config.json."
  return { state: "skipped", exitCode: null, output: reason, reason }
}

/** A config problem stopped the gate before any process started; never a pass. */
function refuseOutcome(name: string, detail: string): Outcome {
  const reason = `Gate "${name}" was not run: ${detail}. Fix the gate in .junto/config.json.`
  return { state: "skipped", exitCode: null, output: reason, reason }
}

/**
 * Merge gate variables over the inherited environment. Windows treats names case-insensitively,
 * so an override replaces every differently cased copy instead of leaving two that compete.
 */
export function gateEnv(
  base: Record<string, string | undefined>,
  overrides: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) if (value !== undefined) env[key] = value
  for (const [key, value] of Object.entries(overrides)) {
    if (platform === "win32") {
      for (const existing of Object.keys(env)) if (existing.toUpperCase() === key.toUpperCase()) delete env[existing]
    }
    env[key] = value
  }
  return env
}

const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** Expand `${VAR}` from the process environment. Only names are reported, never values. */
function expandEnv(env: Record<string, string>, source: NodeJS.ProcessEnv): Record<string, string> | string {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    const missing = [...value.matchAll(ENV_REFERENCE)].map(m => m[1] ?? "").find(name => source[name] === undefined)
    if (missing !== undefined) {
      return `env ${key} references \${${missing}}, which is not set in the environment junto runs in`
    }
    out[key] = value.replace(ENV_REFERENCE, (_, name: string) => source[name] ?? "")
  }
  return out
}

/** Resolve the gate directory and refuse one that is missing or, through a link, outside the root. */
function gateDirectory(root: string, cwd: string | undefined): { dir: string, problem?: string } {
  if (cwd === undefined) return { dir: root }
  const dir = resolve(root, cwd)
  const lexical = gateCwdProblem(cwd)
  if (lexical !== null) return { dir, problem: `cwd "${cwd}" ${lexical}` }
  let real: string
  try {
    if (!statSync(dir).isDirectory()) return { dir, problem: `cwd "${cwd}" is not a directory` }
    real = realpathSync.native(dir)
  } catch {
    return { dir, problem: `cwd "${cwd}" does not exist or is not a directory` }
  }
  let realRoot: string
  try { realRoot = realpathSync.native(root) } catch { realRoot = resolve(root) }
  const rel = relative(realRoot, real)
  if (rel.split(/[\\/]/)[0] === ".." || isAbsolute(rel)) {
    return { dir, problem: `cwd "${cwd}" resolves outside the project root` }
  }
  return { dir }
}

async function spawnOutcome(
  cmd: string, args: string[], cwd: string, name: string, timeoutMs: number, env: Record<string, string> | undefined,
): Promise<Outcome> {
  try {
    const res = await execa(cmd, args, {
      cwd,
      ...(env ? { env, extendEnv: false } : {}),
      timeout: timeoutMs,
      all: true,
      reject: false,
      stripFinalNewline: false,
    })
    const output = res.all ?? ""
    const exitCode = res.exitCode ?? null

    // Safety net for a tool removed between resolveExecutable() and spawn.
    if ((res as { code?: unknown }).code === "ENOENT") {
      return skipOutcome(name, `command "${cmd}" does not exist`)
    }
    if (res.timedOut) {
      return {
        state: "fail",
        exitCode,
        output,
        reason: `Gate "${name}" exceeded its ${timeoutMs}ms timeout.`,
      }
    }
    if (exitCode === 0) return { state: "pass", exitCode, output }
    return { state: "fail", exitCode, output }
  } catch (err) {
    // Thrown-error side of the same ENOENT safety net; reject:false rarely reaches it.
    const e = err as { code?: unknown; shortMessage?: string; message: string }
    if (e.code === "ENOENT") {
      return skipOutcome(name, e.shortMessage ?? e.message)
    }
    // Non-ENOENT spawn errors are failures; skipped is reserved for a missing tool.
    const reason = `Gate "${name}" failed to start: ${e.shortMessage ?? e.message}.`
    return { state: "fail", exitCode: null, output: reason, reason }
  }
}

/**
 * Run a gate and persist its evidence. argv is always an array, never a shell string.
 */
export async function runGate(opts: RunGateOptions): Promise<VerdictFile> {
  const { root, taskId, name, spec, runner } = opts
  if (!validGateName(name)) {
    throw new Error(
      `Invalid gate name "${name}". Use only letters, digits, ".", "_", and "-", `
      + "and do not use a reserved Windows device name. "
      + "Gate names are interpolated into verdicts/<name>.json paths.",
    )
  }

  const { dir: cwd, problem: cwdProblem } = gateDirectory(root, spec.cwd)
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const argv = spec.argv ?? []
  const [cmd, ...args] = argv
  const expanded = spec.env === undefined ? undefined : expandEnv(spec.env, process.env)
  const env = expanded === undefined || typeof expanded === "string" ? undefined : gateEnv(process.env, expanded)

  // The schema requires argv.length >= 1 for command gates, but TypeScript cannot infer that refinement.
  const outcome = cwdProblem !== undefined
    ? refuseOutcome(name, cwdProblem)
    : typeof expanded === "string"
      ? refuseOutcome(name, expanded)
      : cmd === undefined
        ? skipOutcome(name, "empty argv")
        : resolveExecutable(cmd, cwd, env)
          ? await spawnOutcome(cmd, args, cwd, name, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS, env)
          : skipOutcome(name, `command "${cmd}" does not exist or is not executable`)

  const dir = join(taskDir(root, taskId), "verdicts")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.log`), outcome.output, "utf-8")

  const verdict: VerdictFile = {
    schemaVersion: SCHEMA_VERSION,
    gate: name,
    argv,
    cwd,
    exitCode: outcome.exitCode,
    state: outcome.state,
    startedAt,
    durationMs: Date.now() - t0,
    outputTail: tail(outcome.output, OUTPUT_TAIL_BYTES),
    outputBytes: Buffer.byteLength(outcome.output, "utf-8"),
    outputFile: `verdicts/${name}.log`,
    runner,
    ...(spec.env ? { envKeys: Object.keys(spec.env).sort() } : {}),
    ...(opts.sourceFingerprint ? { sourceFingerprint: opts.sourceFingerprint } : {}),
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  }

  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(verdict, null, 2)}\n`, "utf-8")
  return verdict
}

/** What a hook can learn about a gate's last run without hashing sources: its state and start time. */
export interface GateEvidence {
  state: GateState | null
  startedAt: string | null
}

/**
 * Read each gate's verdict file. A missing or unreadable verdict reads as null, which never counts
 * as a pass. Source fingerprints are not rechecked here; transitions do that.
 */
export function readGateEvidence(root: string, task: Task): Record<string, GateEvidence> {
  const dir = taskDir(root, task.id)
  const evidence: Record<string, GateEvidence> = {}
  for (const [name, gate] of Object.entries(task.gates)) {
    evidence[name] = { state: null, startedAt: null }
    if (gate.verdict === null) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, gate.verdict), "utf-8")) as { state?: unknown, startedAt?: unknown }
      evidence[name] = {
        state: gateStateSchema.parse(raw.state),
        startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
      }
    } catch {
      // Unreadable evidence stays null and cannot satisfy a gate.
    }
  }
  return evidence
}
