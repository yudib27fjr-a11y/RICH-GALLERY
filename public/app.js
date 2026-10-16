import { eanValid, eanSVG, barcodeDefault, periodeDari, geserPeriode, tambahHari, pad, tebakKategori } from "./shared.js";

/* ================= util ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rp = n => (n < 0 ? "-Rp" : "Rp") + Math.abs(Math.round(n || 0)).toLocaleString("id-ID");
const num = v => { if (typeof v === "number") return v; const s = String(v ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."); const n = parseFloat(s); return isNaN(n) ? 0 : n; };
const fq = n => (Math.round((n || 0) * 100) / 100).toLocaleString("id-ID");
const angka = n => (n < 0 ? "-" : "") + Math.abs(Math.round(n)).toLocaleString("id-ID");
const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const tglID = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${+d} ${BULAN[+m - 1]} ${y}`; };
const tglPendek = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; };
const toTitle = s => String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const bulanAkhir = ym => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(new Date(y, m, 0).getDate())}`; };

/* ================= state ================= */
let B = null;              // data dari /api/bootstrap
let versiLayar = "";       // versi data yang sedang tampil (lihat "data selalu terbaru")
const isAdmin = () => B?.me.peran === "admin";
const today = () => B?.hariIni || new Date().toISOString().slice(0, 10);
const prodBy = id => B.produk.find(p => p.id === id);
const bahanBy = id => B.bahan.find(p => p.id === id);
function statusStok(s, min){ if (s <= 0) return ["HABIS", "bad"]; if (s <= (min || 0)) return ["SEDIKIT", "warn"]; return ["AMAN", "ok"]; }

/* Pengaturan per perangkat (printer, tema) — disimpan di browser ini saja */
const DKEY = "rg_perangkat";
let D = { kertas: 58, modeCetak: "chrome", tema: "" };
try { D = { ...D, ...JSON.parse(localStorage.getItem(DKEY) || "{}") }; } catch {}
const simpanD = () => { try { localStorage.setItem(DKEY, JSON.stringify(D)); } catch {} };
function terapkanTema(){ if (D.tema) document.documentElement.setAttribute("data-theme", D.tema); else document.documentElement.removeAttribute("data-theme"); }
terapkanTema();

/* ================= WebView lama (Chrome < 84): "gap" pada flexbox belum didukung ================= */
/* Perangkat kasir seperti iMin sering membawa WebView lama. Bila gap flex tidak didukung, jaraknya diganti margin. */
(function gapFlexLama(){
  const uji = document.createElement("div");
  uji.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden";
  uji.appendChild(document.createElement("div")); uji.appendChild(document.createElement("div"));
  document.body.appendChild(uji); const didukung = uji.scrollHeight === 1 && !window.__rgUjiGapLama; uji.remove();
  if (didukung) return;
  document.documentElement.classList.add("tanpa-gap-flex");
  const px = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const atur = el => {
    const cs = getComputedStyle(el);
    if (cs.display !== "flex" && cs.display !== "inline-flex") return;
    const rg = px(cs.rowGap), cg = px(cs.columnGap);
    if (!rg && !cg) return;
    const kolom = cs.flexDirection.indexOf("column") === 0, bungkus = cs.flexWrap !== "nowrap";
    const anak = Array.prototype.filter.call(el.children, c => { const s = getComputedStyle(c); return s.display !== "none" && s.position !== "absolute" && s.position !== "fixed"; });
    anak.forEach((c, i) => {
      const akhir = i === anak.length - 1;
      if (kolom) { c.style.marginBottom = akhir ? "" : rg + "px"; if (bungkus && cg) c.style.marginRight = cg + "px"; }
      else { c.style.marginRight = akhir ? "" : cg + "px"; if (bungkus && rg) c.style.marginBottom = rg + "px"; }
    });
  };
  const proses = akar => { if (akar.nodeType !== 1) return; atur(akar); akar.querySelectorAll("*").forEach(atur); };
  let akarAntre = new Set(), antre = false;
  const jadwal = akar => {
    akarAntre.add(akar);
    if (antre) return; antre = true;
    requestAnimationFrame(() => {
      antre = false; const daftar = akarAntre; akarAntre = new Set();
      daftar.forEach(a => { if (a.isConnected !== false) proses(a); });
    });
  };
  new MutationObserver(rec => rec.forEach(r => { if (r.target.nodeType === 1) { jadwal(r.target); r.addedNodes.forEach(n => { if (n.nodeType === 1) jadwal(n); }); } }))
    .observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", () => jadwal(document.body));
  jadwal(document.body);
})();

/* ================= API ================= */
class ApiError extends Error { constructor(status, msg){ super(msg); this.status = status; } }
/* Di aplikasi Android mode offline, API dijalankan oleh mesin lokal (public/lokal/mesin.js) — aturannya sama dengan server. */
const NATIVE = window.RGNative || null;
const LOKAL = location.hostname === "rg.lokal";
/* Perangkat kasir dengan printer bawaan (iMin "BluetoothPrinter", Sunmi "InnerPrinter"): pakai cetak langsung ESC/POS,
   hasilnya teks hitam tajam. Hanya otomatis bila pengguna belum pernah memilih cara cetak sendiri. */
const statusPrinterLangsung = () => { try { return NATIVE && NATIVE.printerLangsung ? String(NATIVE.printerLangsung() || "") : ""; } catch { return ""; } };
if (!D.modeDipilih && NATIVE && NATIVE.cetakLangsung) { const st = statusPrinterLangsung(); if (st && st !== "izin") D.modeCetak = "langsung"; }
async function api(method, url, body){
  if (window.RG_LOKAL) {
    const r = await window.RG_LOKAL.request(method, url, body);
    const data = r.data || {};
    if (r.status === 401 && url !== "/api/login" && url !== "/api/akun/password") { tampilLogin("Sesi berakhir, silakan masuk lagi."); throw new ApiError(401, data.error || "Silakan masuk dulu"); }
    if (r.status >= 400) throw new ApiError(r.status, data.error || "Terjadi kesalahan");
    return r.unduh ? r : data;
  }
  let r;
  try { r = await fetch(url, { method, credentials: "same-origin", headers: { "X-RG": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError(0, "Tidak terhubung ke server. Periksa koneksi internet lalu coba lagi."); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== "/api/login" && url !== "/api/akun/password") { tampilLogin("Sesi berakhir, silakan masuk lagi."); throw new ApiError(401, data.error || "Silakan masuk dulu"); }
  if (!r.ok) throw new ApiError(r.status, data.error || "Terjadi kesalahan");
  return data;
}
/** Jalankan aksi; tampilkan pesan galat sebagai toast. Mengembalikan undefined bila gagal. */
async function coba(fn, tombol){
  if (tombol) tombol.disabled = true;
  try { return await fn(); }
  catch (e) { if (e.status !== 401) toast(e.message); }
  finally { if (tombol) tombol.disabled = false; }
}
async function muatUlang(){ const b = await api("GET", "/api/bootstrap"); B = b; if (b && b.versi !== undefined) versiLayar = b.versi; }

/* Galat tak terduga ditampilkan, bukan diam saja (mis. fitur browser yang belum ada di WebView perangkat lama). */
window.addEventListener("error", e => { try { toast("Galat: " + (e.message || "tidak diketahui")); } catch {} });
window.addEventListener("unhandledrejection", e => { try { const m = e.reason && e.reason.message; if (!(e.reason && e.reason.status === 401)) toast("Galat: " + (m || "tidak diketahui")); } catch {} });

/* ================= toast & modal ================= */
let tt;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3200); }
function modal(html, onMount){
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="sheet">${html}</div></div>`;
  const m = root.firstElementChild;
  m.addEventListener("click", e => { if (e.target === m) closeModal(); });
  $$("[data-close]", m).forEach(b => b.onclick = closeModal);
  onMount && onMount(m);
  const f = m.querySelector("input:not([type=checkbox]),select,textarea"); if (f && !("ontouchstart" in window)) f.focus();
  return m;
}
function closeModal(){ $("#modalRoot").innerHTML = ""; }
/* Tombol kembali Android: tutup jendela/keranjang dulu sebelum keluar aplikasi. */
window.rgBack = () => {
  if ($("#modalRoot .modal")) { closeModal(); return true; }
  const c = $("#cart.open"); if (c) { c.classList.remove("open"); return true; }
  if (B && view !== "kasir") { pindah("kasir"); return true; }
  return false;
};
function konfirmasi(judul, pesan, label, fn, danger = true){
  modal(`<h3>${esc(judul)}</h3><p>${esc(pesan)}</p><div class="actions"><button class="btn" data-close>Batal</button><button class="btn ${danger ? "danger" : "pri"}" id="okc">${esc(label)}</button></div>`,
    m => $("#okc", m).onclick = async e => { e.target.disabled = true; closeModal(); await fn(); });
}
function unduhTeks(nama, teks, tipe){
  if (NATIVE && NATIVE.simpanFile) { const b64 = btoa(unescape(encodeURIComponent(teks))); const lok = NATIVE.simpanFile(nama, tipe, b64); toast(lok ? `Tersimpan di ${lok}` : "Gagal menyimpan file"); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([teks], { type: tipe })); a.download = nama; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); }
function unduhCSV(nama, rows){ unduhTeks(nama, "﻿" + rows.map(r => r.map(v => { v = String(v ?? ""); return /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",")).join("\r\n"), "text/csv"); }

/* ================= struk & cetak termal ================= */
function wrap(text, w){ const out = []; String(text).split("\n").forEach(par => { let line = ""; par.split(/\s+/).forEach(word => { while (word.length > w) { if (line) { out.push(line); line = ""; } out.push(word.slice(0, w)); word = word.slice(w); } if (!word) return; if ((line ? line.length + 1 : 0) + word.length > w) { out.push(line); line = word; } else line = line ? line + " " + word : word; }); out.push(line); }); return out; }
const center = (t, w) => { t = t.slice(0, w); return " ".repeat(Math.floor((w - t.length) / 2)) + t; };
const lr = (a, b, w) => { const sp = w - a.length - b.length; return sp >= 1 ? a + " ".repeat(sp) + b : a.slice(0, Math.max(0, w - b.length - 1)) + " " + b; };
const lebar = () => D.kertas == 80 ? 48 : 32;
function strukLines(s){
  const t = B.toko, w = lebar(), garis = "-".repeat(w), L = [];
  L.push({ t: center(t.nama_toko, w), b: 1 });
  wrap(t.alamat, w).forEach(x => L.push({ t: center(x, w) }));
  if (t.telp) L.push({ t: center("Telp " + t.telp, w) });
  L.push({ t: garis }, { t: lr("No", s.no, w) }, { t: lr("Tanggal", tglPendek(s.tgl) + " " + s.jam, w) }, { t: lr("Kasir", s.kasir || "-", w) });
  if (s.pelanggan) L.push({ t: lr("Pelanggan", s.pelanggan.slice(0, w - 11), w) });
  if (s.hp) L.push({ t: lr("No HP", s.hp, w) });
  L.push({ t: garis });
  s.items.forEach(it => { wrap(it.nama, w).forEach(x => L.push({ t: x })); L.push({ t: lr(`  ${fq(it.qty)} x ${angka(it.harga)}`, angka(it.harga * it.qty), w) }); });
  L.push({ t: garis }, { t: lr("Subtotal", angka(s.subtotal), w) });
  if (s.diskon) L.push({ t: lr("Diskon", "-" + angka(s.diskon), w) });
  if (s.ongkir) L.push({ t: lr("Ongkir", angka(s.ongkir), w) });
  L.push({ t: lr("TOTAL", "Rp" + angka(s.total), w), b: 1 }, { t: lr("Bayar (" + s.metode + ")", angka(s.bayar), w) });
  if (s.metode === "Tunai" && s.bayar > s.total) L.push({ t: lr("Kembali", angka(s.bayar - s.total), w) });
  if (s.bayar < s.total) L.push({ t: lr("SISA / DP", angka(s.total - s.bayar), w), b: 1 });
  if (s.catatan) { L.push({ t: garis }); wrap("Catatan: " + s.catatan, w).forEach(x => L.push({ t: x })); }
  if (s.batal_at) L.push({ t: center("*** DIBATALKAN ***", w), b: 1 });
  L.push({ t: garis });
  t.footer.split("\n").forEach(x => wrap(x, w).forEach(y => L.push({ t: center(y, w) })));
  return L;
}
const strukText = s => strukLines(s).map(l => l.t).join("\n");
/* ---------- ESC/POS: teks asli untuk printer termal (tajam, hitam pekat) ---------- */
const ESC = "\x1B", GS = "\x1D";
const ascii = t => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E]/g, "?");
function escposStruk(lines){
  let s = ESC + "@" + ESC + "t\x00";
  lines.forEach(l => { s += (l.b ? ESC + "E\x01" : "") + ascii(l.t) + (l.b ? ESC + "E\x00" : "") + "\n"; });
  return s + "\n\n\n" + GS + "V\x41\x03";
}
/** Kirim ESC/POS ke printer: langsung ke printer bawaan, atau lewat aplikasi RawBT. Mengembalikan true bila terkirim. */
function kirimEscpos(s){
  if (D.modeCetak === "langsung" && NATIVE && NATIVE.cetakLangsung) { NATIVE.cetakLangsung(btoa(s)); toast("Mencetak…"); return true; }
  if (D.modeCetak === "rawbt" || D.modeCetak === "langsung") { window.location.href = "rawbt:base64," + btoa(s); return true; }
  return false;
}
function cetakBaris(lines){
  if (kirimEscpos(escposStruk(lines))) return;
  const mm = D.kertas == 80 ? 80 : 58, cw = mm == 80 ? 72 : 48, chars = lebar();
  $("#page-style").textContent = `@page{size:${mm}mm auto;margin:0}`;
  $("#print-area").innerHTML = `<pre style="width:${cw}mm;margin:0 ${(mm - cw) / 2}mm;padding:2mm 0 8mm;font-size:${(cw / chars / 0.6).toFixed(2)}mm">${lines.map(l => l.b ? `<b>${esc(l.t)}</b>` : esc(l.t)).join("\n")}</pre>`;
  setTimeout(cetakHalaman, 60);
}
const cetak = s => cetakBaris(strukLines(s));
/** Di aplikasi Android, window.print tidak tersedia; cetak lewat layanan cetak Android. */
function cetakHalaman(){ if (NATIVE && NATIVE.cetak) NATIVE.cetak(D.kertas); else window.print(); }
function waLink(s){ let hp = (s.hp || "").replace(/\D/g, ""); if (hp.startsWith("0")) hp = "62" + hp.slice(1); return `https://wa.me/${hp}?text=` + encodeURIComponent("```\n" + strukText(s) + "\n```"); }
function lihatStruk(s, setelahBatal){
  modal(`<h3>Struk ${esc(s.no)}</h3>
    <pre class="receipt-prev">${esc(strukText(s))}</pre>
    ${s.batal_at ? `<p class="small muted">Dibatalkan oleh ${esc(s.batal_oleh || "-")}${s.batal_alasan ? ": " + esc(s.batal_alasan) : ""}</p>` : ""}
    <div class="actions">
      ${!s.batal_at && isAdmin() ? `<button class="btn danger" id="voidBtn">Batalkan transaksi</button>` : ""}
      <a class="btn" href="${waLink(s)}" target="_blank" rel="noopener">Kirim WA</a>
      <button class="btn" data-close>Tutup</button>
      <button class="btn pri" id="printBtn">Cetak struk</button>
    </div>`, m => {
      $("#printBtn", m).onclick = () => cetak(s);
      const vb = $("#voidBtn", m);
      if (vb) vb.onclick = () => modal(`<h3>Batalkan ${esc(s.no)}?</h3><p>Transaksi ditandai batal dan stok produk READY dikembalikan.</p>
          <label class="f">Alasan<input type="text" id="alasan" placeholder="Contoh: salah input harga"></label>
          <div class="actions"><button class="btn" data-close>Kembali</button><button class="btn danger" id="okv">Batalkan transaksi</button></div>`, m2 => {
          $("#okv", m2).onclick = e => coba(async () => { await api("POST", `/api/penjualan/${s.id}/batal`, { alasan: $("#alasan", m2).value }); closeModal(); toast("Transaksi dibatalkan, stok dikembalikan"); await muatUlang(); setelahBatal ? setelahBatal() : render(); }, e.target);
        });
    });
}

/* ================= barcode ================= */
const labelBarcode = (x, jenis) => eanValid(x.barcode || "") ? x.barcode : barcodeDefault(jenis, x.kode);
function cariScan(kode){
  const k = String(kode).trim(), up = k.toUpperCase();
  for (const [jenis, arr] of [["produk", B.produk], ["bahan", B.bahan]]) {
    const x = arr.find(i => i.barcode === k) || arr.find(i => barcodeDefault(jenis, i.kode) === k);
    if (x) return { jenis, x };
  }
  const p = B.produk.find(i => i.kode === up); if (p) return { jenis: "produk", x: p };
  const b = B.bahan.find(i => i.kode === up); if (b) return { jenis: "bahan", x: b };
  return null;
}
function cetakLabel(daftar){ // [{x, jenis, n}]
  const mm = D.kertas == 80 ? 80 : 58, cw = mm == 80 ? 72 : 48, w = lebar();
  if (D.modeCetak === "rawbt" || D.modeCetak === "langsung") {
    let s = ESC + "@";
    daftar.forEach(({ x, jenis, n }) => { const bc = labelBarcode(x, jenis); for (let i = 0; i < n; i++) {
      s += ESC + "a\x01" + ESC + "E\x01" + ascii(x.nama).slice(0, w) + "\n" + ESC + "E\x00";
      if (jenis === "produk" && x.harga) s += "Rp" + angka(x.harga) + "\n";
      s += GS + "h\x50" + GS + "w\x02" + GS + "H\x02" + GS + "f\x00" + GS + "k\x43\x0D" + bc + "\n" + x.kode + "\n\n\n"; } });
    if (kirimEscpos(s + ESC + "a\x00" + GS + "V\x41\x03")) return;
  }
  $("#page-style").textContent = `@page{size:${mm}mm auto;margin:0}`;
  let html = "";
  daftar.forEach(({ x, jenis, n }) => { const bc = labelBarcode(x, jenis); for (let i = 0; i < n; i++) html += `<div style="width:${cw}mm;margin:0 ${(mm - cw) / 2}mm;padding:2mm 0 4mm;text-align:center;font-family:Arial,sans-serif;color:#000;break-inside:avoid;page-break-inside:avoid">
      <div style="font-weight:700;font-size:3.4mm;line-height:1.15">${esc(x.nama)}</div>
      ${jenis === "produk" && x.harga ? `<div style="font-size:3.4mm;font-weight:700">${rp(x.harga)}</div>` : ""}
      <div style="width:${Math.min(cw, 44)}mm;height:16mm;margin:1mm auto 0">${eanSVG(bc).replace("<svg ", '<svg style="width:100%;height:100%" ')}</div>
      <div style="font-size:2.6mm">${esc(x.kode)}</div></div>`; });
  $("#print-area").innerHTML = html;
  setTimeout(cetakHalaman, 60);
}
function modalLabel(awal){
  const baris = awal ? [awal] : [];
  modal(`<h3>Cetak label barcode</h3>
    <p class="small muted">Scan atau ketik barang, isi jumlah label, lalu cetak. Lebar kertas ${D.kertas} mm.</p>
    <div class="row"><label class="f grow">Barang<input type="text" id="lbI" list="lbList" placeholder="Ketik nama, kode, atau scan" autocomplete="off"></label><button class="btn" id="lbAdd" type="button" style="align-self:flex-end">Tambah</button></div>
    <datalist id="lbList">${[...B.produk.map(x => `<option value="${x.kode} · ${esc(x.nama)}">`), ...B.bahan.map(x => `<option value="BAHAN ${x.kode} · ${esc(x.nama)}">`)].join("")}</datalist>
    <div id="lbRows" class="stack" style="margin-top:10px"></div>
    <div class="actions"><button class="btn" data-close>Tutup</button><button class="btn pri" id="lbPrint">Cetak label</button></div>`, m => {
      const draw = () => { $("#lbRows", m).innerHTML = baris.length ? baris.map((r, i) => `<div class="row" style="border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--surface)">
          <div style="width:110px;flex:0 0 auto;background:#fff;border-radius:4px;padding:2px">${eanSVG(labelBarcode(r.x, r.jenis), 30).replace("<svg ", '<svg style="width:100%;height:34px;display:block" ')}</div>
          <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(r.x.nama)}</div><div class="code">${esc(labelBarcode(r.x, r.jenis))}</div></div>
          <input type="number" min="1" value="${r.n}" data-i="${i}" style="width:70px" aria-label="Jumlah label"><button class="btn ghost sm" data-x="${i}" type="button">Hapus</button></div>`).join("") : `<div class="empty">Belum ada barang.</div>`;
        $$("[data-i]", m).forEach(inp => inp.onchange = () => baris[+inp.dataset.i].n = Math.max(1, parseInt(inp.value, 10) || 1));
        $$("[data-x]", m).forEach(b => b.onclick = () => { baris.splice(+b.dataset.x, 1); draw(); }); };
      const tambahBaris = v => { v = v.trim(); if (!v) return;
        const isB = v.startsWith("BAHAN "), kode = (isB ? v.slice(6) : v).split("·")[0].trim();
        const hit = isB ? (() => { const x = B.bahan.find(i => i.kode === kode.toUpperCase()); return x && { jenis: "bahan", x }; })() : cariScan(kode);
        if (!hit) { toast("Barang tidak ditemukan"); return; }
        const ada = baris.find(r => r.x === hit.x); if (ada) ada.n++; else baris.push({ x: hit.x, jenis: hit.jenis, n: 1 });
        $("#lbI", m).value = ""; draw(); };
      $("#lbAdd", m).onclick = () => tambahBaris($("#lbI", m).value);
      $("#lbI", m).onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); tambahBaris(e.target.value); } };
      m._onScan = kode => tambahBaris(kode);
      $("#lbPrint", m).onclick = () => { if (!baris.length) { toast("Tambahkan barang dulu"); return; } cetakLabel(baris); };
      draw();
    });
}

