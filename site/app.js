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
