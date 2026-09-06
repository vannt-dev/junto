import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { juntoDir } from "../paths.js"
import type { Provider } from "../schema.js"

export const BUILT_IN_ROLES = ["architect", "adversary", "pragmatist", "reviewer"] as const
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number]

export function isBuiltInRole(role: string): role is BuiltInRole {
  return (BUILT_IN_ROLES as readonly string[]).includes(role)
}

/** Deliberately not the same vendor as the others, to avoid one vendor reviewing its own blind spots. */
export const DEFAULT_ROLE_PROVIDER: Record<BuiltInRole, Provider> = {
  architect: "anthropic",
  adversary: "openai",
  pragmatist: "anthropic",
  reviewer: "anthropic",
}

export const DEFAULT_ROLE_PROMPT: Record<BuiltInRole, string> = {
  architect:
    "You are the architect role in an advisory review panel for a software task. Read the "
    + "task's brief and plan, then answer the question with your own reasoning about structure, "
    + "module boundaries, and long-term maintainability. Point out where the design creates "
    + "coupling, hides complexity, or under-specifies an interface. Be concrete: name files, "
    + "functions, or data shapes where you can. Do not comment on unrelated code style.",
  adversary:
    "You are the adversary role in an advisory review panel for a software task. Read the "
    + "task's brief and plan, then argue against it: find the scenario, input, or sequence of "
    + "events where this plan fails, is misused, or produces a wrong result silently. Assume the "
    + "plan's author already thought of the obvious cases; look past those. Be concrete and "
    + "specific rather than generically cautious.",
  pragmatist:
    "You are the pragmatist role in an advisory review panel for a software task. Read the "
    + "task's brief and plan, then push back on unnecessary complexity, speculative generality, "
    + "and scope creep. Identify anything being built for a need that does not exist yet, and any "
    + "simpler approach that would satisfy the actual brief. Prefer concrete suggestions over "
    + "general principles.",
  reviewer:
    "You are the reviewer role in an advisory review panel for a software task. Read the task's "
    + "brief and plan, then give a final correctness read: does the plan actually satisfy the "
    + "brief, are there gaps between what is described and what would need to be built, and is "
    + "anything in the plan internally inconsistent? Call out ambiguity that a future "
    + "implementer could interpret two different ways.",
}

/** A project override at `.junto/roles/<role>.md` always wins, even for a built-in role name. */
export function resolveRolePrompt(root: string, role: string): string {
  const overridePath = join(juntoDir(root), "roles", `${role}.md`)
  if (existsSync(overridePath)) return readFileSync(overridePath, "utf-8")
  if (isBuiltInRole(role)) return DEFAULT_ROLE_PROMPT[role]
  throw new Error(
    `Unknown role "${role}". Built-in roles are ${BUILT_IN_ROLES.join(", ")}. `
    + `Define .junto/roles/${role}.md to add a custom role.`,
  )
}
