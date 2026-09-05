/** Normalize separators to `/` and remove a leading `./`. */
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "")
}

/** Convert a glob to regex. Supports `**`, `*`, and `?`; `*` never crosses `/`. */
function globToRegExp(glob: string): RegExp {
  let out = "^"
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` also matches the case with no directory segment.
        if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2 }
        else { out += ".*"; i += 1 }
      } else {
        out += "[^/]*"
      }
    } else if (c === "?") {
      out += "[^/]"
    } else {
      out += glob.charAt(i).replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`${out}$`)
}

/**
 * Should editing this file invalidate verdicts?
 * Returns false when the path matches any staleIgnore pattern.
 */
export function shouldStale(relPath: string, staleIgnore: string[]): boolean {
  const p = normalize(relPath)
  return !staleIgnore.some(pattern => globToRegExp(normalize(pattern)).test(p))
}
