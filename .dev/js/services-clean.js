(async () => { for (const v of await mygo.call("Services.List")) await mygo.call("Services.Delete", v.id); return (await mygo.call("Services.List")).length; })()
