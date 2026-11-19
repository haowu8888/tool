import("/assets/index-CloI8kUO.js?x=" + Date.now()).then(() => "ok: " + document.querySelector("#app").innerHTML.length, (e) => "err: " + e.stack)
