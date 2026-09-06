import { execa } from "execa"
import { resolveExecutable } from "../exec.js"
import type { CompleteInput, CompleteResult, ModelBackend } from "./types.js"

const DEFAULT_CLI_TIMEOUT_MS = 120_000
const MAX_CLI_OUTPUT_BYTES = 1_000_000

export function cliBackend(argv: string[], root: string): ModelBackend {
  return {
    async complete({ systemPrompt, userPrompt, timeoutMs }: CompleteInput): Promise<CompleteResult> {
      const [cmd, ...args] = argv
      if (cmd === undefined) throw new Error("CLI backend argv is empty.")
      if (!resolveExecutable(cmd, root)) {
        throw new Error(`CLI backend command "${cmd}" does not exist or is not executable. Install it and retry.`)
      }

      const effectiveTimeoutMs = timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
      let res
      try {
        res = await execa(cmd, args, {
          cwd: root,
          input: `${systemPrompt}\n\n${userPrompt}`,
          timeout: effectiveTimeoutMs,
          maxBuffer: MAX_CLI_OUTPUT_BYTES,
          reject: false,
          all: true,
        })
      } catch (error) {
        throw new Error(`CLI backend "${cmd}" failed to start: ${(error as Error).message}`)
      }

      if (res.timedOut) {
        throw new Error(`CLI backend "${cmd}" timed out after ${effectiveTimeoutMs}ms.`)
      }
      if (res.isMaxBuffer) {
        throw new Error(`CLI backend "${cmd}" output exceeded ${MAX_CLI_OUTPUT_BYTES} bytes per stream.`)
      }
      if (res.isTerminated) {
        throw new Error(`CLI backend "${cmd}" was terminated by signal ${res.signal ?? "unknown"}.`)
      }
      if (res.exitCode === undefined) {
        throw new Error(`CLI backend "${cmd}" failed to start: ${res.originalMessage ?? res.shortMessage ?? "unknown error"}`)
      }
      if (res.exitCode !== 0) {
        throw new Error(`CLI backend "${cmd}" exited ${res.exitCode}: ${res.all ?? ""}`)
      }
      const text = (res.all ?? "").trim()
      if (text === "") throw new Error(`CLI backend "${cmd}" returned an empty response.`)
      return { text, tokensUsed: 0, model: cmd }
    },
  }
}
