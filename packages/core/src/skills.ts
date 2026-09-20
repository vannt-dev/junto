import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { globToRegExp } from "./stale.js"

export interface EngineeringSkill {
  name: string
  category?: string
  description?: string
  content: string
  path: string
  /** False when no SKILL.md was found; `content` is then only a marker, not real guidance. */
  found: boolean
  /** Glob patterns from frontmatter `appliesTo`; the skill is auto-selected when a changed file matches. */
  appliesTo: string[]
  tags: string[]
}

interface Frontmatter {
  description?: string
  appliesTo: string[]
  tags: string[]
  body: string
}

/** Skill names become path segments, so they must never contain separators or `..`. */
const VALID_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "")
}

function parseFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
  if (!match) return { appliesTo: [], tags: [], body: text }

  const header = match[1] ?? ""
  const body = match[2] ?? ""
  let description: string | undefined
  const lists: Record<string, string[]> = { appliesTo: [], tags: [] }
  let currentList: string[] | null = null

  for (const line of header.split(/\r?\n/)) {
    const item = /^\s+-\s+(.+)$/.exec(line)
    if (item && currentList) {
      currentList.push(unquote(item[1] ?? ""))
      continue
    }
    currentList = null
    const desc = /^description:\s*(.+)$/i.exec(line)
    if (desc) { description = unquote(desc[1] ?? ""); continue }
    const key = /^(appliesTo|tags):\s*(.*)$/.exec(line)
    if (key) {
      const target = lists[key[1] ?? ""] ?? []
      const inline = (key[2] ?? "").trim()
      if (inline.startsWith("[") && inline.endsWith("]")) {
        target.push(...inline.slice(1, -1).split(",").map(unquote).filter(s => s !== ""))
      } else {
        currentList = target
      }
    }
  }

  return { description, appliesTo: lists.appliesTo ?? [], tags: lists.tags ?? [], body }
}

interface RegistryEntry {
  appliesTo: string[]
  tags: string[]
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : []
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])]
}

export class SkillResolver {
  private registryCache: Map<string, RegistryEntry> | undefined

  constructor(public readonly searchRoots: string[] = []) {}

  /**
   * Registry metadata from `<root>/skillset.json` (the ai-engineering-skills manifest). It lives there
   * because canonical SKILL.md frontmatter only allows `name` and `description`.
   */
  private registry(): Map<string, RegistryEntry> {
    if (this.registryCache) return this.registryCache
    const entries = new Map<string, RegistryEntry>()
    for (const root of this.searchRoots) {
      const file = join(root, "skillset.json")
      if (!existsSync(file)) continue
      let manifest: unknown
      try { manifest = JSON.parse(readFileSync(file, "utf-8")) } catch { continue }
      const skills = (manifest as { skills?: unknown } | null)?.skills
      if (!Array.isArray(skills)) continue
      for (const item of skills) {
        const skill = item as { name?: unknown; appliesTo?: unknown; tags?: unknown } | null
        if (typeof skill?.name !== "string" || !VALID_SKILL_NAME.test(skill.name)) continue
        const previous = entries.get(skill.name)
        entries.set(skill.name, {
          appliesTo: union(previous?.appliesTo ?? [], stringList(skill.appliesTo)),
          tags: union(previous?.tags ?? [], stringList(skill.tags)),
        })
      }
    }
    this.registryCache = entries
    return entries
  }

  private candidates(name: string): string[] {
    const out: string[] = []
    for (const root of this.searchRoots) {
      // <root>/skills/<name>/SKILL.md is the canonical ai-engineering-skills layout;
      // <root>/<name>/SKILL.md is the agent skills directory layout.
      out.push(join(root, "skills", name, "SKILL.md"), join(root, name, "SKILL.md"))
    }
    return out
  }

  private load(name: string, path: string): EngineeringSkill {
    const { description, appliesTo, tags, body } = parseFrontmatter(readFileSync(path, "utf-8"))
    const registered = this.registry().get(name)
    return {
      name,
      description,
      content: body.trim(),
      path,
      found: true,
      appliesTo: union(appliesTo, registered?.appliesTo ?? []),
      tags: union(tags, registered?.tags ?? []),
    }
  }

  private missing(name: string): EngineeringSkill {
    return {
      name,
      content: `# Skill: ${name}\n\nSkill definition not found on disk.`,
      path: "",
      found: false,
      appliesTo: [],
      tags: [],
    }
  }

  /** Resolve skill markdown content and metadata by skill name. Unknown names come back with found=false. */
  resolve(skillNames: string[]): EngineeringSkill[] {
    const resolved: EngineeringSkill[] = []
    const seen = new Set<string>()

    for (const name of skillNames) {
      if (seen.has(name)) continue
      seen.add(name)

      const path = VALID_SKILL_NAME.test(name) ? this.candidates(name).find(existsSync) : undefined
      resolved.push(path === undefined ? this.missing(name) : this.load(name, path))
    }
    return resolved
  }

  /** Names of every skill present under the search roots. */
  list(): string[] {
    const names = new Set<string>()
    for (const root of this.searchRoots) {
      for (const dir of [join(root, "skills"), root]) {
        if (!existsSync(dir)) continue
        let entries: string[]
        try { entries = readdirSync(dir) } catch { continue }
        for (const entry of entries) {
          if (!VALID_SKILL_NAME.test(entry)) continue
          const file = join(dir, entry, "SKILL.md")
          try { if (statSync(file).isFile()) names.add(entry) } catch { /* not a skill directory */ }
        }
      }
    }
    return [...names].sort()
  }

  /**
   * Explicitly requested skills plus any skill whose `appliesTo` globs match a changed file,
   * so the agent gets a small, predictable set instead of every skill.
   */
  resolveForFiles(files: string[], explicit: string[] = []): EngineeringSkill[] {
    const normalized = files.map(f => f.replace(/\\/g, "/").replace(/^\.\//, ""))
    const names = [...explicit]
    for (const name of this.list()) {
      if (names.includes(name)) continue
      const path = this.candidates(name).find(existsSync)
      if (path === undefined) continue
      const appliesTo = union(
        parseFrontmatter(readFileSync(path, "utf-8")).appliesTo,
        this.registry().get(name)?.appliesTo ?? [],
      )
      const regexes = appliesTo.map(p => globToRegExp(p.replace(/\\/g, "/").replace(/^\.\//, "")))
      if (regexes.length > 0 && normalized.some(f => regexes.some(r => r.test(f)))) names.push(name)
    }
    return this.resolve(names)
  }
}
