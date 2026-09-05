/** Wrap context in the UserPromptSubmit hook output protocol. */
export function contextOutput(text: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: text,
    },
  })
}
