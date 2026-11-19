// Reports the recording panel's state and text: run in the ?rec page.
(async () => ({ state: await mygo.call("Record.State"), text: document.querySelector("#app").innerText.replace(/\s+/g, " "), size: [innerWidth, innerHeight] }))();
