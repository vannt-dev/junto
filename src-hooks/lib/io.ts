/** Read the JSON payload that Claude Code sends to the hook over stdin. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf-8")
}

export function readHookInput(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Hook failures must never interrupt the user's Claude Code session. */
export async function runHook(fn: (input: Record<string, unknown>) => string | Promise<string>): Promise<void> {
  try {
    const output = await fn(readHookInput(await readStdin()))
    if (output !== "") process.stdout.write(output)
  } catch {
    // Errors are intentionally swallowed so the session can continue.
  }
  process.exit(0)
}
