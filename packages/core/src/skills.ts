import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface EngineeringSkill {
  name: string
  category?: string
  description?: string
  content: string
  path: string
}

function parseFrontmatter(text: string): { description?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
  if (!match) return { body: text }

  const header = match[1]
  const body = match[2]
  let description: string | undefined

  for (const line of header.split(/\r?\n/)) {
    const descMatch = /^description:\s*(.+)$/i.exec(line)
    if (descMatch) {
      description = descMatch[1].trim().replace(/^['"]|['"]$/g, "")
      break
    }
  }

  return { description, body }
}

export class SkillResolver {
  constructor(public readonly searchRoots: string[] = []) {}

  /**
   * Resolve skill markdown content and metadata by skill name.
   */
  resolve(skillNames: string[]): EngineeringSkill[] {
    const resolved: EngineeringSkill[] = []
    const seen = new Set<string>()

    for (const name of skillNames) {
      if (seen.has(name)) continue
      seen.add(name)

      const candidates: string[] = []
      for (const root of this.searchRoots) {
        // 1. <root>/skills/<name>/SKILL.md (canonical layout in ai-engineering-skills)
        candidates.push(join(root, "skills", name, "SKILL.md"))
        // 2. <root>/<name>/SKILL.md (agents skills directory layout)
        candidates.push(join(root, name, "SKILL.md"))
      }

      let found = false
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          const raw = readFileSync(candidate, "utf-8")
          const { description, body } = parseFrontmatter(raw)
          resolved.push({
            name,
            description,
            content: body.trim(),
            path: candidate,
          })
          found = true
          break
        }
      }

      if (!found) {
        // Return placeholder if not found on disk, so workflow doesn't completely halt
        resolved.push({
          name,
          content: `# Skill: ${name}\n\nSkill definition not found on disk.`,
          path: "",
        })
      }
    }

    return resolved
  }
}
