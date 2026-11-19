(async () => {
  const s = await mygo.call("Settings.Get");
  s.widget.show = false;
  await mygo.call("Settings.Save", s);
  await new Promise((r) => setTimeout(r, 800));
  s.widget.show = true;
  await mygo.call("Settings.Save", s);
  await new Promise((r) => setTimeout(r, 800));
  return "toggled";
})()