/* Alat scan USB/Bluetooth mengetik sangat cepat lalu Enter. Ketikan cepat seperti itu dianggap hasil scan. */
let scanBuf = "", scanFirst = 0, scanLast = 0;
document.addEventListener("keydown", e => {
  const now = performance.now();
  if (e.key === "Enter") {
    const kode = scanBuf, cepat = kode.length >= 4 && (now - scanFirst) / kode.length < 45 && now - scanLast < 120;
    scanBuf = "";
    if (!cepat || !B) return;
    const el = document.activeElement;
    if (el && el.dataset && el.dataset.scan === "raw") { e.preventDefault(); toast("Barcode terbaca: " + kode); return; }
    e.preventDefault(); e.stopPropagation();
    if (el && typeof el.value === "string" && el.value.endsWith(kode)) { el.value = el.value.slice(0, -kode.length); el.dispatchEvent(new Event("input", { bubbles: true })); }
    onScan(kode.trim());
    return;
  }
  if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { if (now - scanLast > 80) { scanBuf = ""; scanFirst = now; } scanBuf += e.key; scanLast = now; }
}, true);
function onScan(kode){
  const m = $("#modalRoot .modal");
  if (m) { if (m._onScan) m._onScan(kode); else toast("Tutup jendela dulu sebelum scan"); return; }
  const hit = cariScan(kode);
  if (view === "kasir") {
    if (hit && hit.jenis === "produk") return tambahKeKeranjang(hit.x.id);
    if (hit) return toast(`${hit.x.nama} adalah bahan baku, bukan produk jual`);
    return tawarBaru(kode);
  }
  if (view === "produksi" || view === "mutasi") {
    const isProd = view === "produksi" || mBarang === "produk";
    if (!hit) return tawarBaru(kode);
    if ((hit.jenis === "produk") !== isProd) return toast(`${hit.x.nama} bukan ${isProd ? "produk jadi" : "bahan baku"}`);
    isiBarisScan(view === "produksi" ? "p" : "m", hit.x);
    return toast(`${hit.x.nama} +1`);
  }
  if (view === "opname") {
    if (!hit) return tawarBaru(kode);
    if (hit.jenis !== oJenis) { oJenis = hit.jenis; oDraft = {}; }
    oDraft[hit.x.id] = String(num(oDraft[hit.x.id] || 0) + 1); oQ = hit.x.kode; oKat = "SEMUA"; vOpname();
    return toast(`${hit.x.nama}: dihitung ${oDraft[hit.x.id]}`);
  }
  if (hit) { if (view !== "stok") { sJenis = hit.jenis; pindah("stok"); } return bukaItem(hit.jenis, hit.x.id); }
  tawarBaru(kode);
}
function isiBarisScan(pre, x){
  const rows = $$(`.${pre}row`), val = `${x.kode} · ${x.nama}`;
  const sama = rows.find(r => $(`.${pre}I`, r).value === val);
  if (sama) { const q = $(`.${pre}Q`, sama); q.value = num(q.value || 0) + 1; return; }
  let kosong = rows.find(r => !$(`.${pre}I`, r).value);
  if (!kosong) { $(pre === "p" ? "#pAddRow" : "#mAddRow").click(); kosong = $$(`.${pre}row`).pop(); }
  const inp = $(`.${pre}I`, kosong); inp.value = val; inp.dispatchEvent(new Event("input", { bubbles: true }));
  const q = $(`.${pre}Q`, kosong); if (!num(q.value)) q.value = 1;
}
function tawarBaru(kode){
  if (!isAdmin()) return toast(`Barcode ${kode} belum terdaftar. Minta admin menambahkan barangnya.`);
  modal(`<h3>Barcode belum terdaftar</h3><p>Barcode <b class="code" style="font-size:14px">${esc(kode)}</b> belum dimiliki barang mana pun.</p>
    <div class="actions"><button class="btn" data-close>Abaikan</button><button class="btn" id="nbB">Jadikan bahan baru</button><button class="btn pri" id="nbP">Jadikan produk baru</button></div>`, m => {
      $("#nbP", m).onclick = () => { closeModal(); editItem("produk", null, { barcode: kode }); };
      $("#nbB", m).onclick = () => { closeModal(); editItem("bahan", null, { barcode: kode }); };
    });
}

/* ================= layar masuk & setup ================= */
/** Tombol kirim form. e.submitter baru ada di Chrome 81+, WebView perangkat lama (mis. iMin) belum punya. */
const tombolKirim = e => e.submitter || e.target.querySelector('button[type="submit"]');
function tampilLogin(pesan = ""){
  B = null; $("#cartbar").hidden = true; closeModal();
  $("#root").innerHTML = `<div class="auth"><form class="card" id="fLogin" autocomplete="on">
    <div class="merek"><img src="/logo.png" alt="Rich Gallery POS" width="128" height="128"></div>
    <div class="muted">Masuk untuk mulai bekerja</div>
    <label class="f">Nama<input type="text" id="lNama" name="username" autocomplete="username" required></label>
    <label class="f">Password / PIN<input type="password" id="lPw" name="password" autocomplete="current-password" required></label>
    <div class="err" id="lErr">${esc(pesan)}</div>
    <button class="btn pri big" type="submit">Masuk</button>
    <p class="small muted" style="margin:0">Lupa PIN? Minta admin menggantinya di Pengaturan → Pengguna.</p></form></div>`;
  $("#fLogin").onsubmit = async e => {
    e.preventDefault(); const btn = tombolKirim(e); btn.disabled = true; $("#lErr").textContent = ""; const label = btn.textContent; btn.textContent = "Memeriksa…";
    try { await api("POST", "/api/login", { nama: $("#lNama").value, password: $("#lPw").value }); await mulai(); }
    catch (err) { $("#lErr").textContent = err.message; btn.disabled = false; btn.textContent = label; }
  };
}
function tampilSetup(){
  $("#root").innerHTML = `<div class="auth"><form class="card" id="fSetup">
    <div class="merek"><img src="/logo.png" alt="Rich Gallery POS" width="128" height="128"></div>
    <div><b>Selamat datang.</b> <span class="muted">Buat akun admin pertama. Akun ini memegang laporan, pengaturan, dan akun karyawan.</span></div>
    <label class="f">Nama admin<input type="text" id="sNama" autocomplete="username" required maxlength="40"></label>
    <label class="f">Password (min. 8 karakter)<input type="password" id="sPw" autocomplete="new-password" required minlength="8"></label>
    <label class="f">Ulangi password<input type="password" id="sPw2" autocomplete="new-password" required></label>
    <div class="err" id="sErr"></div>
    <button class="btn pri big" type="submit">Buat akun admin</button></form></div>`;
  $("#fSetup").onsubmit = async e => {
    e.preventDefault();
    if ($("#sPw").value !== $("#sPw2").value) { $("#sErr").textContent = "Kedua password tidak sama"; return; }
    const btn = tombolKirim(e); btn.disabled = true; $("#sErr").textContent = ""; const label = btn.textContent; btn.textContent = "Membuat akun…";
    try { await api("POST", "/api/setup", { nama: $("#sNama").value, password: $("#sPw").value }); await mulai(); }
    catch (err) { $("#sErr").textContent = err.message; btn.disabled = false; btn.textContent = label; }
  };
}

/* ================= kerangka & navigasi ================= */
const ICON = {
  kasir: '<path d="M4 7h16l-1.5 9a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
  riwayat: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  produksi: '<circle cx="12" cy="8" r="3"/><path d="M12 5V3M15 8h2M9 8H7M12 11v10M12 17c-3 0-5-2-5-4 3 0 5 2 5 4zM12 15c3 0 5-2 5-4-3 0-5 2-5 4z"/>',
  stok: '<path d="M4 8l8-4 8 4-8 4-8-4z"/><path d="M4 8v8l8 4 8-4V8"/><path d="M12 12v8"/>',
  mutasi: '<path d="M7 4v14M7 18l-3-3M7 18l3-3"/><path d="M17 20V6M17 6l-3 3M17 6l3 3"/>',
  opname: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5h6M9 10l2 2 4-4M9 16h6"/>',
  biaya: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 9.5v5M17 9.5v5"/>',
  laporan: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  atur: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
};
const SEMUA_VIEW = [["kasir", "Kasir"], ["riwayat", "Transaksi"], ["produksi", "Produksi"], ["stok", "Stok"], ["mutasi", "Masuk/Keluar"], ["opname", "Opname"], ["biaya", "Pengeluaran", 1], ["laporan", "Laporan", 1], ["atur", "Pengaturan"]];
const daftarView = () => SEMUA_VIEW.filter(v => !v[2] || isAdmin());
let view = "kasir";
function shell(){
  $("#root").innerHTML = `<div class="app">
    <header class="topbar">
      <div class="brand"><img src="/monogram.png" alt="" width="30" height="30"><h1>${esc(toTitle(B.toko.nama_toko))}</h1><small>POS</small></div>
      <span class="sp"></span>
      ${isAdmin() ? `<span class="sync-dot" id="syncDot" title="Status sinkron Google Sheet"></span>` : ""}
      <span class="userchip"><b>${esc(B.me.nama)}</b><span class="pill mut">${isAdmin() ? "ADMIN" : "KARYAWAN"}</span><button class="btn ghost sm" id="keluar" type="button">Keluar</button></span>
    </header>
    <nav class="tabs" id="tabs"></nav>
    <main id="main"></main></div>`;
  $("#keluar").onclick = async () => { await api("POST", "/api/logout").catch(() => {}); resetCart(); tampilLogin(); };
  if (isAdmin()) { cekSync(); clearInterval(window.__rgCekSync); window.__rgCekSync = setInterval(cekSync, 30_000); }
}
async function cekSync(){
  try {
    if (LOKAL) { // perangkat cabang: lampu menunjukkan kiriman ke server pusat
      const c = await api("GET", "/api/cabang"); const d = $("#syncDot");
      if (d && c.aktif) {
        d.className = "sync-dot " + (c.menunggu ? "pending" : "ok");
        d.title = c.menunggu ? `${c.menunggu} transaksi menunggu dikirim ke server pusat${c.galatTerakhir ? " · " + c.galatTerakhir : ""}` : "Semua transaksi sudah terkirim ke server pusat";
        return;
      }
    }
  } catch {}
  try { const s = await api("GET", "/api/sync"); const d = $("#syncDot"); if (!d) return;
    d.className = "sync-dot " + (!s.aktif ? "" : s.galat && s.menunggu ? "pending" : s.menunggu ? "pending" : "ok");
    d.title = !s.aktif ? "Sinkron Google Sheet belum diatur" : s.menunggu ? `${s.menunggu} baris menunggu dikirim${s.galat ? " · galat: " + s.galat : ""}` : "Semua data sudah terkirim ke Google Sheet"; } catch {}
}
function renderNav(){
  $("#tabs").innerHTML = daftarView().map(([k, l]) => `<button type="button" data-v="${k}" class="${view === k ? "on" : ""}" aria-label="${l}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>${l}</button>`).join("");
  $$("#tabs button").forEach(b => b.onclick = () => pindah(b.dataset.v));
}
function pindah(v){ view = v; try { history.replaceState(null, "", "#" + v); } catch {} render(); $("#main").scrollTop = 0; }
function render(){
  if (!B) return;
  if (!daftarView().some(v => v[0] === view)) view = "kasir";
  renderNav();
  $("#cartbar").hidden = view !== "kasir";
  return ({ kasir: vKasir, riwayat: vRiwayat, produksi: vProduksi, stok: vStok, mutasi: vMutasi, opname: vOpname, biaya: vBiaya, laporan: vLaporan, atur: vAtur })[view]();
}

