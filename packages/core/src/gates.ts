import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execa } from "execa"
import { resolveExecutable } from "./exec.js"
import { taskDir } from "./paths.js"
import { SCHEMA_VERSION, type GateSpec, type GateState, type VerdictFile } from "./schema.js"

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
}

/** Take a byte-limited tail without splitting a UTF-8 character. */
function tail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8")
  if (buf.byteLength <= maxBytes) return text
  return new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(buf.byteLength - maxBytes))
}

function validGateName(name: string): boolean {
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

async function spawnOutcome(cmd: string, args: string[], cwd: string, name: string, timeoutMs: number): Promise<Outcome> {
  try {
    const res = await execa(cmd, args, {
      cwd,
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

  const cwd = root
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const [cmd, ...args] = spec.argv

  // The schema requires argv.length >= 1, but TypeScript cannot infer that refinement.
  const outcome = cmd === undefined
    ? skipOutcome(name, "empty argv")
    : resolveExecutable(cmd, cwd)
      ? await spawnOutcome(cmd, args, cwd, name, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      : skipOutcome(name, `command "${cmd}" does not exist or is not executable`)

  const dir = join(taskDir(root, taskId), "verdicts")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.log`), outcome.output, "utf-8")

  const verdict: VerdictFile = {
    schemaVersion: SCHEMA_VERSION,
    gate: name,
    argv: spec.argv,
    cwd,
    exitCode: outcome.exitCode,
    state: outcome.state,
    startedAt,
    durationMs: Date.now() - t0,
    outputTail: tail(outcome.output, OUTPUT_TAIL_BYTES),
    outputBytes: Buffer.byteLength(outcome.output, "utf-8"),
    outputFile: `verdicts/${name}.log`,
    runner,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  }

  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(verdict, null, 2)}\n`, "utf-8")
  return verdict
}
