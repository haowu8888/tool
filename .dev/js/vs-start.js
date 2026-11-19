mygo.call("VirtualScreen.Start").then(() => "started", (e) => "failed: " + (e?.message ?? e))
