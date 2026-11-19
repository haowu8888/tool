// bun .dev/js/wm-tune.ts: runs inpaint on .dev/js/wm-{tight,box}.bin, a
// watermark over hair and lace with its strokes painted (tight) or boxed,
// written as [w, h (u32 LE), RGBA, mask], and writes wm-*.out. The tuning
// of 2026-11-18 compared patch sizes and ways to vote this way.
import { inpaint } from "../../src/inpaint";
for (const n of ["tight", "box"]) {
  const buf = new Uint8Array(await Bun.file(`.dev/js/wm-${n}.bin`).arrayBuffer());
  const dv = new DataView(buf.buffer);
  const w = dv.getUint32(0, true);
  const h = dv.getUint32(4, true);
  const data = new Uint8ClampedArray(buf.slice(8, 8 + w * h * 4));
  const mask = buf.slice(8 + w * h * 4, 8 + w * h * 5);
  const t0 = performance.now();
  const out = await inpaint({ data, width: w, height: h }, mask);
  console.log(n, Math.round(performance.now() - t0), "ms");
  await Bun.write(`.dev/js/wm-${n}.out`, out);
}
