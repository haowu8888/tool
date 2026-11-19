// 覆盖原图 on a copy of testdata/ocr-en.png in the temp folder: the PNG
// written back is the one given; another format is refused.
(async () => {
  const p = "FILE"; // sed: the copy's path, each backslash written \\\\
  await mygo.call("ImageEdit.OpenPath", p);
  const c = document.createElement("canvas");
  c.width = 7;
  c.height = 5;
  const b = await new Promise((r) => c.toBlob(r, "image/png"));
  const data = await new Promise((r) => {
    const f = new FileReader();
    f.onload = () => r(String(f.result).split(",")[1]);
    f.readAsDataURL(b);
  });
  await mygo.call("ImageEdit.Overwrite", p, data, "png");
  let jpg = "";
  try {
    await mygo.call("ImageEdit.Overwrite", p, data, "jpeg");
  } catch (e) {
    jpg = String(e.message || e);
  }
  const back = await mygo.call("ImageEdit.OpenPath", p);
  const img = new Image();
  img.src = back.url;
  await img.decode();
  return { size: back.size, wrote: b.size, dims: `${img.naturalWidth}x${img.naturalHeight}`, jpg };
})()
