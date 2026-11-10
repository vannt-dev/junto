// Puts the recorded task (site/replay/junto.jsonl, from record.mjs) into site/index.html, between
// <!-- replay:log --> and <!-- /replay:log -->, and the final numbers into the meters.
//   node site/replay/render.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const page = join(here, "..", "index.html")
const steps = readFileSync(join(here, "junto.jsonl"), "utf-8").trim().split("\n").map(line => JSON.parse(line))

const esc = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const attr = data => Object.entries(data).map(([key, value]) => ` data-${key}="${esc(String(value))}"`).join("")

/** Colour only: a refusal or a failed gate, and a passed gate. The text is what was printed. */
function tone(line) {
  if (/^Cannot transition|^PreToolUse hook: deny|^## \S+ - fail/.test(line)) return " bad"
  if (/^## \S+ - pass/.test(line)) return " ok"
  return ""
}

const lines = []
let last = {}
for (const step of steps) {
  const isGate = step.cmd.startsWith("gate:")
  const isNote = step.cmd.startsWith("#")
  // Tool calls and the person's prompt get the prompt sign of the terminal in the hero.
  const shown = isGate ? `› ${step.cmd.slice(5).trim()}` : isNote ? step.cmd : step.cmd.replace(/^> /, "› ")
  const kind = isGate ? "ln cmd gate" : isNote ? "ln note" : "ln cmd"
  lines.push(`<span class="${kind}"${attr({ step: step.step, sec: step.ms / 1000, ...step.state })}>${esc(shown)}</span>`)
  for (const line of step.out ? step.out.split("\n") : []) lines.push(`<span class="ln${tone(line)}">${esc(line)}</span>`)
  last = step.state
}

const total = (steps.reduce((sum, step) => sum + step.ms, 0) / 1000).toFixed(1)
const calls = steps.filter(step => step.cmd.startsWith("> junto__")).length
const log = `<!-- replay:log --><pre class="rp-log" id="rp-log" tabindex="0">${lines.join("")}</pre><!-- /replay:log -->`
let html = readFileSync(page, "utf-8").replace(/<!-- replay:log -->[\s\S]*?<!-- \/replay:log -->/, () => log)
for (const [key, value] of Object.entries({ ...last, total, calls })) {
  html = html.replace(new RegExp(`(<span id="rp-${key}">)[^<]*(</span>)`), (_, open, close) => `${open}${value}${close}`)
}
writeFileSync(page, html)
console.log(`${lines.length} lines, ${calls} tool calls, ${total} s of real time; meters ${JSON.stringify(last)}`)
