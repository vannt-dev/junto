import type { ConsultResult } from "./consult.js"

/** Same vocabulary as the review-finding contract, but panel findings stay advisory and never reach a gate. */
export const PANEL_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const
export type PanelSeverity = (typeof PANEL_SEVERITIES)[number]

export const PANEL_VERDICTS = ["approve", "concerns", "reject"] as const
export type PanelVerdict = (typeof PANEL_VERDICTS)[number]

/**
 * Appended to each panel role's question. It goes in the user prompt rather than the system
 * prompt because a project role file at `.junto/roles/<role>.md` replaces the system prompt.
 */
export const PANEL_ANSWER_FORMAT = "## Answer format\n\n"
  + "Give your reasoning first. Then end your answer with these two parts, so the panel's answers "
  + "can be merged:\n\n"
  + "## Findings\n\n"
  + "- <severity> | <file>:<line> | <one-line finding>\n\n"
  + "Severity is one of critical, high, medium, low, info. Leave out `:<line>` when there is no "
  + "line, and write `-` as the file when the finding is not about one file. Write `- none` when "
  + "you have no findings.\n\n"
  + "Verdict: <approve | concerns | reject>"

export interface PanelFinding {
  severity: PanelSeverity
  file: string | null
  line: number | null
  message: string
}

export interface ParsedPanelAnswer {
  /** False when the answer has neither a findings list nor a verdict line. */
  structured: boolean
  findings: PanelFinding[]
  verdict: PanelVerdict | null
}

const SEVERITY_RANK: Record<PanelSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