/* ================= KASIR ================= */
const CKEY = "rg_cart";
const cartKosong = () => ({ items: [], pelanggan: "", hp: "", diskon: 0, ongkir: 0, metode: "Tunai", bayar: 0, catatan: "", tgl: "" });
let cart = cartKosong();
try { const c = JSON.parse(sessionStorage.getItem(CKEY) || "null"); if (c && Array.isArray(c.items)) cart = { ...cart, ...c }; } catch {}
const saveCart = () => { try { sessionStorage.setItem(CKEY, JSON.stringify(cart)); } catch {} };
const cartSub = () => cart.items.reduce((a, it) => a + it.harga * it.qty, 0);
const cartTotal = () => Math.max(0, cartSub() - num(cart.diskon) + num(cart.ongkir));
let posKat = "SEMUA", posQ = "", hanyaReady = false, saleTerakhir = null;

function vKasir(){
  const kats = ["SEMUA", ...B.kategori.filter(k => B.produk.some(p => p.kategori === k && p.aktif))];
  $("#main").innerHTML = `
  <div class="pos">
    <section class="catalog">
      <div class="row">
        <input type="search" id="posQ" placeholder="Cari nama / kode, atau scan barcode…" value="${esc(posQ)}" style="flex:1 1 220px" aria-label="Cari produk">
        <button class="btn" id="manualBtn" type="button">+ Item manual</button>
        <label class="row small muted" style="gap:6px"><input type="checkbox" id="readyOnly" ${hanyaReady ? "checked" : ""}> Stok ready saja</label>
      </div>
      <div class="chips" id="katChips">${kats.map(k => `<button type="button" class="chip ${k === posKat ? "on" : ""}" data-k="${esc(k)}">${esc(k === "SEMUA" ? "Semua" : toTitle(k))}</button>`).join("")}</div>
      <div class="prodgrid" id="prodGrid"></div>
    </section>
    <aside class="cart panel" id="cart"></aside>
  </div>`;
  $("#posQ").oninput = e => { posQ = e.target.value; drawGrid(); };
  $("#posQ").onkeydown = e => { if (e.key !== "Enter") return; const h = cariScan(e.target.value); if (h && h.jenis === "produk") { e.preventDefault(); tambahKeKeranjang(h.x.id); posQ = ""; e.target.value = ""; drawGrid(); } };
  $("#readyOnly").onchange = e => { hanyaReady = e.target.checked; drawGrid(); };
  $$("#katChips .chip").forEach(b => b.onclick = () => { posKat = b.dataset.k; $$("#katChips .chip").forEach(x => x.classList.toggle("on", x === b)); drawGrid(); });
  $("#manualBtn").onclick = itemManual;
  drawGrid(); drawCart();
}
function drawGrid(){
  const q = posQ.trim().toUpperCase(), g = $("#prodGrid"); if (!g) return;
  const list = B.produk.filter(p => p.aktif && (posKat === "SEMUA" || p.kategori === posKat) && (!q || p.nama.toUpperCase().includes(q) || p.kode.includes(q) || p.barcode === q) && (!hanyaReady || p.stok > 0))
    .sort((a, b) => (b.stok > 0) - (a.stok > 0) || a.kategori.localeCompare(b.kategori) || a.harga - b.harga);
  if (!list.length) { g.innerHTML = `<div class="empty" style="grid-column:1/-1">Tidak ada produk yang cocok. Coba kata lain, atau pakai <b>+ Item manual</b>.</div>`; return; }
  g.innerHTML = list.slice(0, 240).map(p => { const [, cl] = statusStok(p.stok, p.stok_min); return `<button type="button" class="prod" data-id="${p.id}"><span class="nm">${esc(p.nama)}</span><span class="code">${p.kode}</span><span class="meta"><span class="pr num">${rp(p.harga)}</span><span class="pill ${p.stok > 0 ? cl : "mut"}">${p.stok > 0 ? "Ready " + fq(p.stok) : "Produksi"}</span></span></button>`; }).join("")
    + (list.length > 240 ? `<div class="empty" style="grid-column:1/-1">${list.length - 240} produk lain tersembunyi. Persempit pencarian.</div>` : "");
  $$(".prod", g).forEach(b => b.onclick = () => tambahKeKeranjang(+b.dataset.id));
}
function tambahKeKeranjang(id){
  const p = prodBy(id); if (!p) return;
  const ex = cart.items.find(i => i.product_id === id);
  if (ex) ex.qty = +(ex.qty + 1).toFixed(2); else cart.items.push({ product_id: p.id, kode: p.kode, nama: p.nama, kategori: p.kategori, harga: p.harga, qty: 1, ready: p.stok > 0 });
  saveCart(); drawCart(); toast(`${p.nama} ditambahkan`);
}
function itemManual(){
  modal(`<h3>Item manual</h3><p class="muted small">Untuk pesanan custom yang harganya belum ada di daftar.</p>
    <div class="stack">
      <label class="f">Nama barang<input type="text" id="mn" placeholder="Contoh: BUKET CUSTOM PINK" autocomplete="off"></label>
      <div class="row"><label class="f grow">Harga satuan<input type="number" id="mp" inputmode="numeric" min="0" step="500"></label><label class="f" style="width:100px">Qty<input type="number" id="mq" value="1" min="0.5" step="0.5" inputmode="decimal"></label></div>
      <label class="f">Kategori<select id="mk">${B.kategori.map(k => `<option ${k === "BUKET COSTUME" ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      ${isAdmin() ? `<label class="row small"><input type="checkbox" id="msave"> Simpan juga ke daftar produk</label>` : ""}
    </div>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="mok">Tambah ke keranjang</button></div>`, m => {
      $("#mn", m).oninput = e => { $("#mk", m).value = tebakKategori(e.target.value); };
      $("#mok", m).onclick = e => coba(async () => {
        const nama = $("#mn", m).value.trim().toUpperCase(), harga = num($("#mp", m).value), qty = num($("#mq", m).value) || 1, kategori = $("#mk", m).value;
        if (!nama || !harga) { toast("Isi nama dan harga"); return; }
        if ($("#msave", m)?.checked) {
          const p = await api("POST", "/api/produk", { nama, harga, kategori });
          await muatUlang();
          cart.items.push({ product_id: p.id, kode: p.kode, nama: p.nama, kategori, harga, qty, ready: false });
        } else cart.items.push({ product_id: null, kode: "", nama, kategori, harga, qty, ready: false, manual: true });
        saveCart(); closeModal(); drawGrid(); drawCart();
      }, e.target);
    });
}
function drawCart(){
  const el = $("#cart"); if (!el) return;
  const sub = cartSub(), tot = cartTotal(), qty = cart.items.reduce((a, i) => a + i.qty, 0);
  $("#cbCount").textContent = `${fq(qty)} item`; $("#cbTotal").textContent = rp(tot);
  el.innerHTML = `
    <div class="cart-head"><h2 style="font-size:20px;flex:1">Keranjang <span class="muted small num" style="font-family:var(--body);font-weight:600">${fq(qty)} item</span></h2>${cart.items.length ? `<button class="btn ghost sm" id="clr" type="button">Kosongkan</button>` : ""}<button class="btn sm cart-close" id="cclose" type="button">‹ Katalog</button></div>
    <div class="cart-body">
    <div class="row"><label class="f grow">Pelanggan<input type="text" id="cCust" value="${esc(cart.pelanggan)}" placeholder="CUSTOMER" autocomplete="off"></label><label class="f grow">No HP / WA<input type="tel" id="cHp" value="${esc(cart.hp)}" placeholder="08…"></label></div>
    <div class="cart-lines">${cart.items.length ? cart.items.map((it, i) => `
      <div class="line" data-i="${i}">
        <div><div class="nm">${esc(it.nama)}</div><div class="code">${it.manual ? "manual" : it.kode}</div></div>
        <div class="num" style="font-weight:700">${rp(it.harga * it.qty)}</div>
        <div class="ctl">
          <span class="qty"><button type="button" data-a="-" aria-label="Kurangi">−</button><input type="number" class="qIn num" value="${it.qty}" min="0" step="0.5" inputmode="decimal" aria-label="Jumlah"><button type="button" data-a="+" aria-label="Tambah">+</button></span>
          <input type="number" class="price-in pIn num" value="${it.harga}" min="0" step="500" inputmode="numeric" aria-label="Harga satuan">
          ${it.product_id ? `<button type="button" class="pill ${it.ready ? "ok" : "mut"}" data-a="r" style="border:0;cursor:pointer" title="Ketuk untuk mengganti: ambil dari stok ready atau dibuat (produksi)">${it.ready ? "READY STOK" : "PRODUKSI"}</button>` : `<span class="pill mut">PRODUKSI</span>`}
          <button type="button" class="btn ghost sm" data-a="x" style="margin-left:auto">Hapus</button>
        </div>
      </div>`).join("") : `<div class="empty">Belum ada barang.<br>Ketuk produk di katalog atau scan barcode.</div>`}</div>
    <div class="row"><label class="f grow">Diskon (Rp)<input type="number" id="cDisc" value="${cart.diskon || ""}" min="0" step="1000" inputmode="numeric"></label><label class="f grow">Ongkir (Rp)<input type="number" id="cOng" value="${cart.ongkir || ""}" min="0" step="1000" inputmode="numeric"></label></div>
    <div class="seg" id="cMet" role="group" aria-label="Metode bayar">${B.metode.map(m => `<button type="button" class="${cart.metode === m ? "on" : ""}" data-m="${m}">${m}</button>`).join("")}</div>
    <label class="f">Dibayar (kosongkan = lunas pas)<input type="number" id="cBayar" value="${cart.bayar || ""}" min="0" step="1000" inputmode="numeric" placeholder="${tot}"></label>
    <div class="quickpay" id="qp">${quickPays(tot).map(v => `<button type="button" class="btn sm" data-v="${v}">${v === tot ? "Uang pas" : rp(v)}</button>`).join("")}</div>
    ${isAdmin() ? `<label class="f">Tanggal transaksi<input type="date" id="cTgl" value="${cart.tgl || today()}"></label>` : ""}
    <label class="f">Catatan (ucapan kartu, jadwal ambil, dll)<textarea id="cNote" rows="2">${esc(cart.catatan)}</textarea></label>
    </div>
    <div class="cart-foot">
      <div class="tot"><span class="muted">Subtotal <span class="num">${rp(sub)}</span></span><span></span><span style="align-self:end;font-weight:700">TOTAL · ${esc(cart.metode)}</span><span class="big num" id="cTot">${rp(tot)}</span></div>
      <div class="small" id="kembali"></div>
      <div class="row" style="flex-wrap:nowrap"><button class="btn big" id="saveOnly" type="button" style="flex:1" ${cart.items.length ? "" : "disabled"}>Simpan</button><button class="btn pri big" id="savePrint" type="button" style="flex:2" ${cart.items.length ? "" : "disabled"}>Bayar &amp; Cetak</button></div>
      ${saleTerakhir ? `<button class="btn ghost sm" id="reprint" type="button" style="align-self:center">Cetak ulang struk terakhir (${esc(saleTerakhir.no)})</button>` : ""}
    </div>`;
  const upd = () => { saveCart(); const t = cartTotal(); $("#cTot").textContent = rp(t); $("#cbTotal").textContent = rp(t); hitKembali(); };
  $("#cCust", el).oninput = e => { cart.pelanggan = e.target.value; saveCart(); };
  $("#cHp", el).oninput = e => { cart.hp = e.target.value; saveCart(); };
  $("#cDisc", el).oninput = e => { cart.diskon = num(e.target.value); upd(); };
  $("#cOng", el).oninput = e => { cart.ongkir = num(e.target.value); upd(); };
  $("#cBayar", el).oninput = e => { cart.bayar = num(e.target.value); saveCart(); hitKembali(); };
  if ($("#cTgl", el)) $("#cTgl", el).onchange = e => { cart.tgl = e.target.value; saveCart(); };
  $("#cNote", el).oninput = e => { cart.catatan = e.target.value; saveCart(); };
  $$("#cMet button", el).forEach(b => b.onclick = () => { cart.metode = b.dataset.m; saveCart(); const sc = $(".cart-body", el).scrollTop; drawCart(); $(".cart-body", el).scrollTop = sc; });
  $$("#qp button", el).forEach(b => b.onclick = () => { cart.bayar = +b.dataset.v; $("#cBayar", el).value = cart.bayar; saveCart(); hitKembali(); });
  $$(".line", el).forEach(row => {
    const i = +row.dataset.i, it = cart.items[i];
    $$("[data-a]", row).forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === "+") it.qty = +(it.qty + 1).toFixed(2);
      if (a === "-") it.qty = Math.max(0, +(it.qty - 1).toFixed(2));
      if (a === "r") it.ready = !it.ready;
      if (a === "x" || it.qty === 0) cart.items.splice(i, 1);
      saveCart(); drawCart();
    });
    $(".qIn", row).onchange = e => { it.qty = num(e.target.value); if (!it.qty) cart.items.splice(i, 1); saveCart(); drawCart(); };
    $(".pIn", row).onchange = e => { it.harga = num(e.target.value); saveCart(); drawCart(); };
  });
  const clr = $("#clr", el); if (clr) clr.onclick = () => konfirmasi("Kosongkan keranjang?", "Semua barang di keranjang akan dihapus.", "Kosongkan", () => { resetCart(); drawCart(); });
  $("#cclose", el).onclick = () => el.classList.remove("open");
  $("#saveOnly", el).onclick = e => simpanTransaksi(false, e.target);
  $("#savePrint", el).onclick = e => simpanTransaksi(true, e.target);
  const rpb = $("#reprint", el); if (rpb) rpb.onclick = () => lihatStruk(saleTerakhir);
  hitKembali();
}
$("#cartbar").onclick = () => { const c = $("#cart"); if (c) c.classList.add("open"); };
function quickPays(t){ if (!t) return []; const s = new Set([t]); [10000, 20000, 50000, 100000].forEach(u => s.add(Math.ceil(t / u) * u)); return [...s].sort((a, b) => a - b).slice(0, 5); }
function hitKembali(){
  const k = $("#kembali"); if (!k) return;
  const t = cartTotal(), b = cart.bayar || t;
  k.innerHTML = b > t ? `Kembalian: <b class="num">${rp(b - t)}</b>` : b < t ? `<span class="pill warn">DP / belum lunas</span> Sisa <b class="num">${rp(t - b)}</b>` : "";
}
function resetCart(){ cart = cartKosong(); saveCart(); }
async function simpanTransaksi(print, tombol){
  if (!cart.items.length) return;
  await coba(async () => {
    const s = await api("POST", "/api/penjualan", {
      tgl: isAdmin() ? (cart.tgl || today()) : undefined, pelanggan: cart.pelanggan, hp: cart.hp, metode: cart.metode,
      bayar: cart.bayar || undefined, diskon: cart.diskon || 0, ongkir: cart.ongkir || 0, catatan: cart.catatan,
      items: cart.items.map(i => ({ product_id: i.product_id, nama: i.nama, kategori: i.kategori, harga: i.harga, qty: i.qty, ready: i.ready })),
    });
    saleTerakhir = s; resetCart();
    $("#cart")?.classList.remove("open");
    toast(`Tersimpan: ${s.no}`);
    await muatUlang(); drawGrid(); drawCart();
    if (print) { cetak(s); setTimeout(() => lihatStruk(s), 300); }
    if (isAdmin()) setTimeout(cekSync, 3000);
  }, tombol);
}

/* ================= TRANSAKSI ================= */
let rDari = "", rSampai = "", rQ = "", rData = [];
async function vRiwayat(){
  if (!rDari) rDari = rSampai = today();
  if (!isAdmin()) rDari = rSampai = today();
  $("#main").innerHTML = `
    <div class="view-head"><h2>Transaksi</h2><span class="sp"></span>
      ${isAdmin() ? `<input type="date" id="rD" value="${rDari}" style="width:auto" aria-label="Dari"><span class="muted">s/d</span><input type="date" id="rS" value="${rSampai}" style="width:auto" aria-label="Sampai"><button class="btn sm" id="rHari" type="button">Hari ini</button>` : `<span class="muted small">Hari ini, ${tglID(today())}</span>`}</div>
    <input type="search" id="rQ" placeholder="Cari no invoice, pelanggan, atau barang…" value="${esc(rQ)}" style="margin-bottom:12px">
    <div id="rSum" class="kpis" style="margin-bottom:12px"></div>
    <div id="rList"><div class="empty">Memuat…</div></div>`;
  if (isAdmin()) {
    $("#rD").onchange = e => { rDari = e.target.value; if (rSampai < rDari) rSampai = rDari; vRiwayat(); };
    $("#rS").onchange = e => { rSampai = e.target.value; if (rSampai < rDari) rDari = rSampai; vRiwayat(); };
    $("#rHari").onclick = () => { rDari = rSampai = today(); vRiwayat(); };
  }
  let t; $("#rQ").oninput = e => { rQ = e.target.value; clearTimeout(t); t = setTimeout(muatRiwayat, 300); };
  muatRiwayat();
}
async function muatRiwayat(){
  await coba(async () => {
    rData = await api("GET", `/api/penjualan?dari=${rDari}&sampai=${rSampai}&q=${encodeURIComponent(rQ.trim())}`);
    if (view !== "riwayat") return;
    const ok = rData.filter(s => !s.batal_at), omzet = ok.reduce((a, s) => a + s.total, 0), piutang = ok.reduce((a, s) => a + Math.max(0, s.total - s.bayar), 0);
    const per = m => ok.filter(s => s.metode === m).reduce((a, s) => a + Math.min(s.bayar, s.total), 0);
    $("#rSum").innerHTML = `<div class="kpi"><div class="l">Omzet</div><div class="v num">${rp(omzet)}</div></div><div class="kpi"><div class="l">Transaksi</div><div class="v num">${ok.length}</div></div><div class="kpi"><div class="l">Tunai diterima</div><div class="v num">${rp(per("Tunai"))}</div></div><div class="kpi"><div class="l">Transfer + QRIS</div><div class="v num">${rp(per("Transfer") + per("QRIS"))}</div></div>${piutang ? `<div class="kpi"><div class="l">Belum lunas (DP)</div><div class="v num" style="color:var(--warn)">${rp(piutang)}</div></div>` : ""}`;
    $("#rList").innerHTML = rData.length ? `<div class="list">${rData.map(s => `<div class="li click ${s.batal_at ? "void" : ""}" data-id="${s.id}">
      <div class="main"><div class="t">${esc(s.pelanggan)} <span class="code">${esc(s.no)}</span></div><div class="small muted">${tglPendek(s.tgl)} ${s.jam} · ${esc(s.kasir)} · ${s.items.map(i => esc(i.nama) + (i.qty != 1 ? " ×" + fq(i.qty) : "")).join(", ")}</div></div>
      <div style="text-align:right"><div class="num" style="font-weight:700">${rp(s.total)}</div>${s.batal_at ? `<span class="pill bad">BATAL</span>` : s.bayar < s.total ? `<span class="pill warn">DP</span>` : `<span class="pill mut">${s.metode}</span>`}</div></div>`).join("")}</div>`
      : `<div class="list"><div class="empty">Belum ada transaksi pada periode ini. Transaksi dari menu Kasir akan muncul di sini.</div></div>`;
    $$("#rList .li").forEach(r => r.onclick = () => { const s = rData.find(x => x.id === +r.dataset.id); if (s) lihatStruk(s, () => muatRiwayat()); });
  });
}

/* ================= PRODUKSI & INSENTIF ================= */
let pPer = null, pOleh = null;
async function vProduksi(){
  if (!pPer) pPer = periodeDari(today(), B.toko.periode_mulai);
  const [a, b] = pPer;
  const pembuatList = B.staf;
  if (!pOleh || !pembuatList.some(s => s.id === pOleh)) pOleh = isAdmin() ? (pembuatList.find(s => s.peran === "karyawan")?.id ?? B.me.id) : B.me.id;
  $("#main").innerHTML = `
    <div class="view-head"><h2>Produksi karyawan</h2></div>
    <div class="grid2" style="align-items:start">
      <section class="panel stack">
        <h3 style="font-size:17px">Catat hasil produksi</h3>
        <div class="row"><label class="f grow">Tanggal<input type="date" id="pT" value="${today()}" max="${today()}"></label><label class="f grow">Pembuat<select id="pO">${pembuatList.map(s => `<option value="${s.id}" ${s.id === pOleh ? "selected" : ""}>${esc(s.nama)}</option>`).join("")}</select></label></div>
        <div id="pRows" class="stack"></div>
        <button class="btn sm" id="pAddRow" type="button" style="align-self:flex-start">+ Baris lagi</button>
        <label class="row small"><input type="checkbox" id="pStok" checked> Tambahkan ke stok ready (restock)</label>
        <p class="small muted" style="margin:0">Matikan centang untuk pesanan yang langsung diambil pelanggan (sudah dijual sebagai PRODUKSI di kasir), supaya stok tidak dobel.</p>
        <button class="btn pri big" id="pSave" type="button">Simpan produksi</button>
        <datalist id="prodList">${B.produk.map(x => `<option value="${x.kode} · ${esc(x.nama)}">`).join("")}</datalist>
      </section>
      <section class="stack" style="min-width:0">
        <div class="row"><button class="btn sm" id="pPrev" type="button" aria-label="Periode sebelumnya">‹</button><div style="flex:1;text-align:center"><div class="small muted" style="text-transform:uppercase;letter-spacing:.05em;font-weight:700">Periode insentif</div><b>${tglID(a)} – ${tglID(b)}</b></div><button class="btn sm" id="pNext" type="button" aria-label="Periode berikutnya">›</button></div>
        <div id="pRekap"><div class="empty">Memuat…</div></div>
      </section>
    </div>
    <h3 style="font-size:17px;margin:22px 0 10px">Catatan produksi periode ini</h3>
    <div id="pLog"><div class="empty">Memuat…</div></div>`;
  const addRow = () => {
    const d = document.createElement("div"); d.className = "row prow";
    d.innerHTML = `<label class="f grow">Produk<input type="text" class="pI" list="prodList" placeholder="Ketik nama, kode, atau scan" autocomplete="off"></label><label class="f" style="width:80px">Qty<input type="number" class="pQ" value="1" min="0" step="1" inputmode="numeric"></label>`;
    $("#pRows").appendChild(d);
  };
  addRow();
  $("#pAddRow").onclick = addRow;
  $("#pO").onchange = e => pOleh = +e.target.value;
  $("#pPrev").onclick = () => { pPer = geserPeriode(a, -1, B.toko.periode_mulai); vProduksi(); };
  $("#pNext").onclick = () => { pPer = geserPeriode(a, 1, B.toko.periode_mulai); vProduksi(); };
  $("#pSave").onclick = e => {
    const items = [];
    for (const r of $$(".prow")) {
      const v = $(".pI", r).value.trim(), q = num($(".pQ", r).value); if (!v) continue;
      const kode = v.split("·")[0].trim().toUpperCase(), x = B.produk.find(p => p.kode === kode) || cariScan(v)?.x;
      if (!x || !B.produk.includes(x)) return toast(`Produk "${v}" tidak ditemukan. Pilih dari daftar.`);
      if (!q) return toast(`Isi jumlah untuk ${x.nama}`);
      items.push({ product_id: x.id, qty: q });
    }
    if (!items.length) return toast("Isi minimal satu produk");
    const tgl = $("#pT").value || today();
    coba(async () => {
      await api("POST", "/api/produksi", { tgl, pembuat_id: +$("#pO").value, restock: $("#pStok").checked, items });
      toast(`${items.reduce((t, i) => t + i.qty, 0)} produk dicatat`);
      pPer = periodeDari(tgl, B.toko.periode_mulai); await muatUlang(); vProduksi();
    }, e.target);
  };
  coba(async () => {
    const [rek, log] = await Promise.all([api("GET", `/api/insentif?tgl=${a}`), api("GET", `/api/produksi?dari=${a}&sampai=${b}`)]);
    if (view !== "produksi") return;
    const rows = rek.rows.filter(r => isAdmin() || r.pembuat_id === B.me.id);
    const totQ = rows.reduce((x, r) => x + r.qty, 0), totI = rows.reduce((x, r) => x + r.insentif, 0);
    $("#pRekap").innerHTML = `<div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">${isAdmin() ? "Total produksi" : "Produksi saya"}</div><div class="v num">${fq(totQ)}</div></div><div class="kpi"><div class="l">${isAdmin() ? "Total insentif" : "Insentif saya"}</div><div class="v num">${rp(totI)}</div></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Nama</th><th class="r">Produksi</th><th class="r">Insentif</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.nama)}</b></td><td class="r num">${r.qty ? fq(r.qty) : "-"}</td><td class="r num" style="font-weight:700">${rp(r.insentif)}</td>
        <td>${r.bayar ? `<span class="pill ok">DIBAYAR</span><div class="small muted">${tglPendek(r.bayar.tgl)}${r.bayar.nominal !== r.insentif ? " · " + rp(r.bayar.nominal) : ""}</div>` : r.insentif ? `<span class="pill warn">BELUM</span>` : ""}</td>
        <td class="r" style="white-space:nowrap">${r.qty ? `<button class="btn sm" data-slip="${r.pembuat_id}" type="button">Slip</button> ${!r.bayar && isAdmin() ? `<button class="btn sm pri" data-bayar="${r.pembuat_id}" type="button">Bayar</button>` : ""}` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Belum ada data.</td></tr>`}
      </tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">Tarif ${rp(B.toko.insentif)} per produk, periode tanggal ${B.toko.periode_mulai} s/d ${B.toko.periode_mulai - 1 || "akhir bulan"}.${isAdmin() ? " Ubah di Pengaturan; tarif khusus per produk diisi di menu Stok." : ""}</p>`;
    $$("[data-slip]").forEach(bt => bt.onclick = () => slipInsentif(rek, rows.find(r => r.pembuat_id === +bt.dataset.slip)));
    $$("[data-bayar]").forEach(bt => bt.onclick = () => bayarInsentif(rek, rows.find(r => r.pembuat_id === +bt.dataset.bayar)));
    $("#pLog").innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Tanggal</th><th>Barang</th><th class="r">Qty</th><th>Pembuat</th><th class="r">Insentif</th><th></th></tr></thead><tbody>
      ${log.length ? log.map(x => { const bolehHapus = !x.dibayar && (isAdmin() || (x.user_id === B.me.id && x.tgl === today()));
        return `<tr><td class="small">${tglPendek(x.tgl)}</td><td>${esc(x.nama)} <span class="code">${x.kode}</span>${x.restock ? "" : ' <span class="pill mut">pesanan</span>'}</td><td class="r num">${fq(x.qty)}</td><td>${esc(x.pembuat)}</td><td class="r num">${rp(x.qty * x.tarif)}</td><td class="r">${bolehHapus ? `<button class="btn ghost sm" data-del="${x.id}" type="button">Hapus</button>` : ""}</td></tr>`; }).join("")
        : `<tr><td colspan="6" class="empty">Belum ada catatan produksi di periode ini.</td></tr>`}</tbody></table></div>`;
    $$("[data-del]").forEach(bt => bt.onclick = () => { const x = log.find(p => p.id === +bt.dataset.del);
      konfirmasi("Hapus catatan produksi?", `${x.nama} ×${fq(x.qty)} oleh ${x.pembuat}.${x.restock ? " Stok ready ikut dikurangi." : ""}`, "Hapus",
        () => coba(async () => { await api("DELETE", `/api/produksi/${x.id}`); await muatUlang(); vProduksi(); })); });
  });
}
function slipLines(rek, r){
  const w = lebar(), garis = "-".repeat(w), L = [];
  L.push({ t: center(B.toko.nama_toko, w), b: 1 }, { t: center("SLIP INSENTIF PRODUKSI", w), b: 1 }, { t: garis });
  L.push({ t: lr("Nama", r.nama, w) }, { t: lr("Periode", tglPendek(rek.dari) + "-" + tglPendek(rek.sampai), w) }, { t: garis });
  r.detail.forEach(x => { wrap(x.nama, w).forEach(l => L.push({ t: l })); L.push({ t: lr(`  ${fq(x.qty)} x ${angka(x.tarif)}`, angka(x.qty * x.tarif), w) }); });
  L.push({ t: garis }, { t: lr("Total produksi", fq(r.qty) + " pcs", w) }, { t: lr("TOTAL INSENTIF", "Rp" + angka(r.insentif), w), b: 1 });
  if (r.bayar) { L.push({ t: lr("Dibayar " + tglPendek(r.bayar.tgl), "Rp" + angka(r.bayar.nominal), w) }); if (r.bayar.ket) wrap(r.bayar.ket, w).forEach(l => L.push({ t: l })); }
  L.push({ t: garis }, { t: "" }, { t: lr("Penerima", "Dibayar oleh", w) }, { t: "" }, { t: "" }, { t: lr("(" + r.nama + ")", "(" + (r.bayar?.oleh || B.me.nama) + ")", w) });
  return L;
}
function slipInsentif(rek, r){
  const L = slipLines(rek, r);
  modal(`<h3>Slip insentif ${esc(r.nama)}</h3><pre class="receipt-prev">${esc(L.map(l => l.t).join("\n"))}</pre>
    <div class="actions"><button class="btn" data-close>Tutup</button><button class="btn pri" id="slipP">Cetak slip</button></div>`, m => $("#slipP", m).onclick = () => cetakBaris(L));
}
function bayarInsentif(rek, r){
  modal(`<h3>Bayar insentif ${esc(r.nama)}</h3>
    <p class="muted">${fq(r.qty)} produk · periode ${tglID(rek.dari)} – ${tglID(rek.sampai)}</p>
    <div class="stack">
      <label class="f">Nominal dibayar<input type="number" id="bN" value="${r.insentif}" min="0" step="500" inputmode="numeric"></label>
      <label class="f">Tanggal bayar<input type="date" id="bT" value="${today()}"></label>
      <label class="f">Catatan (bonus, potongan, dll)<input type="text" id="bK"></label>
      <label class="row small"><input type="checkbox" id="bE" checked> Catat juga di Pengeluaran (kategori Insentif Produksi)</label>
      <p class="note">Setelah ditandai dibayar, catatan produksi ${esc(r.nama)} di periode ini terkunci.</p>
    </div>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="bOk">Tandai sudah dibayar</button></div>`, m => {
      $("#bOk", m).onclick = e => coba(async () => {
        await api("POST", "/api/insentif/bayar", { pembuat_id: r.pembuat_id, periode_dari: rek.dari, nominal: num($("#bN", m).value), tgl: $("#bT", m).value, ket: $("#bK", m).value, catat_pengeluaran: $("#bE", m).checked });
        closeModal(); toast(`Insentif ${r.nama} tercatat dibayar`); vProduksi();
      }, e.target);
    });
}

/* ================= STOK ================= */
let sJenis = "produk", sQ = "", sFil = "SEMUA", sKat = "SEMUA";
function vStok(){
  const isP = sJenis === "produk", arr = isP ? B.produk : B.bahan;
  const kats = ["SEMUA", ...new Set(arr.map(x => x.kategori).filter(Boolean))];
  if (!kats.includes(sKat)) sKat = "SEMUA";
  $("#main").innerHTML = `
    <div class="view-head"><h2>Stok</h2>
      <div class="seg" id="sJ"><button type="button" data-j="produk" class="${isP ? "on" : ""}">Produk jadi</button><button type="button" data-j="bahan" class="${!isP ? "on" : ""}">Bahan baku</button></div>
      <span class="sp"></span><button class="btn" id="sLbl" type="button">Cetak label barcode</button>${isAdmin() ? `<button class="btn pri" id="sAdd" type="button">+ ${isP ? "Produk" : "Bahan"} baru</button>` : ""}</div>
    <div id="sKpi" class="kpis" style="margin-bottom:12px"></div>
    <div class="row" style="margin-bottom:12px">
      <input type="search" id="sQ" placeholder="Cari nama, kode, atau barcode…" value="${esc(sQ)}" style="flex:1 1 200px">
      <select id="sKat" style="width:auto;max-width:200px">${kats.map(k => `<option ${k === sKat ? "selected" : ""} value="${esc(k)}">${k === "SEMUA" ? "Semua kategori" : esc(k)}</option>`).join("")}</select>
      <select id="sFil" style="width:auto">${["SEMUA", "AMAN", "SEDIKIT", "HABIS", "MINUS"].map(f => `<option ${f === sFil ? "selected" : ""} value="${f}">${f === "SEMUA" ? "Semua status" : f === "MINUS" ? "Stok minus" : "Stok " + f.toLowerCase()}</option>`).join("")}</select>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Kode</th><th>Nama</th><th>Barcode</th><th>Kategori</th><th class="r">Harga</th><th class="r">Stok</th><th>Status</th></tr></thead><tbody id="sBody"></tbody></table></div>
    <p class="small muted">Ketuk baris untuk ${isAdmin() ? "mengubah data dan melihat riwayat stok" : "melihat riwayat stok"}.</p>`;
  $$("#sJ button").forEach(b => b.onclick = () => { sJenis = b.dataset.j; sKat = "SEMUA"; vStok(); });
  $("#sQ").oninput = e => { sQ = e.target.value; drawStok(); };
  $("#sKat").onchange = e => { sKat = e.target.value; drawStok(); };
  $("#sFil").onchange = e => { sFil = e.target.value; drawStok(); };
  if ($("#sAdd")) $("#sAdd").onclick = () => editItem(sJenis, null);
  $("#sLbl").onclick = () => modalLabel();
  drawStok();
}
function drawStok(){
  const isP = sJenis === "produk", arr = isP ? B.produk : B.bahan, q = sQ.trim().toUpperCase();
  const list = arr.filter(x => (!q || x.nama.toUpperCase().includes(q) || x.kode.includes(q) || (x.barcode || "").includes(q)) && (sKat === "SEMUA" || x.kategori === sKat) && (sFil === "SEMUA" || (sFil === "MINUS" ? x.stok < 0 : statusStok(x.stok, x.stok_min)[0] === sFil)));
  const nilai = arr.reduce((a, x) => a + Math.max(0, x.stok) * (isP ? (x.hpp ?? 0) : x.harga), 0);
  const sedikit = arr.filter(x => x.stok > 0 && x.stok <= (x.stok_min || 0)).length, minus = arr.filter(x => x.stok < 0).length;
  $("#sKpi").innerHTML = `<div class="kpi"><div class="l">Jumlah item</div><div class="v num">${arr.length}</div></div>${isAdmin() || !isP ? `<div class="kpi"><div class="l">${isP ? "Nilai stok (HPP)" : "Nilai aset bahan"}</div><div class="v num">${rp(nilai)}</div></div>` : ""}<div class="kpi"><div class="l">Stok sedikit</div><div class="v num" style="color:var(--warn)">${sedikit}</div></div><div class="kpi"><div class="l">Stok minus</div><div class="v num" style="color:var(--bad)">${minus}</div></div>`;
  $("#sBody").innerHTML = list.length ? list.map(x => { const [st, cl] = statusStok(x.stok, x.stok_min); return `<tr class="click" data-id="${x.id}"><td class="code">${x.kode}</td><td>${esc(x.nama)}${isP && !x.aktif ? ' <span class="pill mut">nonaktif</span>' : ""}</td><td class="code">${esc(x.barcode || "")}</td><td class="small muted">${esc(x.kategori || "-")}</td><td class="r num">${x.harga ? rp(x.harga) : "-"}</td><td class="r num" style="font-weight:700;${x.stok < 0 ? "color:var(--bad)" : ""}">${fq(x.stok)}</td><td><span class="pill ${cl}">${st}</span></td></tr>`; }).join("") : `<tr><td colspan="7" class="empty">Tidak ada data yang cocok.</td></tr>`;
  $$("#sBody tr.click").forEach(r => r.onclick = () => bukaItem(sJenis, +r.dataset.id));
}
const bukaItem = (jenis, id) => isAdmin() ? editItem(jenis, id) : riwayatItem(jenis, id);
const TIPE_LABEL = { masuk: "Masuk", keluar: "Keluar", opname: "Opname", koreksi: "Koreksi", jual: "Terjual", batal: "Batal jual", produksi: "Produksi", hapus_produksi: "Hapus produksi" };
async function riwayatItem(jenis, id){
  const x = (jenis === "produk" ? prodBy : bahanBy)(id); if (!x) return;
  const rows = await coba(() => api("GET", `/api/riwayat-stok?tipe=masuk,keluar,opname,koreksi,jual,batal,produksi,hapus_produksi&jenis=${jenis}&item_id=${id}&limit=100`));
  if (!rows) return;
  modal(`<h3>${esc(x.nama)}</h3><p class="muted small">${x.kode} · stok sekarang <b>${fq(x.stok)}</b>${x.barcode ? " · barcode " + esc(x.barcode) : ""}</p>
    <div class="tbl-wrap" style="max-height:55vh;overflow:auto"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th class="r">Ubah</th><th class="r">Jadi</th><th>Oleh</th></tr></thead><tbody>
    ${rows.length ? rows.map(r => `<tr><td class="small">${tglPendek(r.tgl)} ${r.jam}</td><td>${TIPE_LABEL[r.tipe] || r.tipe}${r.ref ? ` <span class="code">${esc(r.ref)}</span>` : ""}${r.ket ? `<div class="small muted">${esc(r.ket)}</div>` : ""}</td><td class="r num" style="color:${r.qty < 0 ? "var(--bad)" : "var(--ok)"}">${r.qty > 0 ? "+" : ""}${fq(r.qty)}</td><td class="r num">${r.stok_sesudah != null ? fq(r.stok_sesudah) : "-"}</td><td class="small">${esc(r.oleh)}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">Belum ada pergerakan stok.</td></tr>`}
    </tbody></table></div>
    <div class="actions"><button class="btn" id="rLbl">Cetak label</button><button class="btn" data-close>Tutup</button></div>`, m => $("#rLbl", m).onclick = () => { closeModal(); modalLabel({ x, jenis, n: 1 }); });
}
function editItem(jenis, id, preset = {}){
  const isP = jenis === "produk", x = id ? (isP ? prodBy : bahanBy)(id) : null;
  const kats = isP ? B.kategori : B.katBahan;
  modal(`<h3>${x ? "Ubah" : "Tambah"} ${isP ? "produk" : "bahan"}</h3>
    <div class="stack">
      <div class="row"><label class="f" style="width:110px">Kode<input type="text" id="eC" value="${esc(x ? x.kode : "")}" ${x ? "readonly" : 'placeholder="otomatis"'}></label><label class="f grow">Nama<input type="text" id="eN" value="${esc(x ? x.nama : "")}"></label></div>
      <div class="row"><label class="f grow">Barcode<input type="text" id="eB" data-scan="raw" inputmode="numeric" value="${esc(x ? (x.barcode || "") : (preset.barcode || ""))}" placeholder="otomatis dari kode" autocomplete="off"></label><div id="eBprev" style="width:120px;align-self:flex-end"></div></div>
      <p class="small muted" style="margin:-4px 0 0">Kosongkan untuk barcode otomatis. Barang dengan barcode pabrik: klik kolom ini lalu scan barcodenya.</p>
      <label class="f">Kategori<select id="eK">${kats.map(k => `<option ${(x ? x.kategori : isP ? "BUKET BUNGA" : "KERTAS") === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <div class="row"><label class="f grow">${isP ? "Harga jual" : "Harga beli / satuan"}<input type="number" id="eP" value="${x ? x.harga : ""}" min="0" inputmode="numeric"></label>
      ${isP ? `<label class="f grow">HPP (modal)<input type="number" id="eH" value="${x ? x.hpp : ""}" min="0" inputmode="numeric" placeholder="otomatis ${B.toko.hpp_persen}%"></label>` : `<label class="f" style="width:100px">Satuan<input type="text" id="eU" value="${esc(x ? x.satuan : "PCS")}"></label>`}</div>
      <div class="row"><label class="f grow">Stok sekarang<input type="number" id="eS" value="${x ? x.stok : 0}" step="0.01" inputmode="decimal"></label><label class="f grow">Batas stok minimum<input type="number" id="eM" value="${x ? x.stok_min : isP ? 1 : 5}" min="0" inputmode="numeric"></label></div>
      ${x ? `<p class="note">Untuk menambah atau mengurangi stok sebaiknya pakai menu Masuk/Keluar atau Opname. Mengubah angka stok di sini dicatat sebagai koreksi.</p>` : ""}
      ${isP ? `<label class="f">Insentif produksi per pcs (kosongkan = tarif umum ${rp(B.toko.insentif)})<input type="number" id="eI" value="${x && x.insentif != null ? x.insentif : ""}" min="0" step="500" inputmode="numeric"></label>` : ""}
      ${isP && x ? `<label class="row small"><input type="checkbox" id="eOn" ${x.aktif ? "checked" : ""}> Tampilkan di katalog kasir</label>` : ""}
    </div>
    <div class="actions">${x ? `<button class="btn danger" id="eDel" style="margin-right:auto">Hapus</button><button class="btn" id="eRiw" type="button">Riwayat stok</button><button class="btn" id="eLbl" type="button">Cetak label</button>` : ""}<button class="btn" data-close>Batal</button><button class="btn pri" id="eOk">Simpan</button></div>`, m => {
      const prevBc = () => { const v = $("#eB", m).value.trim(), b = eanValid(v) ? v : (x ? barcodeDefault(jenis, x.kode) : "");
        $("#eBprev", m).innerHTML = b ? eanSVG(b, 30).replace("<svg ", '<svg style="width:100%;height:40px;display:block;background:#fff;padding:2px;border-radius:4px" ') : ""; };
      $("#eB", m).oninput = prevBc; prevBc();
      if (isP && !x) $("#eN", m).oninput = e => { $("#eK", m).value = tebakKategori(e.target.value); };
      if (x) { $("#eLbl", m).onclick = () => { closeModal(); modalLabel({ x, jenis, n: 1 }); }; $("#eRiw", m).onclick = () => riwayatItem(jenis, x.id); }
      $("#eOk", m).onclick = e => coba(async () => {
        const body = { kode: $("#eC", m).value.trim(), nama: $("#eN", m).value, kategori: $("#eK", m).value, harga: $("#eP", m).value, barcode: $("#eB", m).value.trim(), stok: $("#eS", m).value, stok_min: $("#eM", m).value };
        if (isP) { body.hpp = $("#eH", m).value; body.insentif = $("#eI", m).value; body.aktif = $("#eOn", m) ? $("#eOn", m).checked : true; } else body.satuan = $("#eU", m).value;
        const o = await api(x ? "PUT" : "POST", x ? `/api/${jenis}/${x.id}` : `/api/${jenis}`, body);
        await muatUlang(); closeModal(); render();
        if (!x) modal(`<h3>${esc(o.nama)} tersimpan</h3><p>ID <b>${esc(o.kode)}</b> · barcode <b class="code" style="font-size:14px">${esc(o.barcode)}</b></p><div style="max-width:220px;margin:8px auto;background:#fff;padding:6px;border-radius:6px">${eanValid(o.barcode) ? eanSVG(o.barcode).replace("<svg ", '<svg style="width:100%;height:70px;display:block" ') : `<p class="small" style="color:#333">Barcode pabrik non-EAN, tetap bisa di-scan.</p>`}</div>
          <div class="actions"><button class="btn" data-close>Selesai</button><button class="btn pri" id="nLbl">Cetak label</button></div>`, mm => $("#nLbl", mm).onclick = () => { closeModal(); modalLabel({ x: (isP ? prodBy : bahanBy)(o.id), jenis, n: 1 }); });
        else toast("Tersimpan");
      }, e.target);
      const d = $("#eDel", m);
      if (d) d.onclick = () => konfirmasi("Hapus barang?", `${x.nama} dihapus dari daftar. Riwayat transaksi tetap tersimpan.`, "Hapus", () => coba(async () => { await api("DELETE", `/api/${jenis}/${x.id}`); await muatUlang(); render(); }));
    });
}

/* ================= MASUK / KELUAR ================= */
let mTipe = "masuk", mBarang = "bahan";
function vMutasi(){
  const arr = mBarang === "produk" ? B.produk : B.bahan;
  $("#main").innerHTML = `
    <div class="view-head"><h2>Barang masuk &amp; keluar</h2></div>
    <div class="grid2" style="align-items:start">
      <section class="panel stack">
        <div class="seg" id="mJ" style="align-self:flex-start"><button type="button" data-j="masuk" class="${mTipe === "masuk" ? "on" : ""}">Barang masuk</button><button type="button" data-j="keluar" class="${mTipe === "keluar" ? "on" : ""}">Barang keluar</button></div>
        <label class="f">Jenis barang<select id="mB"><option value="bahan" ${mBarang === "bahan" ? "selected" : ""}>Bahan baku (kertas, bunga, pita…)</option><option value="produk" ${mBarang === "produk" ? "selected" : ""}>Produk jadi / ready stok</option></select></label>
        <label class="f">Tanggal<input type="date" id="mT" value="${today()}" max="${today()}"></label>
        <div id="mRows" class="stack"></div>
        <button class="btn sm" id="mAddRow" type="button" style="align-self:flex-start">+ Baris lagi</button>
        <label class="f">${mTipe === "masuk" ? "Keterangan (supplier / restock)" : "Keterangan (dipakai untuk pesanan apa, rusak, layu…)"}<input type="text" id="mK"></label>
        <button class="btn pri big" id="mSave" type="button">Simpan ${mTipe === "masuk" ? "barang masuk" : "barang keluar"}</button>
        <datalist id="itemList">${arr.map(x => `<option value="${x.kode} · ${esc(x.nama)}">`).join("")}</datalist>
      </section>
      <section class="stack" style="min-width:0">
        <h3 style="font-size:17px">Riwayat ${mTipe === "masuk" ? "barang masuk" : "barang keluar"}</h3>
        <div id="mLog"><div class="empty">Memuat…</div></div>
      </section>
    </div>`;
  $$("#mJ button").forEach(b => b.onclick = () => { mTipe = b.dataset.j; vMutasi(); });
  $("#mB").onchange = e => { mBarang = e.target.value; vMutasi(); };
  const addRow = () => {
    const d = document.createElement("div"); d.className = "row mrow";
    d.innerHTML = `<label class="f grow">Barang<input type="text" class="mI" list="itemList" placeholder="Ketik nama, kode, atau scan" autocomplete="off"></label><label class="f" style="width:90px">Qty<input type="number" class="mQ" min="0" step="0.01" inputmode="decimal"></label><div class="small muted mInfo" style="flex-basis:100%"></div>`;
    $(".mI", d).oninput = e => { const x = cariKode(arr, e.target.value); $(".mInfo", d).textContent = x ? `Stok sekarang: ${fq(x.stok)} ${x.satuan || ""}` : ""; };
    $("#mRows").appendChild(d);
  };
  addRow();
  $("#mAddRow").onclick = addRow;
  $("#mSave").onclick = e => {
    const items = [];
    for (const r of $$(".mrow")) {
      const v = $(".mI", r).value.trim(), q = num($(".mQ", r).value); if (!v && !q) continue;
      const x = cariKode(arr, v);
      if (!x) return toast(`Barang "${v}" tidak ditemukan. Pilih dari daftar.`);
      if (!q) return toast(`Isi jumlah untuk ${x.nama}`);
      items.push({ id: x.id, qty: q });
    }
    if (!items.length) return toast("Isi minimal satu barang");
    coba(async () => {
      await api("POST", "/api/mutasi", { tipe: mTipe, jenis: mBarang, tgl: $("#mT").value, ket: $("#mK").value, items });
      toast(`${items.length} barang tercatat`); await muatUlang(); vMutasi();
    }, e.target);
  };
  coba(async () => {
    const log = await api("GET", `/api/riwayat-stok?tipe=${mTipe}&limit=150`);
    if (view !== "mutasi") return;
    $("#mLog").innerHTML = `<div class="list">${log.length ? log.map(r => `<div class="li"><div class="main"><div class="t">${esc(r.nama)} <span class="code">${r.kode}</span></div><div class="small muted">${tglPendek(r.tgl)} · ${r.jenis === "produk" ? "Produk jadi" : "Bahan"} · ${esc(r.oleh)}${r.ket ? " · " + esc(r.ket) : ""}</div></div><div class="num" style="font-weight:700;color:${r.qty > 0 ? "var(--ok)" : "var(--bad)"}">${r.qty > 0 ? "+" : "−"}${fq(Math.abs(r.qty))}</div></div>`).join("") : `<div class="empty">Belum ada catatan.</div>`}</div>`;
  });
}
function cariKode(arr, v){ v = String(v || "").trim().toUpperCase(); if (!v) return null; const kode = v.split("·")[0].trim(); return arr.find(x => x.kode === kode) || arr.find(x => x.nama === v) || arr.find(x => x.barcode === kode) || null; }

/* ================= OPNAME ================= */
let oJenis = "bahan", oKat = "SEMUA", oQ = "", oDraft = {};
function vOpname(){
  const arr = oJenis === "produk" ? B.produk.filter(p => p.aktif) : B.bahan;
  const kats = ["SEMUA", ...new Set(arr.map(x => x.kategori).filter(Boolean))];
  $("#main").innerHTML = `
    <div class="view-head"><h2>Stok opname</h2>
      <div class="seg" id="oJ"><button type="button" data-j="bahan" class="${oJenis === "bahan" ? "on" : ""}">Bahan baku</button><button type="button" data-j="produk" class="${oJenis === "produk" ? "on" : ""}">Produk jadi</button></div></div>
    <p class="note" style="margin-bottom:12px">Hitung barang di rak lalu isi kolom <b>Fisik</b>, atau scan barang satu per satu (setiap scan +1). Hanya baris yang diisi yang disimpan.</p>
    <div class="row" style="margin-bottom:10px">
      <input type="search" id="oQ" placeholder="Cari barang…" value="${esc(oQ)}" style="flex:1 1 200px">
      <select id="oK" style="width:auto">${kats.map(k => `<option ${k === oKat ? "selected" : ""} value="${esc(k)}">${k === "SEMUA" ? "Semua kategori" : esc(k)}</option>`).join("")}</select>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Kode</th><th>Nama</th><th class="r">Sistem</th><th class="r" style="width:110px">Fisik</th><th class="r">Selisih</th></tr></thead><tbody id="oBody"></tbody></table></div>
    <div class="row" style="margin-top:12px"><span class="muted small" id="oCount"></span><span style="flex:1"></span><button class="btn" id="oClear" type="button">Kosongkan isian</button><button class="btn pri" id="oSave" type="button">Simpan opname</button></div>
    <h3 style="font-size:17px;margin:22px 0 10px">Riwayat opname &amp; koreksi</h3>
    <div id="oLog"><div class="empty">Memuat…</div></div>`;
  $$("#oJ button").forEach(b => b.onclick = () => { oJenis = b.dataset.j; oKat = "SEMUA"; oDraft = {}; vOpname(); });
  $("#oQ").oninput = e => { oQ = e.target.value; drawOpname(arr); };
  $("#oK").onchange = e => { oKat = e.target.value; drawOpname(arr); };
  $("#oClear").onclick = () => { oDraft = {}; drawOpname(arr); };
  $("#oSave").onclick = () => {
    const ids = Object.keys(oDraft).filter(k => oDraft[k] !== "");
    if (!ids.length) return toast("Belum ada angka fisik yang diisi");
    konfirmasi("Simpan opname?", `${ids.length} barang akan disesuaikan ke jumlah fisik.`, "Simpan", () => coba(async () => {
      await api("POST", "/api/opname", { jenis: oJenis, items: ids.map(id => ({ id: +id, fisik: num(oDraft[id]) })) });
      oDraft = {}; toast("Opname tersimpan"); await muatUlang(); vOpname();
    }), false);
  };
  drawOpname(arr);
  coba(async () => {
    const log = await api("GET", `/api/riwayat-stok?tipe=opname,koreksi&limit=150`);
    if (view !== "opname") return;
    $("#oLog").innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Tanggal</th><th>Barang</th><th class="r">Sistem</th><th class="r">Fisik</th><th class="r">Selisih</th><th>Oleh</th></tr></thead><tbody>${log.length ? log.map(o => `<tr><td class="small">${tglPendek(o.tgl)}</td><td>${esc(o.nama)} <span class="code">${o.kode}</span>${o.ket ? `<div class="small muted">${esc(o.ket)}</div>` : ""}</td><td class="r num">${o.stok_sebelum != null ? fq(o.stok_sebelum) : "-"}</td><td class="r num">${o.stok_sesudah != null ? fq(o.stok_sesudah) : "-"}</td><td class="r num" style="font-weight:700;color:${o.qty < 0 ? "var(--bad)" : o.qty > 0 ? "var(--ok)" : "var(--muted)"}">${o.qty > 0 ? "+" : ""}${fq(o.qty)}</td><td class="small">${esc(o.oleh)}</td></tr>`).join("") : `<tr><td colspan="6" class="empty">Belum ada opname.</td></tr>`}</tbody></table></div>`;
  });
}
function drawOpname(arr){
  const q = oQ.trim().toUpperCase();
  const list = arr.filter(x => (oKat === "SEMUA" || x.kategori === oKat) && (!q || x.nama.includes(q) || x.kode.includes(q)));
  const warna = s => s < 0 ? "var(--bad)" : s > 0 ? "var(--ok)" : "var(--muted)";
  $("#oBody").innerHTML = list.length ? list.map(x => { const d = oDraft[x.id] ?? ""; const sel = d === "" ? "" : +(num(d) - x.stok).toFixed(2);
    return `<tr><td class="code">${x.kode}</td><td>${esc(x.nama)}</td><td class="r num">${fq(x.stok)}</td><td class="r"><input type="number" step="0.01" inputmode="decimal" data-id="${x.id}" value="${esc(d)}" style="width:95px;text-align:right;padding:6px 8px" aria-label="Jumlah fisik ${esc(x.nama)}"></td><td class="r num sel" style="font-weight:700;color:${sel === "" ? "" : warna(sel)}">${sel === "" ? "" : (sel > 0 ? "+" : "") + fq(sel)}</td></tr>`; }).join("") : `<tr><td colspan="5" class="empty">Tidak ada barang.</td></tr>`;
  const cnt = () => { $("#oCount").textContent = `${Object.values(oDraft).filter(v => v !== "").length} barang sudah dihitung`; };
  $$("#oBody input").forEach(i => i.oninput = () => { oDraft[i.dataset.id] = i.value; const x = arr.find(a => a.id === +i.dataset.id), td = i.closest("tr").querySelector(".sel");
    if (i.value === "") td.textContent = ""; else { const s = +(num(i.value) - x.stok).toFixed(2); td.textContent = (s > 0 ? "+" : "") + fq(s); td.style.color = warna(s); } cnt(); });
  cnt();
}

/* ================= PENGELUARAN (admin) ================= */
let bBulan = "";
function vBiaya(){
  if (!bBulan) bBulan = today().slice(0, 7);
  $("#main").innerHTML = `
    <div class="view-head"><h2>Pengeluaran</h2><span class="sp"></span><input type="month" id="bB" value="${bBulan}" style="width:auto" aria-label="Bulan"></div>
    <div class="grid2" style="align-items:start">
      <section class="panel stack">
        <div class="row"><label class="f grow">Tanggal<input type="date" id="xT" value="${today()}"></label><label class="f grow">Kategori<select id="xK">${B.katPengeluaran.map(k => `<option>${k}</option>`).join("")}</select></label></div>
        <label class="f">Keterangan<input type="text" id="xD" placeholder="Contoh: beli mawar merah 2 ikat"></label>
        <label class="f">Nominal (Rp)<input type="number" id="xN" min="0" step="500" inputmode="numeric"></label>
        <button class="btn pri big" id="xSave" type="button">Simpan pengeluaran</button>
      </section>
      <section class="stack" style="min-width:0" id="bList"><div class="empty">Memuat…</div></section>
    </div>`;
  $("#bB").onchange = e => { bBulan = e.target.value || today().slice(0, 7); vBiaya(); };
  $("#xSave").onclick = e => coba(async () => {
    const nominal = num($("#xN").value); if (!nominal) return toast("Isi nominal");
    await api("POST", "/api/pengeluaran", { tgl: $("#xT").value, kategori: $("#xK").value, ket: $("#xD").value, nominal });
    toast("Pengeluaran tersimpan"); vBiaya();
  }, e.target);
  coba(async () => {
    const list = await api("GET", `/api/pengeluaran?dari=${bBulan}-01&sampai=${bulanAkhir(bBulan)}`);
    if (view !== "biaya") return;
    const total = list.reduce((a, e) => a + e.nominal, 0), perKat = {};
    list.forEach(e => perKat[e.kategori] = (perKat[e.kategori] || 0) + e.nominal);
    $("#bList").innerHTML = `<div class="kpi"><div class="l">Total ${BULAN[+bBulan.slice(5) - 1]} ${bBulan.slice(0, 4)}</div><div class="v num">${rp(total)}</div>
        <div class="stack small" style="margin-top:8px;gap:6px">${Object.entries(perKat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><div class="row" style="justify-content:space-between"><span>${esc(k)}</span><span class="num">${rp(v)}</span></div><div class="hbar"><i style="width:${(v / total * 100).toFixed(1)}%"></i></div></div>`).join("")}</div></div>
      <div class="list">${list.length ? list.map(e => `<div class="li"><div class="main"><div class="t">${esc(e.ket || e.kategori)}</div><div class="small muted">${tglPendek(e.tgl)} · ${esc(e.kategori)} · ${esc(e.oleh)}</div></div><div class="num" style="font-weight:700">${rp(e.nominal)}</div><button class="btn ghost sm" data-id="${e.id}" type="button">Hapus</button></div>`).join("") : `<div class="empty">Belum ada pengeluaran bulan ini.</div>`}</div>`;
    $$("#bList [data-id]").forEach(b => b.onclick = () => konfirmasi("Hapus pengeluaran?", "Catatan ini akan dihapus.", "Hapus", () => coba(async () => { await api("DELETE", `/api/pengeluaran/${b.dataset.id}`); vBiaya(); })));
  });
}

/* ================= LAPORAN (admin) ================= */
let lMode = "bulan", lBulan = "", lDari = "", lSampai = "";
function rangeLap(){
  const t = today();
  if (lMode === "hari") return [t, t];
  if (lMode === "7") return [tambahHari(t, -6), t];
  if (lMode === "bulan") return [`${lBulan}-01`, bulanAkhir(lBulan)];
  if (lMode === "tahun") return [`${lBulan.slice(0, 4)}-01-01`, `${lBulan.slice(0, 4)}-12-31`];
  return [lDari, lSampai];
}
function vLaporan(){
  if (!lBulan) { lBulan = today().slice(0, 7); lDari = lSampai = today(); }
  const [a, b] = rangeLap();
  $("#main").innerHTML = `
    <div class="view-head"><h2>Laporan</h2><span class="sp"></span>
      <div class="seg" id="lM">${[["hari", "Hari ini"], ["7", "7 hari"], ["bulan", "Bulanan"], ["tahun", "Tahunan"], ["custom", "Rentang"]].map(([k, l]) => `<button type="button" data-m="${k}" class="${lMode === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="row" style="margin-bottom:12px">${lMode === "bulan" || lMode === "tahun" ? `<input type="month" id="lB" value="${lBulan}" style="width:auto">` : ""}${lMode === "custom" ? `<input type="date" id="lD" value="${lDari}" style="width:auto"> s/d <input type="date" id="lS" value="${lSampai}" style="width:auto">` : ""}<span class="muted small">${tglID(a)}${a !== b ? " – " + tglID(b) : ""}</span><span style="flex:1"></span><button class="btn sm" id="lCsv" type="button">Unduh CSV penjualan</button></div>
    <div id="lIsi"><div class="empty">Memuat…</div></div>`;
  $$("#lM button").forEach(btn => btn.onclick = () => { lMode = btn.dataset.m; vLaporan(); });
  if ($("#lB")) $("#lB").onchange = e => { lBulan = e.target.value || today().slice(0, 7); vLaporan(); };
  if ($("#lD")) { $("#lD").onchange = e => { lDari = e.target.value; vLaporan(); }; $("#lS").onchange = e => { lSampai = e.target.value; vLaporan(); }; }
  $("#lCsv").onclick = e => coba(async () => {
    const sales = await api("GET", `/api/penjualan?dari=${a}&sampai=${b}`);
    unduhCSV(`penjualan_${a}_${b}.csv`, [["Tanggal", "Jam", "No Invoice", "Kode", "Nama Barang", "Kategori", "Harga", "Qty", "Subtotal", "Stok", "Customer", "No HP", "Kasir", "Metode", "HPP", "Status"],
      ...sales.slice().reverse().flatMap(s => s.items.map(i => [s.tgl, s.jam, s.no, i.kode, i.nama, i.kategori, i.harga, i.qty, i.harga * i.qty, i.ready ? "READY STOK" : "PRODUKSI", s.pelanggan, s.hp, s.kasir, s.metode, Math.round((i.hpp || 0) * i.qty), s.batal_at ? "BATAL" : "OK"]))]);
  }, e.target);
  coba(async () => {
    const L = await api("GET", `/api/laporan?dari=${a}&sampai=${b}`);
    if (view !== "laporan") return;
    const maxB = Math.max(1, ...L.grafik.map(x => x.v)), n = L.grafik.length;
    $("#lIsi").innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="l">Omzet</div><div class="v num">${rp(L.omzet)}</div></div>
      <div class="kpi"><div class="l">Transaksi</div><div class="v num">${L.transaksi}</div><div class="small muted">${fq(L.qty)} item terjual</div></div>
      <div class="kpi"><div class="l">Laba kotor</div><div class="v num">${rp(L.labaKotor)}</div><div class="small muted">Penjualan − diskon − HPP</div></div>
      <div class="kpi"><div class="l">Pengeluaran</div><div class="v num">${rp(L.biaya)}</div></div>
      <div class="kpi"><div class="l">Laba bersih</div><div class="v num" style="color:${L.labaBersih < 0 ? "var(--bad)" : "var(--ok)"}">${rp(L.labaBersih)}</div></div>
    </div>
    <section class="panel" style="margin-top:14px"><h3 style="font-size:16px;margin-bottom:6px">Omzet ${n && L.grafik[0].k.length === 7 ? "per bulan" : "per hari"}</h3>
      ${L.omzet ? `<div class="bars">${L.grafik.map(x => `<div class="b" style="height:${(x.v / maxB * 100).toFixed(1)}%" title="${x.label}: ${rp(x.v)}"></div>`).join("")}</div><div class="bars-x">${L.grafik.map((x, i) => `<span>${n > 16 && i % 3 ? "" : x.label}</span>`).join("")}</div><div class="small muted" style="margin-top:4px">Tertinggi ${rp(maxB)}</div>` : `<div class="empty">Belum ada penjualan pada periode ini.</div>`}
    </section>
    <div class="grid2" style="margin-top:14px;align-items:start">
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Per kategori</h3>${L.perKategori.length ? `<div class="stack small" style="gap:8px">${L.perKategori.map(k => `<div><div class="row" style="justify-content:space-between"><span>${esc(toTitle(k.kategori))} <span class="muted">×${fq(k.qty)}</span></span><span class="num">${rp(k.nilai)}</span></div><div class="hbar"><i style="width:${(k.nilai / L.bruto * 100).toFixed(1)}%"></i></div></div>`).join("")}</div>` : `<div class="empty">-</div>`}</section>
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Produk terlaris</h3>${L.terlaris.length ? `<table><tbody>${L.terlaris.map((t, i) => `<tr><td class="muted num">${i + 1}</td><td>${esc(t.nama)}</td><td class="r num">×${fq(t.qty)}</td><td class="r num">${rp(t.nilai)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">-</div>`}</section>
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Ringkasan</h3><table><tbody>
        <tr><td>Penjualan barang</td><td class="r num">${rp(L.bruto)}</td></tr><tr><td>Diskon</td><td class="r num">−${rp(L.diskon)}</td></tr><tr><td>Ongkir</td><td class="r num">${rp(L.ongkir)}</td></tr>
        <tr><td>HPP (modal)</td><td class="r num">−${rp(L.hpp)}</td></tr><tr><td>Pengeluaran</td><td class="r num">−${rp(L.biaya)}</td></tr>
        ${L.piutang ? `<tr><td>Belum lunas (DP)</td><td class="r num" style="color:var(--warn)">${rp(L.piutang)}</td></tr>` : ""}
        ${L.produksi.qty ? `<tr><td>Produksi karyawan</td><td class="r num">${fq(L.produksi.qty)} pcs · ${rp(L.produksi.insentif)}</td></tr>` : ""}
        ${L.perMetode.map(m => `<tr><td class="muted">Diterima ${esc(m.metode)}</td><td class="r num">${rp(m.nilai)}</td></tr>`).join("")}
        ${L.perKasir.map(k => `<tr><td class="muted">Kasir ${esc(k.kasir)}</td><td class="r num">${k.transaksi} trx · ${rp(k.nilai)}</td></tr>`).join("")}
      </tbody></table></section>
      <section class="panel"><h3 style="font-size:16px;margin-bottom:10px">Bahan perlu dibeli</h3>${L.bahanKritis.length ? `<table><tbody>${L.bahanKritis.map(x => `<tr><td>${esc(x.nama)}</td><td class="r num" style="color:${x.stok <= 0 ? "var(--bad)" : "var(--warn)"};font-weight:700">${fq(x.stok)}</td><td class="r small muted">min ${fq(x.stok_min)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">Semua bahan di atas batas minimum.</div>`}</section>
    </div>`;
  });
}

/* ================= PENGATURAN ================= */
function vAtur(){
  $("#main").innerHTML = `
    <div class="view-head"><h2>Pengaturan</h2></div>
    <div class="grid2" style="align-items:start">
      <section class="panel stack"><h3 style="font-size:17px">Perangkat ini</h3>
        <p class="small muted" style="margin:0">Berlaku untuk HP/tablet yang sedang dipakai saja.</p>
        <label class="f">Lebar kertas printer<select id="pK"><option value="58" ${D.kertas == 58 ? "selected" : ""}>58 mm (32 karakter)</option><option value="80" ${D.kertas == 80 ? "selected" : ""}>80 mm (48 karakter)</option></select></label>
        <label class="f">Cara mencetak<select id="pM">${NATIVE && NATIVE.cetakLangsung ? `<option value="langsung" ${D.modeCetak === "langsung" ? "selected" : ""}>Printer bawaan iMin langsung (paling tajam)</option>` : ""}<option value="chrome" ${D.modeCetak === "chrome" ? "selected" : ""}>Layanan cetak Android (gambar)</option><option value="rawbt" ${D.modeCetak === "rawbt" ? "selected" : ""}>Aplikasi RawBT (ESC/POS)</option></select></label>
        <p class="note">${NATIVE && NATIVE.cetakLangsung ? `<b>Printer bawaan langsung</b> mengirim teks ke printer iMin seperti aplikasi kasir lain, hasilnya hitam dan tajam. Bluetooth harus menyala (printer iMin tersambung lewat Bluetooth internal "BluetoothPrinter"). ${(() => { const st = statusPrinterLangsung(); return st === "izin" ? "Saat mencetak pertama kali, izinkan akses <i>Perangkat sekitar</i>." : st ? `Printer ditemukan: <b>${esc(st)}</b>.` : "Printer bawaan belum terdeteksi — pastikan Bluetooth menyala."; })()}<br>` : ""}Layanan cetak Android mengubah struk menjadi gambar, sehingga bisa tampak buram. RawBT butuh aplikasi RawBT dari Play Store.</p>
        <button class="btn" id="pTest" type="button">Cetak struk uji</button>
        <label class="f">Tema<select id="thm"><option value="">Ikuti perangkat</option><option value="light" ${D.tema === "light" ? "selected" : ""}>Terang</option><option value="dark" ${D.tema === "dark" ? "selected" : ""}>Gelap</option></select></label>
      </section>
      <section class="panel stack"><h3 style="font-size:17px">Akun saya</h3>
        <p class="small muted" style="margin:0">Masuk sebagai <b>${esc(B.me.nama)}</b> (${isAdmin() ? "admin" : "karyawan"}).</p>
        <label class="f">Password / PIN lama<input type="password" id="pwL" autocomplete="current-password"></label>
        <label class="f">Password / PIN baru (${isAdmin() ? "min. 8 karakter" : "min. 4 karakter"})<input type="password" id="pwB" autocomplete="new-password"></label>
        <button class="btn" id="pwSave" type="button">Ganti password</button>
      </section>
      ${isAdmin() ? `<section class="panel stack" id="aToko"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aUser"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aCabang"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aSync"><div class="empty">Memuat…</div></section>
      <section class="panel stack"><h3 style="font-size:17px">Cadangan &amp; impor</h3>
        <p class="small muted" style="margin:0">${LOKAL ? "Aplikasi menyimpan cadangan otomatis setiap hari di folder Download/RichGallery (7 hari terakhir)." : "Server juga membuat cadangan otomatis setiap hari (lihat panduan pemasangan)."}</p>
        ${LOKAL ? `<button class="btn" id="bkDb" type="button">Simpan cadangan database sekarang</button>` : `<a class="btn" href="/api/cadangan" download>Unduh cadangan database</a>`}
        <p class="small" style="margin:0"><b>Pulihkan dari cadangan (.db).</b> Mengganti <u>seluruh</u> data di ${LOKAL ? "aplikasi ini" : "server ini"} dengan isi file cadangan. Bisa memakai cadangan dari aplikasi Android maupun dari server, jadi ini juga cara memindahkan data dari aplikasi offline ke server online.</p>
        <label class="btn danger" for="rsFile">Pilih file cadangan (.db / .json) untuk dipulihkan</label><input type="file" id="rsFile" accept=".db,.json,application/json,application/octet-stream,application/x-sqlite3" hidden>
        <hr class="sep">
        <p class="small" style="margin:0"><b>Pindahkan data dari aplikasi versi file.</b> Di aplikasi lama: Pengaturan → Unduh cadangan (.json), lalu pilih file itu di sini. Data yang sudah pernah diimpor tidak akan tergandakan.</p>
        <label class="row small"><input type="checkbox" id="impStok"> Pakai angka stok dari file cadangan</label>
        <label class="btn" for="impFile">Pilih file cadangan lama (.json)</label><input type="file" id="impFile" accept=".json,application/json" hidden>
      </section>` : ""}
      ${NATIVE ? `<section class="panel stack" id="aMode"></section>` : ""}
    </div>`;
  if (NATIVE) aturMode();
  $("#pK").onchange = e => { D.kertas = +e.target.value; simpanD(); vAtur(); };
  $("#pM").onchange = e => { D.modeCetak = e.target.value; D.modeDipilih = true; simpanD(); vAtur(); };
  $("#thm").onchange = e => { D.tema = e.target.value; simpanD(); terapkanTema(); };
  $("#pTest").onclick = () => cetak({ no: B.toko.prefix + "UJI", tgl: today(), jam: "00:00", kasir: B.me.nama, pelanggan: "UJI CETAK", hp: "", items: [{ nama: "BUKET BUNGA 100K", harga: 100000, qty: 1 }, { nama: "COKLAT SILVERQUEEN", harga: 15000, qty: 2 }], subtotal: 130000, diskon: 0, ongkir: 0, total: 130000, metode: "Tunai", bayar: 150000, catatan: "" });
  $("#pwSave").onclick = e => coba(async () => { await api("POST", "/api/akun/password", { lama: $("#pwL").value, baru: $("#pwB").value }); $("#pwL").value = $("#pwB").value = ""; toast("Password diganti"); }, e.target);
  if (!isAdmin()) return;
  aturToko(); aturUser(); aturSync(); aturCabang();
  if ($("#bkDb")) $("#bkDb").onclick = e => coba(async () => { const r = await api("GET", "/api/cadangan"); toast(`Cadangan tersimpan di ${r.disimpan}`); }, e.target);
  $("#rsFile").onchange = e => { const f = e.target.files[0]; if (!f) return; e.target.value = "";
    const r = new FileReader();
    r.onload = () => { const b64 = String(r.result).split(",")[1] || "";
      modal(`<h3>Pulihkan ${esc(f.name)}?</h3><p>Semua data di ${LOKAL ? "aplikasi ini" : "server ini"} (transaksi, stok, produksi, pengguna) akan <b>diganti</b> dengan isi file ini. Pengguna dan PIN mengikuti file cadangan.</p>
        <label class="f">Ketik <b>GANTI SEMUA DATA</b> untuk melanjutkan<input type="text" id="rsK" autocomplete="off"></label>
        <div class="actions"><button class="btn" data-close>Batal</button><button class="btn danger" id="rsOk">Pulihkan</button></div>`, m => {
        $("#rsOk", m).onclick = ev => coba(async () => {
          await api("POST", "/api/pulihkan", { data: b64, konfirmasi: $("#rsK", m).value.trim().toUpperCase() });
          closeModal(); toast("Data dipulihkan. Silakan masuk lagi."); setTimeout(() => location.reload(), 900);
        }, ev.target);
      }); };
    r.readAsDataURL(f); };
  $("#impFile").onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => { let d; try { d = JSON.parse(r.result); } catch { return toast("File tidak terbaca sebagai JSON"); }
      konfirmasi("Impor data lama?", `File berisi ${(d.sales || []).length} transaksi, ${(d.produk || []).length} produk, ${(d.produksi || []).length} catatan produksi.`, "Impor", () => coba(async () => {
        const n = await api("POST", `/api/impor-lama?timpa_stok=${$("#impStok").checked ? 1 : 0}`, d);
        await muatUlang(); toast(`Diimpor: ${n.penjualan} transaksi, ${n.produk} produk, ${n.produksi} produksi, ${n.pengeluaran} pengeluaran`); vAtur();
      }), false); };
    r.readAsText(f); };
}
async function aturToko(){
  const s = await coba(() => api("GET", "/api/pengaturan")); if (!s || view !== "atur") return;
  $("#aToko").innerHTML = `<h3 style="font-size:17px">Toko &amp; struk</h3>
    <label class="f">Nama toko<input type="text" id="tN" value="${esc(s.nama_toko)}"></label>
    <label class="f">Alamat<input type="text" id="tA" value="${esc(s.alamat)}"></label>
    <label class="f">No telepon / WA toko<input type="tel" id="tT" value="${esc(s.telp)}"></label>
    <label class="f">Teks bawah struk<textarea id="tF" rows="5">${esc(s.footer)}</textarea></label>
    <div class="row"><label class="f grow">Awalan no invoice<input type="text" id="tP" value="${esc(s.prefix)}"></label><label class="f grow">No berikutnya<input type="number" id="tNo" value="${s.no_berikutnya}" min="1"></label></div>
    <label class="f">HPP otomatis (% dari harga jual)<input type="number" id="tH" value="${s.hpp_persen}" min="0" max="100"></label>
    <div class="row"><label class="f grow">Insentif produksi per pcs (Rp)<input type="number" id="tI" value="${s.insentif}" min="0" step="500"></label><label class="f grow">Periode insentif mulai tanggal<input type="number" id="tPm" value="${s.periode_mulai}" min="1" max="28"></label></div>
    <button class="btn pri" id="tSave" type="button">Simpan pengaturan toko</button>`;
  $("#tSave").onclick = e => coba(async () => {
    await api("PUT", "/api/pengaturan", { nama_toko: $("#tN").value, alamat: $("#tA").value, telp: $("#tT").value, footer: $("#tF").value, prefix: $("#tP").value, no_berikutnya: $("#tNo").value, hpp_persen: $("#tH").value, insentif: $("#tI").value, periode_mulai: $("#tPm").value });
    await muatUlang(); shell(); render(); toast("Pengaturan toko tersimpan");
  }, e.target);
}
async function aturUser(){
  const list = await coba(() => api("GET", "/api/users")); if (!list || view !== "atur") return;
  $("#aUser").innerHTML = `<h3 style="font-size:17px">Pengguna</h3>
    <p class="small muted" style="margin:0">Karyawan tanpa PIN tetap muncul sebagai pembuat di Produksi, tapi tidak bisa masuk.</p>
    <div class="list">${list.map(u => `<div class="li click ${u.aktif ? "" : "void"}" data-id="${u.id}"><div class="main"><div class="t">${esc(u.nama)}</div><div class="small muted">${u.peran === "admin" ? "Admin" : "Karyawan"} · ${u.aktif ? (u.bisa_masuk ? "bisa masuk" : "belum punya PIN") : "nonaktif"}</div></div><span class="pill ${u.peran === "admin" ? "ok" : "mut"}">${u.peran.toUpperCase()}</span></div>`).join("")}</div>
    <button class="btn" id="uAdd" type="button">+ Tambah pengguna</button>`;
  $("#uAdd").onclick = () => formUser(null);
  $$("#aUser .li").forEach(r => r.onclick = () => formUser(list.find(u => u.id === +r.dataset.id)));
}
function formUser(u){
  modal(`<h3>${u ? "Ubah " + esc(u.nama) : "Tambah pengguna"}</h3>
    <div class="stack">
      <label class="f">Nama (dipakai untuk masuk)<input type="text" id="uN" value="${esc(u ? u.nama : "")}" maxlength="40"></label>
      <label class="f">Peran<select id="uR"><option value="karyawan" ${u?.peran !== "admin" ? "selected" : ""}>Karyawan: kasir, produksi, stok, masuk/keluar, opname</option><option value="admin" ${u?.peran === "admin" ? "selected" : ""}>Admin: semua menu termasuk laporan & pengaturan</option></select></label>
      <label class="f">${u ? "Password / PIN baru (kosongkan bila tidak diganti)" : "Password / PIN (kosongkan bila belum perlu masuk)"}<input type="password" id="uP" autocomplete="new-password"></label>
      <p class="small muted" style="margin:0">Karyawan: PIN minimal 4 angka. Admin: password minimal 8 karakter.</p>
      ${u ? `<label class="row small"><input type="checkbox" id="uA" ${u.aktif ? "checked" : ""}> Aktif</label>` : ""}
      ${u && u.bisa_masuk && u.peran !== "admin" ? `<label class="row small"><input type="checkbox" id="uX"> Cabut PIN (tidak bisa masuk lagi)</label>` : ""}
    </div>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="uOk">Simpan</button></div>`, m => {
      $("#uOk", m).onclick = e => coba(async () => {
        const body = { nama: $("#uN", m).value, peran: $("#uR", m).value };
        if ($("#uP", m).value) body.password = $("#uP", m).value;
        if (u) { body.aktif = $("#uA", m).checked; if ($("#uX", m)?.checked) body.hapusPassword = true; await api("PUT", `/api/users/${u.id}`, body); }
        else await api("POST", "/api/users", body);
        closeModal(); toast("Pengguna tersimpan"); await muatUlang(); aturUser();
      }, e.target);
    });
}
async function aturSync(){
  const s = await coba(() => api("GET", "/api/pengaturan")); if (!s || view !== "atur") return;
  const st = s.sync;
  if (LOKAL && s.cabang_url) { $("#aSync").innerHTML = `<h3 style="font-size:17px">Sinkron ke Google Sheet</h3><p class="small muted" style="margin:0">Perangkat ini tersambung ke server pusat. Server pusat yang mengirim semua transaksi ke Google Sheet.</p>`; return; }
  $("#aSync").innerHTML = `<h3 style="font-size:17px">Sinkron ke Google Sheet</h3>
    <p class="small muted" style="margin:0">${LOKAL ? "Aplikasi" : "Server"} mengirim setiap transaksi, mutasi, opname, produksi, insentif dan pengeluaran ke tab <b>APP …</b> di sheet PEMBUKUAN RG 2026${LOKAL ? " setiap kali HP terhubung internet" : ""}. Tab lama tidak diubah.</p>
    <label class="f">URL Web App Apps Script<input type="url" id="sU" value="${esc(s.sync_url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <div class="row"><button class="btn" id="sUSave" type="button">Simpan URL</button><button class="btn pri" id="sGo" type="button">Kirim sekarang</button></div>
    <p class="small ${st.galat && st.menunggu ? "" : "muted"}" style="margin:0;${st.galat && st.menunggu ? "color:var(--bad)" : ""}">${st.menunggu} baris menunggu${st.terakhir ? " · terakhir terkirim " + new Date(st.terakhir).toLocaleString("id-ID") : ""}${st.galat && st.menunggu ? " · galat: " + esc(st.galat) : ""}</p>
    <hr class="sep">
    <label class="f">ID Google Sheet (untuk tarik daftar barang)<input type="text" id="sId" value="${esc(s.sheet_id)}"></label>
    <label class="row small"><input type="checkbox" id="pullStok"> Timpa juga angka stok dengan angka di sheet</label>
    <div class="row"><button class="btn" id="pullP" type="button">Tarik produk (READY STOK)</button><button class="btn" id="pullB" type="button">Tarik bahan (STOK OPNAME)</button></div>
    <p class="small muted" style="margin:0">Sheet harus bisa dilihat oleh siapa saja yang memiliki link.</p>`;
  $("#sUSave").onclick = e => coba(async () => { await api("PUT", "/api/pengaturan", { sync_url: $("#sU").value.trim() }); toast("URL tersimpan"); aturSync(); cekSync(); }, e.target);
  $("#sGo").onclick = e => coba(async () => { const r = await api("POST", "/api/sync/kirim"); toast(r.terkirim ? `${r.terkirim} baris terkirim` : (r.alasan || (r.galat ? "Gagal: " + r.galat : "Tidak ada yang perlu dikirim"))); aturSync(); cekSync(); }, e.target);
  const tarik = jenis => e => coba(async () => {
    await api("PUT", "/api/pengaturan", { sheet_id: $("#sId").value.trim() });
    toast("Mengambil data dari Google Sheet…");
    const r = await api("POST", "/api/sync/tarik", { jenis, timpa_stok: $("#pullStok").checked });
    await muatUlang(); toast(`${jenis === "produk" ? "Produk" : "Bahan"}: ${r.baru} baru, ${r.diperbarui} diperbarui`);
  }, e.target);
  $("#pullP").onclick = tarik("produk"); $("#pullB").onclick = tarik("bahan");
}

/* ---------- Server pusat: perangkat offline (iMin) mengirim transaksinya ke server saat bisa dihubungi ---------- */
/** Server toko di Cloudflare (gratis, menyala 24 jam). Dipakai sebagai alamat bawaan di aplikasi. */
const SERVER_TOKO = "https://rich-gallery-pos.yudi-b27fjr.workers.dev";
const waktuLokal = iso => iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-";
async function aturCabang(){
  const el = $("#aCabang"); if (!el) return;
  if (!LOKAL) { // di server: daftar perangkat yang tersambung
    const d = await coba(() => api("GET", "/api/cabang/perangkat")); if (!d || view !== "atur") return;
    el.innerHTML = `<h3 style="font-size:17px">Perangkat cabang</h3>
      <p class="small muted" style="margin:0">Perangkat kasir (mis. iMin) yang bekerja offline dan mengirim transaksinya ke server ini. Sambungkan dari Pengaturan di perangkat itu.</p>
      ${d.length ? d.map(x => `<div class="row" style="border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--surface);align-items:center">
        <div style="flex:1;min-width:0"><b>${esc(x.kode)} · ${esc(x.nama)}</b>${x.dicabut ? ` <span class="pill mut">dicabut</span>` : ""}
          <div class="small muted">Terakhir: ${x.terakhir ? waktuLokal(x.terakhir.replace(" ", "T") + "Z") : "belum pernah"} · ${x.diterima} transaksi diterima${x.ditolak ? ` · <span style="color:var(--bad)">${x.ditolak} ditolak</span>` : ""}</div></div>
        ${x.dicabut ? "" : `<button class="btn sm danger" data-cabut="${x.id}" type="button">Cabut</button>`}</div>`).join("")
        : `<div class="empty">Belum ada perangkat yang tersambung.</div>`}`;
    el.querySelectorAll("[data-cabut]").forEach(b => b.onclick = () => konfirmasi("Cabut perangkat ini?", "Perangkat tidak bisa mengirim transaksi lagi sampai disambungkan ulang. Data yang sudah diterima tetap ada.", "Cabut", async () => { await api("DELETE", `/api/cabang/perangkat/${b.dataset.cabut}`); toast("Perangkat dicabut"); aturCabang(); }));
    return;
  }
  const st = await coba(() => api("GET", "/api/cabang")); if (!st || view !== "atur") return;
  if (!st.aktif) {
    el.innerHTML = `<h3 style="font-size:17px">Server pusat (sinkron otomatis)</h3>
      <p class="small muted" style="margin:0">Perangkat ini tetap bekerja offline. Begitu server pusat bisa dihubungi, transaksi otomatis terkirim ke sana, dan harga, produk, stok serta akun dari server masuk ke sini.</p>
      <p class="note" style="margin:0"><b>Sebelum menyambung:</b> pindahkan dulu data perangkat ini ke server (Simpan cadangan di sini, lalu pulihkan di server). Setelah tersambung, produk, akun dan pengaturan toko diubah di server saja.</p>
      <label class="f">Alamat server<input type="url" id="cbUrl" value="${esc(SERVER_TOKO)}" placeholder="${esc(SERVER_TOKO)}" autocomplete="off"></label>
      <label class="f">Nama admin di server<input type="text" id="cbNama" value="${esc(B.me.nama)}" autocomplete="off"></label>
      <label class="f">Password admin di server<input type="password" id="cbPw" autocomplete="off"></label>
      <label class="f">Nama perangkat ini<input type="text" id="cbAlat" value="iMin kasir" maxlength="40"></label>
      <button class="btn pri" id="cbGo" type="button">Sambungkan ke server pusat</button>`;
    const isian = () => ({ url: $("#cbUrl").value.trim(), nama: $("#cbNama").value.trim(), password: $("#cbPw").value, perangkat: $("#cbAlat").value.trim() });
    const sambung = (opsi = {}, tombol) => coba(async () => {
      toast(opsi.unggahAwal ? "Mengirim semua data ke server… jangan tutup aplikasi" : "Menghubungi server…");
      try {
        await api("POST", "/api/cabang/sambung", { ...isian(), ...opsi });
      } catch (err) {
        if (err.status === 409 && !opsi.paksa && !opsi.unggahAwal && /belum ada di server/.test(err.message)) return tawarPindah();
        throw err;
      }
      await muatUlang(); toast(opsi.unggahAwal ? "Semua data terkirim. Tersambung ke server pusat" : "Tersambung ke server pusat"); aturCabang(); cekSync();
    }, tombol);
    // Server belum punya data perangkat ini: kirim semua (server baru), atau sambungkan saja.
    const tawarPindah = () => modal(`<h3>Server belum punya data perangkat ini</h3>
      <p>Bila server ini <b>masih baru</b> (mis. baru dipasang di Cloudflare), kirim semua data perangkat ini ke sana: produk, stok, transaksi, produksi, pengeluaran, akun dan PIN. Setelah itu masuk ke server memakai akun yang sama dengan di perangkat ini.</p>
      <p class="small muted">Bila server sudah berisi transaksi, data tidak akan ditimpa dan pengiriman ditolak dengan aman.</p>
      <div class="actions"><button class="btn" data-close>Batal</button><button class="btn" id="cbPaksa">Sambungkan tanpa memindah data</button><button class="btn pri" id="cbKirim">Kirim semua data ke server</button></div>`, m => {
        $("#cbKirim", m).onclick = e => { closeModal(); sambung({ unggahAwal: true }, $("#cbGo")); };
        $("#cbPaksa", m).onclick = e => { closeModal(); sambung({ paksa: true }, $("#cbGo")); };
      });
    $("#cbGo").onclick = e => sambung({}, e.target);
    return;
  }
  const masalah = st.galatTerakhir && st.menunggu;
  el.innerHTML = `<h3 style="font-size:17px">Server pusat (sinkron otomatis)</h3>
    <p class="small" style="margin:0">Tersambung ke <b>${esc(st.url)}</b> sebagai perangkat <b>${esc(st.kode)} · ${esc(st.nama)}</b>. Nomor nota perangkat ini: <b>${esc(B.toko.prefix)}${esc(st.kode)}-…</b></p>
    <p class="small" style="margin:0;${masalah ? "color:var(--bad)" : ""}">${st.menunggu ? `<b>${st.menunggu} transaksi menunggu dikirim.</b>` : "Semua transaksi sudah terkirim."} Terakhir sinkron: ${waktuLokal(st.terakhir)}${st.galatTerakhir ? `<br>${esc(st.galatTerakhir)}` : ""}</p>
    ${st.ditolak ? `<p class="small" style="margin:0;color:var(--bad)">${st.ditolak} transaksi ditolak server (7 hari terakhir):<br>${st.ditolakDaftar.map(x => `${esc(x.aksi)}: ${esc(x.galat || "")}`).join("<br>")}</p>` : ""}
    <p class="small muted" style="margin:0">Sinkron berjalan otomatis tiap 30 detik selama aplikasi terbuka dan ada internet. Produk, akun dan pengaturan toko diubah di server pusat.</p>
    ${st.url.replace(/\/+$/, "") !== SERVER_TOKO ? `<p class="note" style="margin:0">Server toko sekarang ada di Cloudflare: <b>${esc(SERVER_TOKO)}</b>. Untuk pindah: tekan <b>Putuskan</b> (setelah semua transaksi terkirim), lalu sambungkan lagi. Alamat Cloudflare sudah terisi otomatis.</p>` : ""}
    <div class="row"><button class="btn pri" id="cbSync" type="button">Sinkron sekarang</button><button class="btn" id="cbPutus" type="button">Putuskan</button></div>`;
  $("#cbSync").onclick = e => coba(async () => { const r = await api("POST", "/api/cabang/sinkron"); await muatUlang(); toast(r.galatTerakhir ? "Belum terkirim: " + r.galatTerakhir : r.menunggu ? `${r.menunggu} masih menunggu` : "Sinkron selesai"); aturCabang(); cekSync(); }, e.target);
  $("#cbPutus").onclick = () => konfirmasi("Putuskan dari server pusat?", st.menunggu ? `Masih ada ${st.menunggu} transaksi yang belum terkirim. Bila diputuskan sekarang, transaksi itu TIDAK akan dikirim.` : "Perangkat kembali bekerja sendiri. Data yang sudah terkirim tetap ada di server.", "Putuskan", async () => {
    await api("POST", "/api/cabang/putus", { paksa: !!st.menunggu }); toast("Diputuskan dari server pusat"); aturCabang(); cekSync();
  });
}

/* ---------- Pembaruan otomatis (aplikasi Android) ----------
   Native mengunduh pembaruan di latar belakang lalu memanggil window.rgPembaruan(jenis, teks):
   "web" = tampilan & aturan baru siap, tinggal muat ulang; "apk" = versi aplikasi baru; "info" = pesan biasa. */
window.rgPembaruan = (jenis, teks) => {
  if (jenis === "info") return toast(teks);
  let b = $("#spandukUpdate");
  if (!b) { b = document.createElement("div"); b.id = "spandukUpdate"; b.className = "spanduk"; document.body.appendChild(b); }
  b.innerHTML = jenis === "web"
    ? `<span><b>Pembaruan siap.</b> ${teks ? esc(teks) + ". " : ""}Muat ulang untuk memakai versi terbaru.</span><button class="btn sm" id="sbOk" type="button">Muat ulang</button><button class="btn ghost sm" id="sbX" type="button" aria-label="Nanti">Nanti</button>`
    : `<span><b>Aplikasi versi ${esc(teks)} tersedia.</b> Pasang untuk fitur terbaru; data tetap aman.</span><button class="btn sm" id="sbOk" type="button">Pasang</button><button class="btn ghost sm" id="sbX" type="button" aria-label="Nanti">Nanti</button>`;
  $("#sbOk", b).onclick = () => { b.remove(); if (jenis === "web") location.reload(); else NATIVE?.pasangApk?.(); };
  $("#sbX", b).onclick = () => b.remove();
};

/* Mode aplikasi Android: offline (data di HP ini) atau online (membuka website server). */
function aturMode(){
  const info = (() => { try { return JSON.parse(NATIVE.info()); } catch { return {}; } })();
  $("#aMode").innerHTML = `<h3 style="font-size:17px">Mode aplikasi</h3>
    <p class="small" style="margin:0">Sekarang: <b>${info.mode === "online" ? "Online — " + esc(info.server) : "Offline — data tersimpan di HP ini"}</b></p>
    <p class="small muted" style="margin:0">Aplikasi ${esc(info.versi || "?")}${info.web ? ` · tampilan #${info.web}` : ""}. Pembaruan diperiksa otomatis saat aplikasi dibuka.</p>
    ${NATIVE.periksaPembaruan ? `<button class="btn" id="mCek" type="button">Periksa pembaruan sekarang</button>` : ""}
    ${info.mode === "online" ? `<p class="small muted" style="margin:0">Data offline di HP ini tetap tersimpan dan bisa dibuka lagi kapan saja.</p>
      <button class="btn" id="mOff" type="button">Kembali ke mode offline</button>`
    : `<p class="note" style="margin:0"><b>Disarankan:</b> tetap offline dan pakai bagian <b>Server pusat (sinkron otomatis)</b> di atas. Kasir tetap cepat walau internet putus, dan semua transaksi otomatis terkirim ke server.</p>
      <p class="small muted" style="margin:0">Atau buka website server langsung di aplikasi ini (butuh internet setiap saat):</p>
      <label class="f">Alamat server<input type="url" id="mUrl" value="${esc(SERVER_TOKO)}" placeholder="${esc(SERVER_TOKO)}"></label>
      <button class="btn pri" id="mOn" type="button">Pakai server online</button>`}`;
  const cek = $("#mCek"); if (cek) cek.onclick = () => { toast("Memeriksa pembaruan…"); NATIVE.periksaPembaruan(); };
  const off = $("#mOff"); if (off) off.onclick = () => NATIVE.setMode("offline", "");
  const on = $("#mOn"); if (on) on.onclick = () => { const u = $("#mUrl").value.trim(); if (!/^https:\/\/[^/]+/.test(u)) return toast("Alamat server harus diawali https://"); konfirmasi("Pakai server online?", `Aplikasi akan membuka ${u}. Data offline di HP ini tidak dihapus.`, "Pakai server", () => NATIVE.setMode("online", u), false); };
}

/* ================= mulai ================= */
async function mulai(){
  try {
    if (LOKAL && !window.RG_LOKAL) await import("/lokal/mesin.js");
    const st = await api("GET", "/api/status");
    // Layar setup/masuk juga berarti halaman berhasil tampil, supaya pembaruan tidak dibatalkan otomatis.
    if (st.perluSetup) { tampilSetup(); return halamanTampil(); }
    if (!st.masuk) { tampilLogin(); return halamanTampil(); }
    await muatUlang();
  } catch (e) {
    if (e.status === 401) return;
    $("#root").innerHTML = `<div class="auth"><div class="card"><h1>Tidak terhubung</h1><p>${esc(e.message)}</p><button class="btn pri" id="ulang">Coba lagi</button></div></div>`;
    $("#ulang").onclick = mulai; return;
  }
  try { const h = location.hash.slice(1); if (SEMUA_VIEW.some(v => v[0] === h)) view = h; } catch {}
  pPer = null; shell(); render();
  halamanTampil();
}
/** Halaman berhasil tampil: konfirmasi ke aplikasi (jaring pengaman pembaruan), lalu tampilkan pembaruan yang menunggu. */
function halamanTampil(){
  try { NATIVE?.webSiap?.(); const s = NATIVE?.statusPembaruan?.(); if (s) { const o = JSON.parse(s); if (o.jenis === "web") tawarkanWebBila(o.teks); else window.rgPembaruan(o.jenis, o.teks); } } catch {}
}
/** Aplikasi mengingat pesan "pembaruan siap" sampai ditutup. Setelah dimuat ulang, halaman ini sudah versi terbaru:
 *  bandingkan versi halaman ini dengan versi yang aktif di aplikasi, jangan tawarkan lagi bila sudah sama. */
async function tawarkanWebBila(teks){
  try {
    const aktif = Number(JSON.parse(NATIVE.info()).web || 0);
    const r = await fetch("/versi-web.json", { cache: "no-store" });
    const halaman = Number((await r.json()).web || 0);
    if (halaman && aktif && halaman >= aktif) return; // sudah memakai versi terbaru
  } catch { /* tidak bisa memastikan: tetap tawarkan */ }
  window.rgPembaruan("web", teks);
}
mulai();
/* ================= data selalu terbaru =================
   - Perangkat cabang: begitu data dari server masuk (transaksi perangkat lain, produksi, pengeluaran), layar dimuat ulang.
   - Server (browser): memeriksa penanda versi data tiap 15 detik; bila berubah, layar dimuat ulang.
   - Tarik layar ke bawah: sinkron sekarang juga (perangkat cabang) lalu muat ulang.
   Isian formulir yang sedang diketik tidak pernah tertimpa. */
let formKotor = false, sedangSegarkan = false;
document.addEventListener("input", e => {
  const t = e.target;
  if (!t || !t.closest || !t.closest("#main") || t.closest(".view-head")) return;
  if (["search", "date", "month"].includes(t.type)) return; // filter tampilan disimpan terpisah, aman dimuat ulang
  formKotor = true;
}, true);
const _render = render;
render = function(){ formKotor = false; return _render(); };
const bisaGambarUlang = () => !formKotor && !$("#modalRoot .modal") &&
  !(document.activeElement && document.activeElement.closest && document.activeElement.closest("#main") && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !["search", "date", "month"].includes(document.activeElement.type));
/** Ambil data terbaru dari server (paksa: dari tarikan layar) lalu tampilkan. */
async function segarkan({ paksa = false } = {}){
  if (!B || sedangSegarkan) return false;
  sedangSegarkan = true;
  let pesan = "";
  try {
    if (paksa && LOKAL) {
      try {
        const c = await api("POST", "/api/cabang/sinkron");
        if (c && c.aktif) pesan = c.galatTerakhir ? "Belum tersinkron: " + c.galatTerakhir : c.menunggu ? `${c.menunggu} transaksi masih menunggu dikirim` : "Sudah sinkron dengan server";
      } catch (e) { pesan = e.message; }
    }
    await muatUlang();
    const main = $("#main"), atas = main ? main.scrollTop : 0;
    if (view === "kasir") drawGrid(); // keranjang & isian kasir tidak disentuh
    else if (bisaGambarUlang()) { await render(); if ($("#main")) $("#main").scrollTop = atas; }
    else if (paksa) pesan = (pesan ? pesan + ". " : "") + "Simpan atau batalkan isian dulu untuk melihat data terbaru";
    if (paksa) toast(pesan || "Data terbaru sudah dimuat");
    if (isAdmin()) cekSync();
    return true;
  } catch (e) { if (paksa) toast(e.message); return false; }
  finally { sedangSegarkan = false; }
}
window.addEventListener("rg-data-baru", () => { if (!document.hidden) segarkan(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && B && !$("#modalRoot .modal")) segarkan(); });
// Pemeriksaan versi data: murah (satu angka kecil). Di perangkat cabang ini memeriksa database lokal.
setInterval(async () => {
  if (document.hidden || !B || sedangSegarkan) return;
  try {
    const v = (await api("GET", "/api/versi")).versi || "";
    if (v !== versiLayar) segarkan();
  } catch {}
}, LOKAL ? 5_000 : 15_000);

/* Tarik ke bawah untuk sinkron (layar sentuh). */
(function tarikSegarkan(){
  let mulaiY = null, jarak = 0, aktif = false;
  const AMBANG = 70;
  const tanda = () => {
    let el = document.getElementById("tarikSegar");
    if (!el) { el = document.createElement("div"); el.id = "tarikSegar"; el.className = "tarik-segar"; document.body.appendChild(el); }
    return el;
  };
  const sembunyi = () => { const el = document.getElementById("tarikSegar"); if (el) { el.style.opacity = "0"; el.style.transform = "translate(-50%, -60px)"; } };
  document.addEventListener("touchstart", e => {
    const main = e.target && e.target.closest && e.target.closest("#main");
    mulaiY = main && main.scrollTop <= 0 && e.touches.length === 1 && !$("#modalRoot .modal") ? e.touches[0].clientY : null;
    jarak = 0; aktif = false;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (mulaiY === null) return;
    const main = $("#main");
    jarak = e.touches[0].clientY - mulaiY;
    if (jarak <= 0 || (main && main.scrollTop > 0)) { if (aktif) sembunyi(); aktif = false; return; }
    aktif = true;
    const el = tanda(), geser = Math.min(jarak, 120);
    el.textContent = sedangSegarkan ? "Menyinkronkan…" : jarak >= AMBANG ? "↻ Lepas untuk sinkron" : "↓ Tarik untuk sinkron";
    el.classList.toggle("siap", jarak >= AMBANG);
    el.style.opacity = String(Math.min(1, jarak / AMBANG));
    el.style.transform = `translate(-50%, ${geser * 0.6 - 20}px)`;
  }, { passive: true });
  document.addEventListener("touchend", async () => {
    if (mulaiY === null) return;
    const lepas = aktif && jarak >= AMBANG;
    mulaiY = null; aktif = false;
    if (!lepas) { sembunyi(); return; }
    const el = tanda();
    el.textContent = "Menyinkronkan…"; el.classList.add("siap");
    try { await segarkan({ paksa: true }); } finally { sembunyi(); }
  });
})();
