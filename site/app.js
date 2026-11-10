const copyButton = document.querySelector("[data-copy]")
const installCode = document.querySelector("[data-install]")

copyButton?.addEventListener("click", async () => {
  if (!(installCode instanceof HTMLElement)) return
  try {
    await navigator.clipboard.writeText(installCode.innerText)
    copyButton.textContent = "Copied"
    window.setTimeout(() => { copyButton.textContent = "Copy" }, 1800)
  } catch {
    copyButton.textContent = "Select to copy"
  }
})

// Replays the recorded task (#replay). Without JavaScript, or with reduced motion, the whole log
// and the final numbers stay as they are in the markup.
;(() => {
  const box = document.getElementById("replay")
  const log = document.getElementById("rp-log")
  if (!box || !log) return
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
  const $ = id => document.getElementById(id)
  const play = $("rp-play"), pause = $("rp-pause"), restart = $("rp-restart")
  const gate = $("rp-wait"), go = $("rp-go")
  const steps = [...document.querySelectorAll("#rp-steps li")]
  const lines = [...log.querySelectorAll(".ln")].map(el => ({
    el,
    text: el.textContent,
    typed: el.classList.contains("cmd") || el.classList.contains("note"),
    gate: el.classList.contains("gate"),
    d: el.dataset,
    approved: false,
  }))
  const METERS = ["phase", "plan", "gates", "evidence"]
  // ms per typed character, per real second of a call, per printed line
  const TICK = 40, CHAR = 22, PER_SEC = 1500, LINE = 30
  let i = 0, t = 0, typing = true, playing = false, waiting = false, timer

  function show(line) {
    line.el.classList.add("on")
    log.scrollTop = log.scrollHeight
  }
  function meters(d) {
    for (const key of METERS) if (d[key] !== undefined) $(`rp-${key}`).textContent = d[key]
  }
  function mark(n) {
    steps.forEach((step, k) => {
      step.classList.toggle("now", k === n)
      step.classList.toggle("past", k < n)
    })
  }
  function buttons() {
    play.hidden = playing || waiting || i >= lines.length
    pause.hidden = !playing
    restart.hidden = !playing && i === 0 && t === 0
  }
  function stop() {
    playing = false
    clearInterval(timer)
    buttons()
  }
  function start() {
    if (playing || waiting) return
    playing = true
    box.classList.remove("idle")
    timer = setInterval(tick, TICK)
    buttons()
  }
  function reset() {
    stop()
    i = 0; t = 0; typing = true; waiting = false
    gate.hidden = true
    for (const line of lines) {
      line.approved = false
      line.el.classList.remove("on", "busy")
      line.el.textContent = line.text
    }
    for (const key of METERS) $(`rp-${key}`).textContent = "-"
    mark(-1)
    box.classList.add("armed", "idle")
    log.scrollTop = 0
    buttons()
  }
  function next() {
    i += 1; t = 0; typing = true
  }
  function tick() {
    const line = lines[i]
    if (!line) {
      stop()
      mark(steps.length)
      return
    }
    t += TICK
    if (!line.typed) {
      if (t >= LINE) { show(line); next() }
      return
    }
    if (typing) {
      if (line.gate && !line.approved) {
        // The person's step: the replay waits for the visitor, as the task waits for a person.
        waiting = true
        mark(Number(line.d.step))
        gate.hidden = false
        stop()
        return
      }
      mark(Number(line.d.step))
      const n = Math.min(line.text.length, Math.floor(t / CHAR))
      line.el.textContent = line.text.slice(0, n)
      show(line)
      if (n >= line.text.length) { typing = false; t = 0; line.el.classList.add("busy") }
      return
    }
    // The call runs for a time in proportion to how long it really took.
    if (t < Math.max(300, Number(line.d.sec || 0) * PER_SEC)) return
    line.el.classList.remove("busy")
    meters(line.d)
    next()
  }
  go.addEventListener("click", () => {
    const line = lines[i]
    if (line) line.approved = true
    waiting = false
    gate.hidden = true
    start()
  })
  play.addEventListener("click", start)
  pause.addEventListener("click", stop)
  restart.addEventListener("click", () => { reset(); start() })
  reset()
})()
