(() => { const d = document.querySelector("dialog.v-failed"); return d ? (d.open ? "open: " : "closed: ") + d.innerText.replace(/\s+/g, " ").slice(0, 400) : "no dialog"; })()
