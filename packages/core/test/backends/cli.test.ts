import { describe, expect, it } from "vitest"
import { cliBackend } from "../../src/backends/cli.js"

describe("cliBackend", () => {
  it("writes the joined prompt to stdin and returns trimmed stdout", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); let d=''; "
      + "process.stdin.on('data', c => d += c); "
      + "process.stdin.on('end', () => { console.log(d.trim()); })"])
    const result = await backend.complete({ systemPrompt: "sys", userPrompt: "user" })
    expect(result.text).toBe("sys\n\nuser")
  })

  it("always reports tokensUsed as 0", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); process.stdin.on('end', () => {})"])
    const result = await backend.complete({ systemPrompt: "s", userPrompt: "u" })
    expect(result.tokensUsed).toBe(0)
  })

  it("sets model to the resolved command name", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); process.stdin.on('end', () => {})"])
    const result = await backend.complete({ systemPrompt: "s", userPrompt: "u" })
    expect(result.model).toBe("node")
  })

  it("throws with the exit code and captured output on a non-zero exit", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); "
      + "process.stdin.on('end', () => { console.error('boom'); process.exit(2) })"])
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/exited 2.*boom/is)
  })

  it("throws naming the effective timeout when the process runs too long", async () => {
    const backend = cliBackend(["node", "-e", "setTimeout(() => {}, 60000)"])
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u", timeoutMs: 200 }))
      .rejects.toThrow(/timed out after 200ms/i)
  })

  it("throws before spawning when the command does not resolve on PATH", async () => {
    const backend = cliBackend(["junto-command-does-not-exist-abc123"])
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/does not exist or is not executable/i)
  })
})