function cleanToken(value: string): string {
  return value.replace(/[`*_[\]]/g, "").trim()
}

function parseSeverity(value: string): PanelSeverity {
  const word = cleanToken(value).toLowerCase()
  return (PANEL_SEVERITIES as readonly string[]).includes(word) ? word as PanelSeverity : "info"
}

function parseLocation(value: string): { file: string | null, line: number | null } {
  const text = cleanToken(value).replace(/\\/g, "/").replace(/^\.\//, "")
  if (text === "" || text === "-" || /^(n\/a|none)$/i.test(text)) return { file: null, line: null }
  // "file:12", "file:12-20" and "file:12:5" all point at line 12.
  const match = /^(.+?):(\d+)(?:[-:]\d+)?$/.exec(text)
  if (match?.[1] !== undefined && match[2] !== undefined) return { file: match[1], line: Number(match[2]) }
  return { file: text, line: null }
}

function parseBullet(body: string): PanelFinding | null {
  const parts = body.split("|").map(part => part.trim())
  if (parts.length === 1 && /^none\.?$/i.test(cleanToken(parts[0] ?? ""))) return null
  // A model that echoes the format's template line has not raised a finding.
  if (/^<[^>]*>$/.test(cleanToken(parts[0] ?? ""))) return null
  if (parts.length >= 3) {
    const [severity = "", location = "", ...rest] = parts
    const message = rest.join(" | ").trim()
    return message === "" ? null : { severity: parseSeverity(severity), ...parseLocation(location), message }
  }
  if (parts.length === 2) {
    const [severity = "", message = ""] = parts
    return message === "" ? null : { severity: parseSeverity(severity), file: null, line: null, message }
  }
  const message = parts[0] ?? ""
  return message === "" ? null : { severity: "info", file: null, line: null, message }
}

/** Read the `## Findings` list and `Verdict:` line that PANEL_ANSWER_FORMAT asks for. Never throws. */
export function parsePanelAnswer(text: string): ParsedPanelAnswer {
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^#{1,6}\s*findings\s*:?\s*$/i.test((lines[i] ?? "").trim())) {
      start = i
      break
    }
  }

  const findings: PanelFinding[] = []
  if (start >= 0) {
    for (const raw of lines.slice(start + 1)) {
      const line = raw.trim()
      if (/^#{1,6}\s/.test(line) || /^\**verdict\**\s*:/i.test(line)) break
      const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
      if (bullet?.[1] === undefined) continue
      const finding = parseBullet(bullet[1])
      if (finding !== null) findings.push(finding)
    }
  }

  let verdict: PanelVerdict | null = null
  for (const raw of lines) {
    // No "<" before the word, so an echoed "Verdict: <approve | concerns | reject>" is not a verdict.
    const match = /^[\W_]*verdict[*_`]*\s*:?[\s*_`"']*(approve|concerns|reject)\b/i.exec(raw.trim())
    if (match?.[1] !== undefined) verdict = match[1].toLowerCase() as PanelVerdict
  }

  return { structured: start >= 0 || verdict !== null, findings, verdict }
}

export interface PanelRoleOutcome {
  role: string
  status: "ok" | "skipped" | "failed"
  path?: string
  /** The reason a role was skipped or failed. */
  reason?: string
  answer?: ParsedPanelAnswer
}

export interface PanelFindingGroup {
  severity: PanelSeverity
  file: string | null
  line: number | null
  message: string
  /** Each role that raised this finding, with the severity it gave, in panel order. */
  raisedBy: { role: string, severity: PanelSeverity, message: string }[]
}

export interface PanelDigest {
  roles: PanelRoleOutcome[]
  ran: string[]
  skipped: string[]
  failed: string[]
  unstructured: string[]
  rawFindingCount: number
  groups: PanelFindingGroup[]
  verdicts: { role: string, verdict: PanelVerdict }[]
  disagreements: string[]
}

/** Convert one runConsult result. `skipped` is junto's own budget stop (#29); never match the error text. */
export function panelRoleOutcome(result: ConsultResult): PanelRoleOutcome {
  if (result.ok) {
    return {
      role: result.role,
      status: "ok",
      ...(result.path === undefined ? {} : { path: result.path }),
      answer: parsePanelAnswer(result.text ?? ""),
    }
  }
  return { role: result.role, status: result.skipped === true ? "skipped" : "failed", reason: result.error ?? "unknown error" }
}

function normalizeMessage(message: string): string {
  return message.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

function groupKey(finding: PanelFinding): string {
  if (finding.file !== null && finding.line !== null) return `${finding.file}:${finding.line}`
  return `${finding.file ?? ""}#${normalizeMessage(finding.message)}`
}

function location(group: { file: string | null, line: number | null }): string {
  if (group.file === null) return "general"
  return group.line === null ? group.file : `${group.file}:${group.line}`
}

/** Merge each role's findings deterministically: no model call, same input gives the same digest. */
export function buildPanelDigest(roles: PanelRoleOutcome[]): PanelDigest {
  const ran = roles.filter(r => r.status === "ok").map(r => r.role)
  const groups = new Map<string, PanelFindingGroup>()
  let rawFindingCount = 0

  for (const role of roles) {
    for (const finding of role.answer?.findings ?? []) {
      rawFindingCount += 1
      const key = groupKey(finding)
      const group = groups.get(key)
      if (group === undefined) {
        groups.set(key, {
          severity: finding.severity,
          file: finding.file,
          line: finding.line,
          message: finding.message,
          raisedBy: [{ role: role.role, severity: finding.severity, message: finding.message }],
        })
        continue
      }
      const previous = group.raisedBy.find(entry => entry.role === role.role)
      // A role that repeats a point counts once, at the most severe level it gave.
      if (previous !== undefined) {
        if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[previous.severity]) previous.severity = finding.severity
      } else {
        group.raisedBy.push({ role: role.role, severity: finding.severity, message: finding.message })
      }
      if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[group.severity]) {
        group.severity = finding.severity
        group.message = finding.message
      }
    }
  }

  const ordered = [...groups.values()].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || b.raisedBy.length - a.raisedBy.length
    || location(a).localeCompare(location(b))
    || (a.line ?? 0) - (b.line ?? 0)
    || a.message.localeCompare(b.message))

  const verdicts = roles.flatMap((r) => {
    const verdict = r.answer?.verdict ?? null
    return verdict === null ? [] : [{ role: r.role, verdict }]
  })
  const disagreements: string[] = []
  if (new Set(verdicts.map(v => v.verdict)).size > 1) {
    disagreements.push(`Verdicts differ: ${verdicts.map(v => `${v.role} ${v.verdict}`).join(", ")}.`)
  }
  for (const group of ordered) {
    if (new Set(group.raisedBy.map(entry => entry.severity)).size > 1) {
      disagreements.push(`${location(group)}: severity differs: ${group.raisedBy.map(e => `${e.role} ${e.severity}`).join(", ")}.`)
    }
  }

  return {
    roles,
    ran,
    skipped: roles.filter(r => r.status === "skipped").map(r => r.role),
    failed: roles.filter(r => r.status === "failed").map(r => r.role),
    unstructured: roles.filter(r => r.status === "ok" && r.answer?.structured !== true).map(r => r.role),
    rawFindingCount,
    groups: ordered,
    verdicts,
    disagreements,
  }
}

function oneLine(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** One line for `junto__status`, also stored in the digest file's front matter. */
export function panelDigestSummary(digest: PanelDigest): string {
  const counts = PANEL_SEVERITIES
    .map(severity => [severity, digest.groups.filter(g => g.severity === severity).length] as const)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${count} ${severity}`)
  const findings = `${digest.groups.length} ${digest.groups.length === 1 ? "finding" : "findings"}`
    + (counts.length === 0 ? "" : ` (${counts.join(", ")})`)
  const disagreements = digest.disagreements.length === 0 ? "" : `, ${digest.disagreements.length} disagreement(s)`
  return `${digest.ran.length} of ${digest.roles.length} roles ran`
    + (digest.skipped.length === 0 ? "" : `, ${digest.skipped.length} skipped`)
    + (digest.failed.length === 0 ? "" : `, ${digest.failed.length} failed`)
    + `; ${findings}${disagreements}`
}

export function renderPanelDigest(digest: PanelDigest): string {
  const lines: string[] = ["## Panel digest", ""]
  const ranList = digest.ran.length === 0 ? "" : `: ${digest.ran.join(", ")}`
  lines.push(`Ran ${digest.ran.length} of ${digest.roles.length} roles${ranList}.`)
  for (const role of digest.roles) {
    if (role.status === "skipped") lines.push(`- Skipped ${role.role}: ${oneLine(role.reason ?? "")}`)
    if (role.status === "failed") lines.push(`- Failed ${role.role}: ${oneLine(role.reason ?? "")}`)
  }
  if (digest.verdicts.length > 0) {
    lines.push(`Verdicts: ${digest.verdicts.map(v => `${v.role} ${v.verdict}`).join(", ")}.`)
  }
  if (digest.unstructured.length > 0) {
    lines.push(`No findings list from ${digest.unstructured.join(", ")}; read the full answer.`)
  }

  lines.push("", `### Findings (${digest.groups.length} unique of ${digest.rawFindingCount} raised)`, "")
  if (digest.groups.length === 0) lines.push("None.")
  digest.groups.forEach((group, index) => {
    const by = group.raisedBy.map(entry => entry.role).join(", ")
    lines.push(`${index + 1}. [${group.severity}] ${location(group)} - ${oneLine(group.message)} `
      + `(raised by ${group.raisedBy.length} of ${digest.ran.length}: ${by})`)
    for (const entry of group.raisedBy) {
      if (entry.message !== group.message) lines.push(`   - ${entry.role}: ${oneLine(entry.message)}`)
    }
  })

  if (digest.disagreements.length > 0) {
    lines.push("", "### Disagreements", "", ...digest.disagreements.map(text => `- ${text}`))
  }

  const files = digest.roles.flatMap(r => r.path === undefined ? [] : [`${r.role}: ${r.path}`])
  if (files.length > 0) lines.push("", `Full answers: ${files.join(", ")}.`)
  lines.push("", "N of M counts the roles that ran. The digest is advisory, like each role's answer.")
  return lines.join("\n")
}
