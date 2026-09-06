import { accessSync, constants, existsSync, statSync } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"

/** Candidate executable extensions. Try the original name first because it may already include one. */
function candidateExtensions(): string[] {
  if (process.platform !== "win32") return [""]
  const pathext = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
  return ["", ...pathext.split(";").filter(Boolean)]
}

function existsAsExecutable(base: string): boolean {
  return candidateExtensions().some((ext) => {
    const candidate = base + ext
    if (!existsSync(candidate)) return false
    try {
      if (!statSync(candidate).isFile()) return false
      if (process.platform !== "win32") accessSync(candidate, constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

/**
 * Resolve `argv[0]` to a real executable before spawning. This deterministic
 * check avoids classifying localized or forwarded process output.
 */
export function resolveExecutable(cmd: string, cwd: string): boolean {
  if (cmd.includes("/") || cmd.includes("\\")) {
    const base = isAbsolute(cmd) ? cmd : join(cwd, cmd)
    return existsAsExecutable(base)
  }
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  return dirs.some(dir => existsAsExecutable(join(dir, cmd)))
}
