/* Email mentah (MIME) → { subjek, dari, teks } polos, untuk dibaca pembaca email Shopee.
   Mendukung multipart, base64, quoted-printable, dan HTML (diubah ke teks per baris). */
const dekoder = cs => { try { return new TextDecoder(cs || "utf-8"); } catch { return new TextDecoder("utf-8"); } };
function pisahHeader(bagian){
  const i = bagian.search(/\r?\n\r?\n/);
  const kepala = i < 0 ? bagian : bagian.slice(0, i), badan = i < 0 ? "" : bagian.slice(i).replace(/^\r?\n\r?\n/, "");
  const h = {};
  for (const baris of kepala.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) { const j = baris.indexOf(":"); if (j > 0) h[baris.slice(0, j).trim().toLowerCase()] = baris.slice(j + 1).trim(); }
  return { h, badan };
}
const param = (nilai, nama) => { const m = String(nilai || "").match(new RegExp(nama + '\\s*=\\s*"?([^";]+)"?', "i")); return m ? m[1] : ""; };
function bytesDari(badan, cte){
  cte = String(cte || "").toLowerCase();
  if (cte === "base64") { const b = atob(badan.replace(/[^A-Za-z0-9+/=]/g, "")); return Uint8Array.from(b, c => c.charCodeAt(0)); }
  if (cte === "quoted-printable") {
    const t = badan.replace(/=\r?\n/g, ""), out = [];
    for (let i = 0; i < t.length; i++) { if (t[i] === "=" && /^[0-9A-F]{2}$/i.test(t.substr(i + 1, 2))) { out.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; } else out.push(t.charCodeAt(i) & 255); }
    return Uint8Array.from(out);
  }
  return Uint8Array.from(badan, c => c.charCodeAt(0) & 255);
}
/** Header terenkode (=?UTF-8?B?...?= / ?Q?) → teks. */
function headerTeks(v){
  return String(v || "").replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, cs, enc, isi) => {
    try { const b = enc.toUpperCase() === "B" ? bytesDari(isi, "base64") : bytesDari(isi.replace(/_/g, " "), "quoted-printable"); return dekoder(cs).decode(b); } catch { return isi; }
  });
}
export function htmlKeTeks(html){
  return String(html)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|table|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .split("\n").map(x => x.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
}
function kumpulkan(bagian, hasil){
  const { h, badan } = pisahHeader(bagian);
  const ct = h["content-type"] || "text/plain";
  if (/^multipart\//i.test(ct)) {
    const batas = param(ct, "boundary"); if (!batas) return;
    for (const p of badan.split("--" + batas).slice(1)) { if (/^--/.test(p)) break; kumpulkan(p.replace(/^\r?\n/, ""), hasil); }
    return;
  }
  if (/^message\/rfc822/i.test(ct)) return kumpulkan(badan, hasil);
  if (!/^text\/(plain|html)/i.test(ct) || /attachment/i.test(h["content-disposition"] || "")) return;
  const teks = dekoder(param(ct, "charset")).decode(bytesDari(badan, h["content-transfer-encoding"]));
  (/html/i.test(ct) ? hasil.html : hasil.plain).push(/html/i.test(ct) ? htmlKeTeks(teks) : teks);
}
export function mimeKeTeks(raw){
  const { h } = pisahHeader(raw);
  const hasil = { plain: [], html: [] };
  kumpulkan(raw, hasil);
  // HTML lebih lengkap untuk email Shopee; teks polos sebagai cadangan
  const teks = (hasil.html.join("\n") || hasil.plain.join("\n")).slice(0, 200000);
  return { subjek: headerTeks(h.subject || ""), dari: headerTeks(h.from || ""), teks };
}
