import { accessSync, constants, existsSync, statSync } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"

/** Candidate executable extensions. Try the original name first because it may already include one. */
function candidateExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [""]
  const pathext = envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD"
  return ["", ...pathext.split(";").filter(Boolean)]
}

function existsAsExecutable(base: string, env: NodeJS.ProcessEnv): boolean {
  return candidateExtensions(env).some((ext) => {
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
export function resolveExecutable(cmd: string, cwd: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (cmd.includes("/") || cmd.includes("\\")) {
    const base = isAbsolute(cmd) ? cmd : join(cwd, cmd)
    return existsAsExecutable(base, env)
  }
  const dirs = (envValue(env, "PATH") ?? "").split(delimiter).filter(Boolean)
  return dirs.some(dir => existsAsExecutable(join(dir, cmd), env))
}

/** Windows variable names are case-insensitive; a plain object (unlike process.env) is not. */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (process.platform !== "win32") return env[name]
  const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}
