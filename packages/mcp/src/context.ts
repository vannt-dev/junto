import { findProjectRoot } from "@junto/core"

export const RUNNER = "@junto/mcp@0.1.0"

export interface ToolContext {
  root: string
  runner: string
}

/** Find the project root from cwd and provide guidance when `.junto/` is absent. */
export function resolveContext(cwd: string): ToolContext {
  const root = findProjectRoot(cwd)
  if (root === null) {
    throw new Error(
      "No .junto/ directory was found here or in any parent directory. "
      + "Run /junto:start to initialize junto for this project.",
    )
  }
  return { root, runner: RUNNER }
}
