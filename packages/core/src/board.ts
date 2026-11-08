import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { juntoDir } from "./paths.js"

export interface BoardGate {
  name: string
  required: boolean
  /** "pass", "fail", "skipped", "not run", "stale" or "unreadable verdict". */
  state: string
}

export interface BoardTask {
  id: string
  title: string
  size: string
  phase: string
  next: string
  blockers: string
  gates: BoardGate[]
  /** Set when the base branch moved since verify; a warning, never a blocker. */
  baseWarning: string | null
}

export interface BoardEntry {
  path: string
  branch: string | null
  current: boolean
  task: BoardTask | null
  /** Why this worktree's task could not be read; the other entries still render. */
  error?: string
}

const BOARD_FILE = "board.html"

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch)

const STYLE = ":root{color-scheme:light dark;--bg:#f7f7f5;--card:#fff;--text:#1d1d1b;--muted:#5c5c57;"
  + "--line:#deded8;--pass:#1f7a3a;--fail:#b42318;--warn:#8a5a00;--warn-bg:#fff4d6}"
  + "@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#20201e;--text:#ececea;--muted:#a3a39c;"
  + "--line:#3a3a36;--pass:#5cc27a;--fail:#ff7a6e;--warn:#f2c14e;--warn-bg:#3a2f10}}"
  + "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}"
  + "main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}"
  + ".muted{color:var(--muted)}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));margin-top:16px}"
  + "section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;min-width:0}"
  + "h2{font-size:16px;margin:0 0 6px;overflow-wrap:anywhere}code{font-size:13px;overflow-wrap:anywhere}"
  + "dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:8px 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}"
  + "ul{margin:4px 0 0;padding-left:18px}.pass{color:var(--pass)}.fail{color:var(--fail)}"
  + ".tag{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 6px;font-size:12px;margin-left:6px}"
  + ".warn{background:var(--warn-bg);color:var(--warn);border-radius:6px;padding:6px 8px;margin-top:8px}"

function gateClass(state: string): string {
  if (state === "pass") return "pass"
  return state === "not run" ? "muted" : "fail"
}

function renderTask(task: BoardTask): string {
  const gates = task.gates.length === 0 ? "<p class=\"muted\">No gates.</p>" : `<ul>${task.gates.map(gate =>
    `<li><code>${escapeHtml(gate.name)}</code> <span class="muted">${gate.required ? "required" : "optional"}</span> `
    + `<span class="${gateClass(gate.state)}">${escapeHtml(gate.state)}</span></li>`).join("")}</ul>`
  return `<p><strong>${escapeHtml(task.title)}</strong><br><code class="muted">${escapeHtml(task.id)}</code></p>`
    + `<dl><dt>Size</dt><dd>${escapeHtml(task.size)}</dd><dt>Phase</dt><dd>${escapeHtml(task.phase)}</dd>`
    + `<dt>Next</dt><dd>${escapeHtml(task.next)}</dd><dt>Blockers</dt><dd>${escapeHtml(task.blockers)}</dd></dl>`
    + gates
    + (task.baseWarning === null ? "" : `<p class="warn">${escapeHtml(task.baseWarning)}</p>`)
}

function renderEntry(entry: BoardEntry): string {
  const body = entry.error !== undefined
    ? `<p class="fail">Cannot read this worktree's task: ${escapeHtml(entry.error)}</p>`
    : entry.task === null ? "<p class=\"muted\">No active task.</p>" : renderTask(entry.task)
  return `<section><h2>${escapeHtml(entry.branch ?? "(detached HEAD)")}`
    + `${entry.current ? "<span class=\"tag\">this worktree</span>" : ""}</h2>`
    + `<code class="muted">${escapeHtml(entry.path)}</code>${body}</section>`
}

/** Static, escaped HTML with no scripts or remote resources; it shows stored facts at one moment. */
export function renderBoard(entries: BoardEntry[], generatedAt: Date): string {
  const active = entries.filter(entry => entry.task !== null).length
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    + "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"
    + `<title>Junto board</title><style>${STYLE}</style></head><body><main>`
    + "<h1>Junto board</h1>"
    + `<p class="muted">${entries.length} worktree${entries.length === 1 ? "" : "s"}, ${active} with an active task. `
    + `Generated ${escapeHtml(generatedAt.toISOString())}; read-only. Run /junto:status for current state.</p>`
    + `<div class="grid">${entries.map(renderEntry).join("")}</div></main></body></html>\n`
}

/** Write `.junto/board.html` and keep it out of Git, like runtime logs, via `.junto/.gitignore`. */
export function exportBoard(root: string, entries: BoardEntry[], generatedAt = new Date()): string {
  const dir = juntoDir(root)
  mkdirSync(dir, { recursive: true })
  const ignore = join(dir, ".gitignore")
  if (!existsSync(ignore)) writeFileSync(ignore, `*.log\n${BOARD_FILE}\n`, "utf-8")
  else {
    const text = readFileSync(ignore, "utf-8")
    if (!text.split(/\r?\n/).some(line => line.trim() === BOARD_FILE)) {
      appendFileSync(ignore, `${text === "" || text.endsWith("\n") ? "" : "\n"}${BOARD_FILE}\n`, "utf-8")
    }
  }
  const path = join(dir, BOARD_FILE)
  writeFileSync(path, renderBoard(entries, generatedAt), "utf-8")
  return path
}
