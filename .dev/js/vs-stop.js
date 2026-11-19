mygo.call("VirtualScreen.Stop").then(() => "stopped", (e) => "failed: " + (e?.message ?? e))
