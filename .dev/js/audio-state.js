// Whether the page may play sound without a click: an AudioContext made
// now runs ("running") or waits for a user gesture ("suspended").
//   node .dev/cdp.mjs @.dev/js/audio-state.js bubble
(async () => {
  const ctx = new AudioContext();
  await new Promise((r) => setTimeout(r, 200));
  const state = ctx.state;
  await ctx.close();
  return { state, clicked: navigator.userActivation.hasBeenActive };
})()
