/* Pembaca teks nota (OCR) di perangkat — Tesseract (WebAssembly). Pesan masuk: { id, gambar: ArrayBuffer PNG/JPG } → keluar: { id, teks } / { id, galat }. */
/* global TesseractCore */
let siap = null;
function muat(){
  if (siap) return siap;
  siap = (async () => {
    importScripts("tesseract-core-lstm.js");
    const M = await TesseractCore({ locateFile: f => f });
    const data = new Uint8Array(await (await fetch("eng.traineddata")).arrayBuffer());
    M.FS.writeFile("eng.traineddata", data);
    const api = new M.TessBaseAPI();
    if (api.Init(null, "eng") !== 0) throw new Error("Model OCR gagal dimuat");
    api.SetVariable("tessedit_pageseg_mode", "6"); // satu blok teks seragam (cocok untuk struk)
    api.SetVariable("preserve_interword_spaces", "1");
    return { M, api };
  })();
  siap.catch(() => { siap = null; });
  return siap;
}
self.onmessage = async e => {
  const { id, gambar } = e.data || {};
  try {
    const { M, api } = await muat();
    M.FS.writeFile("/input", new Uint8Array(gambar));
    if (api.SetImageFile(1, 0) === 1) throw new Error("Gambar tidak bisa dibaca");
    api.Recognize(null);
    self.postMessage({ id, teks: api.GetUTF8Text() });
  } catch (err) { self.postMessage({ id, galat: String((err && err.message) || err) }); }
};
