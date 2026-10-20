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
/* Galat sisa dari layar sebelumnya (mis. halaman yang masih memuat saat layar masuk muncul) tidak perlu ditampilkan. */
const diLayarAplikasi = () => !!document.getElementById("main");
window.addEventListener("error", e => { try { if (diLayarAplikasi()) toast("Galat: " + (e.message || "tidak diketahui")); } catch {} });
window.addEventListener("unhandledrejection", e => { try { const m = e.reason && e.reason.message; if (!(e.reason && e.reason.status === 401) && diLayarAplikasi()) toast("Galat: " + (m || "tidak diketahui")); } catch {} });

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
  L.push({ t: lr("TOTAL", "Rp" + angka(s.total), w), b: 1 }, { t: lr((s.bayar < s.total ? "DP (" : "Bayar (") + s.metode + ")", angka(s.bayar), w) });
  if (s.metode === "Tunai" && s.bayar > s.total) L.push({ t: lr("Kembali", angka(s.bayar - s.total), w) });
  if (s.bayar < s.total) L.push({ t: lr("SISA", angka(s.total - s.bayar), w), b: 1 });
  if (s.ambil_tgl) {
    L.push({ t: garis }, { t: center("*** PESANAN ***", w), b: 1 });
    L.push({ t: lr(s.ambil_cara === "antar" ? "Diantar" : "Diambil", tglPendek(s.ambil_tgl) + (s.ambil_jam ? " " + s.ambil_jam : ""), w), b: 1 });
    if (s.request) wrap("Request: " + s.request, w).forEach(x => L.push({ t: x }));
  }
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
  lines.forEach(l => { s += (l.besar ? GS + "!\x11" + ESC + "a\x01" : "") + (l.b ? ESC + "E\x01" : "") + ascii(l.t) + (l.b ? ESC + "E\x00" : "") + (l.besar ? GS + "!\x00" + ESC + "a\x00" : "") + "\n"; });
  return s + "\n\n\n" + GS + "V\x41\x03";
}
/** Kirim ESC/POS ke printer: langsung ke printer bawaan, atau lewat aplikasi RawBT. Mengembalikan true bila terkirim. */
function kirimEscpos(s){
  if (D.modeCetak === "langsung" && NATIVE && NATIVE.cetakLangsung) { NATIVE.cetakLangsung(btoa(s)); toast("Mencetak…"); return true; }
  if (D.modeCetak === "rawbt" || D.modeCetak === "langsung") { window.location.href = "rawbt:base64," + btoa(s); return true; }
  return false;
}
/** Tinggi kertas struk (mm) sesuai jumlah baris — supaya PDF / cetak tidak menyisakan kertas kosong. */
function tinggiStruk(lines){
  const mm = D.kertas == 80 ? 80 : 58, cw = mm == 80 ? 72 : 48, fs = cw / lebar() / 0.6;
  return Math.ceil(lines.reduce((a, l) => a + (l.besar ? fs * 2.4 : fs * 1.25), 0) + 2 + 8 + 3);
}
function cetakBaris(lines){
  if (kirimEscpos(escposStruk(lines))) return;
  const mm = D.kertas == 80 ? 80 : 58, cw = mm == 80 ? 72 : 48, chars = lebar(), tinggi = tinggiStruk(lines);
  $("#page-style").textContent = `@page{size:${mm}mm ${tinggi}mm;margin:0}`;
  $("#print-area").innerHTML = `<pre style="width:${cw}mm;margin:0 ${(mm - cw) / 2}mm;padding:2mm 0 8mm;font-size:${(cw / chars / 0.6).toFixed(2)}mm">${lines.map(l => l.besar ? `<b style="font-size:2em;display:block;text-align:center;line-height:1.2">${esc(l.t)}</b>` : l.b ? `<b>${esc(l.t)}</b>` : esc(l.t)).join("\n")}</pre>`;
  setTimeout(() => cetakHalaman(mm, tinggi), 60);
}
const cetak = s => cetakBaris(strukLines(s));
/** Cetak lewat browser tanpa judul halaman (judul & alamat web hanya muncul bila "Headers and footers" Chrome dicentang). */
function cetakBrowser(){
  const judul = document.title;
  document.title = " ";
  const pulih = () => { document.title = judul; window.removeEventListener("afterprint", pulih); };
  window.addEventListener("afterprint", pulih);
  try { window.print(); } finally { setTimeout(pulih, 1500); }
  try { if (!localStorage.getItem("rg_info_header")) { localStorage.setItem("rg_info_header", "1"); setTimeout(() => toast("Tips: di dialog cetak Chrome, buka More settings → hilangkan centang \"Headers and footers\" supaya tidak ada tulisan tambahan."), 400); } } catch {}
}
/** Di aplikasi Android, window.print tidak tersedia; cetak lewat layanan cetak Android.
 *  Bila ukuran diketahui (lebar × tinggi mm), kertasnya dipotong pas — tidak ada sisa kertas kosong. */
function cetakHalaman(lebarMm, tinggiMm){
  if (NATIVE && NATIVE.cetakUkuran && lebarMm && tinggiMm) NATIVE.cetakUkuran(lebarMm, tinggiMm);
  else if (NATIVE && NATIVE.cetak) NATIVE.cetak(D.kertas);
  else cetakBrowser();
}
/** Struk sebagai PDF selebar kertas termal, tingginya pas dengan isi struk. */
function pdfStruk(s){
  const L = strukLines(s), mm = D.kertas == 80 ? 80 : 58, cw = mm == 80 ? 72 : 48, chars = lebar(), tinggi = tinggiStruk(L);
  const PX = 12, c = document.createElement("canvas"); c.width = Math.round(mm * PX); c.height = Math.round(tinggi * PX);
  const g = c.getContext("2d"), fs = cw / chars / 0.6 * PX, kiri = (mm - cw) / 2 * PX;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#000"; g.textBaseline = "top";
  let y = 2 * PX;
  L.forEach(l => {
    if (l.besar) { g.font = `700 ${fs * 2}px "Courier New", monospace`; g.textAlign = "center"; g.fillText(l.t, c.width / 2, y + fs * 0.2); y += fs * 2.4; return; }
    g.font = `${l.b ? "700" : "600"} ${fs}px "Courier New", monospace`; g.textAlign = "left";
    // spasi dijaga per karakter (seperti di printer)
    for (let i = 0; i < l.t.length; i++) if (l.t[i] !== " ") g.fillText(l.t[i], kiri + i * fs * 0.6, y);
    y += fs * 1.25;
  });
  simpanPdf(`struk-${String(s.no || "rich-gallery").replace(/[^\w-]+/g, "-")}.pdf`, buatPdf(c, mm, tinggi));
}
function waLink(s){ return `https://wa.me/${nomorWA(s.hp)}?text=` + encodeURIComponent(pesanWA(s)); }
function lihatStruk(s, setelahBatal){
  modal(`<h3>Struk ${esc(s.no)}</h3>
    <pre class="receipt-prev">${esc(strukText(s))}</pre>
    ${s.kartu ? `<div class="pesanan-isi stack" style="margin-bottom:8px"><b>Kartu ucapan</b><div style="white-space:pre-wrap">${esc(s.kartu)}</div>${tombolKartu(s.id)}</div>` : ""}
    ${s.batal_at ? `<p class="small muted">Dibatalkan oleh ${esc(s.batal_oleh || "-")}${s.batal_alasan ? ": " + esc(s.batal_alasan) : ""}</p>` : ""}
    <div class="actions">
      ${!s.batal_at && isAdmin() ? `<button class="btn bk b-batal" id="voidBtn" type="button">${ikon("batal", 18)}Batalkan</button>` : ""}
      ${isAdmin() ? `<button class="btn bk b-koreksi" id="koreksiBtn" type="button">${ikon("koreksi", 18)}Koreksi</button><button class="btn bk b-hapus" id="hapusBtn" type="button">${ikon("hapus", 18)}Hapus</button>` : ""}
      <button class="btn bk b-nota" id="notaBtn" type="button">${ikon("nota", 18)}Nota</button>
      <button class="btn bk b-pdf" id="pdfStrukBtn" type="button">${ikon("pdf", 18)}PDF struk</button>
      <a class="btn bk b-wa" href="${waLink(s)}" target="_blank" rel="noopener">${ikon("wa", 18)}Kirim WA</a>
      <button class="btn" data-close type="button">Tutup</button>
      <button class="btn bk b-struk" id="printBtn" type="button">${ikon("struk", 18)}Cetak struk</button>
    </div>`, m => {
      $("#printBtn", m).onclick = () => cetak(s);
      $("#notaBtn", m).onclick = () => bukaNota(s);
      $("#pdfStrukBtn", m).onclick = () => pdfStruk(s);
      if (s.kartu) pasangTombolKartu(m, s.kartu);
      const hb = $("#hapusBtn", m);
      if (hb) hb.onclick = () => konfirmasi(`Hapus ${s.no}?`, `Transaksi dihapus sepenuhnya dari daftar & laporan${s.batal_at ? "" : ", stok produk READY dikembalikan"}. Pakai untuk salah input atau data uji coba. Tidak bisa dibatalkan.`, "Hapus transaksi", () => coba(async () => {
        await api("DELETE", `/api/penjualan/${s.id}`); toast(`${s.no} dihapus`); await muatUlang(); setelahBatal ? setelahBatal() : render();
      }));
      const kb = $("#koreksiBtn", m);
      if (kb) kb.onclick = () => konfirmasi(`Koreksi ${s.no}?`, `Transaksi ini dihapus${s.batal_at ? "" : " (stok dikembalikan)"}, lalu semua barangnya dimasukkan lagi ke keranjang kasir untuk diperbaiki dan disimpan ulang dengan nomor nota baru.${cart.items.length ? " Isi keranjang sekarang akan diganti." : ""}`, "Hapus & koreksi", () => coba(async () => {
        await api("DELETE", `/api/penjualan/${s.id}`);
        await muatUlang();
        cart = { ...cartKosong(), pelanggan: s.pelanggan === "CUSTOMER" ? "" : s.pelanggan, hp: s.hp || "", diskon: s.diskon || 0, ongkir: s.ongkir || 0, metode: s.metode, catatan: s.catatan || "", tgl: s.tgl !== today() ? s.tgl : "",
          kartuOn: !!s.kartu, kartu: s.kartu || "", pesanan: !!s.ambil_tgl, ambil_tgl: s.ambil_tgl || "", ambil_jam: s.ambil_jam || "", ambil_cara: s.ambil_cara || "ambil", request: s.request || "", bayar: s.bayar < s.total ? s.bayar : 0, bayarMode: s.bayar < s.total ? "dp" : "lunas",
          items: s.items.map(i => { const p = i.kode ? B.produk.find(x => x.kode === i.kode) : null;
            const pb = i.pembuat ? B.staf.find(u => u.nama === i.pembuat) : null;
            return { product_id: p ? p.id : null, kode: p ? p.kode : "", nama: i.nama, kategori: i.kategori, harga: i.harga, qty: i.qty, ready: p ? !!i.ready : false, pembuat_id: pb ? pb.id : null }; }) };
        saveCart(); toast("Perbaiki isi keranjang, lalu simpan lagi"); pindah("kasir");
      }), false);
      const vb = $("#voidBtn", m);
      if (vb) vb.onclick = () => modal(`<h3>Batalkan ${esc(s.no)}?</h3><p>Transaksi ditandai batal dan stok produk READY dikembalikan.</p>
          <label class="f">Alasan<input type="text" id="alasan" placeholder="Contoh: salah input harga"></label>
          <div class="actions"><button class="btn" data-close>Kembali</button><button class="btn danger" id="okv">Batalkan transaksi</button></div>`, m2 => {
          $("#okv", m2).onclick = e => coba(async () => { await api("POST", `/api/penjualan/${s.id}/batal`, { alasan: $("#alasan", m2).value }); closeModal(); toast("Transaksi dibatalkan, stok dikembalikan"); await muatUlang(); setelahBatal ? setelahBatal() : render(); }, e.target);
        });
    });
}

/* ================= NOTA / INVOICE A4 (bisa diedit sebelum dicetak / dikirim) ================= */
const muatGambar = src => new Promise(ok => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
const rpNota = n => angka(n || 0);
/** Gambar nota di kanvas (dipakai untuk pratinjau, unduh gambar, dan cetak A4). */
async function gambarNota(d){
  const W = 1414, rowH = 78, baris = d.rows.filter(r => r.desc || r.harga);
  if (d.ongkir) baris.push({ desc: "Ongkir", harga: d.ongkir, qty: "", ongkir: 1 });
  const tTop = 380, rTop = tTop + 88, rEnd = rTop + Math.max(1, baris.length) * rowH;
  const H = rEnd + 40 + 100 + 88 + 205; // 1 baris ± setengah A4 (148 mm), bertambah mengikuti jumlah barang
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const SANS = '"Helvetica Neue", Arial, sans-serif', ABU = "#3f3f3f", PINK = "#f9d0ec";
  const teks = (t, x, y, { size = 28, bold = false, warna = "#111", rata = "left", font = SANS, maks = 0 } = {}) => {
    g.font = `${bold ? "700 " : "400 "}${size}px ${font}`; g.fillStyle = warna; g.textAlign = rata; g.textBaseline = "alphabetic";
    t = String(t ?? "");
    if (maks) while (t.length > 1 && g.measureText(t).width > maks) t = t.slice(0, -2) + "…";
    g.fillText(t, x, y);
  };
  const garis = (x1, y1, x2, y2, w = 2.5, warna = "#555") => { g.strokeStyle = warna; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  // Kepala: logo, nama toko, keterangan, "Invoice"
  const [logo, ttd] = await Promise.all([muatGambar("/monogram.png"), muatGambar(d.ttdImg)]);
  if (logo) { g.save(); g.beginPath(); g.arc(170, 132, 78, 0, Math.PI * 2); g.clip(); g.drawImage(logo, 92, 54, 156, 156); g.restore(); }
  teks(String(d.toko || "").toUpperCase(), 268, 122, { size: 54, bold: true, warna: ABU, maks: 560 });
  garis(270, 140, 665, 140, 3, "#111");
  teks(d.tagline, 272, 167, { size: 17, font: 'Georgia, "Times New Roman", serif', warna: "#222", maks: 400 });
  teks("Invoice", 1356, 128, { size: 78, bold: true, warna: ABU, rata: "right", font: '"Arial Black", ' + SANS });
  if (d.no) teks("No. " + d.no, 1354, 165, { size: 20, warna: "#666", rata: "right" });
  // Kepada / Dari / Tanggal
  teks("Bill To:", 107, 272, { size: 26, bold: true, font: '"Arial Black", ' + SANS });
  teks(d.billTo, 95, 322, { size: 33, maks: 400 });
  teks("From:", 645, 267, { size: 25, bold: true, rata: "center", font: '"Arial Black", ' + SANS });
  teks(d.toko ? toTitle(d.toko) : "", 663, 328, { size: 33, bold: true, rata: "center", maks: 330 });
  teks("Date", 967, 272, { size: 31 }); teks(d.tanggal, 1071, 272, { size: 33, bold: true, maks: 300 });
  teks("No hp :", 962, 328, { size: 31 }); teks(d.hp, 1080, 328, { size: 31, maks: 300 });
  // Tabel
  g.fillStyle = PINK; g.fillRect(0, tTop, W, 88);
  teks("Description", 103, tTop + 59, { size: 28, bold: true });
  teks("Price", 616, tTop + 61, { size: 28, bold: true, rata: "center" });
  teks("Qty", 1001, tTop + 59, { size: 28, bold: true, rata: "center" });
  teks("Total", 1330, tTop + 58, { size: 28, bold: true, rata: "right" });
  let sub = 0;
  baris.forEach((r, i) => {
    const y = rTop + i * rowH, q = r.ongkir ? 1 : Number(r.qty) || 0, jml = Math.round((Number(r.harga) || 0) * (r.ongkir ? 1 : q));
    if (!r.ongkir) sub += jml;
    teks(`${i + 1}.${r.desc}`, 28, y + 56, { size: 33, bold: true, maks: 470 });
    teks(rpNota(r.harga), 616, y + 58, { size: 32, bold: true, rata: "center" });
    if (!r.ongkir) teks(String(r.qty), 1001, y + 60, { size: 32, bold: true, rata: "center" });
    teks(rpNota(jml), 1326, y + 58, { size: 32, bold: true, rata: "right" });
    garis(0, y + rowH, W - 10, y + rowH);
  });
  garis(0, rEnd + 40, W, rEnd + 40);
  // Ringkasan
  const yS = rEnd + 40;
  teks("Subtotal :", 1112, yS + 26, { size: 23, bold: true, warna: "#555", font: '"Arial Black", ' + SANS });
  teks(rpNota(sub), 1355, yS + 26, { size: 23, bold: true, warna: "#555", rata: "right" });
  teks("Disc", 1114, yS + 56, { size: 23, bold: true, warna: "#555", font: '"Arial Black", ' + SANS }); teks(":", 1194, yS + 56, { size: 23, bold: true, warna: "#555" });
  if (d.diskon) teks("-" + rpNota(d.diskon), 1355, yS + 56, { size: 23, bold: true, warna: "#555", rata: "right" });
  const total = Math.max(0, sub - (Number(d.diskon) || 0) + (Number(d.ongkir) || 0));
  const yB = yS + 100;
  g.fillStyle = PINK; g.fillRect(0, yB, W, 88);
  teks("payment method:" + (d.metode || ""), 100, yB + 50, { size: 34, bold: true, warna: ABU, font: '"Arial Black", ' + SANS, maks: 700 });
  teks("Grand Total:", 1145, yB + 54, { size: 34, bold: true, warna: ABU, rata: "right", font: '"Arial Black", ' + SANS });
  teks(rpNota(total), 1170, yB + 54, { size: 33, bold: true });
  if (d.dibayar != null && d.dibayar < total) teks(`Dibayar ${rpNota(d.dibayar)} · Sisa ${rpNota(total - d.dibayar)}`, 1355, yB + 120, { size: 22, bold: true, warna: "#b45309", rata: "right" });
  // Rekening & tanda tangan
  String(d.bank || "").split("\n").slice(0, 4).forEach((b, i) => teks(b, 86, yB + 145 + i * 33, { size: 25, bold: true, warna: ABU, font: '"Arial Black", ' + SANS, maks: 620 }));
  const yT = yB + 175;
  if (ttd) {
    const s = Math.min(280 / ttd.width, 100 / ttd.height);
    g.drawImage(ttd, 1232 - ttd.width * s / 2, yT - 8 - ttd.height * s, ttd.width * s, ttd.height * s);
  } else {
    const fontTtd = '"Brush Script MT", "Segoe Script", "Snell Roundhand", "Dancing Script", cursive';
    let uk = 44; g.font = `400 ${uk}px ${fontTtd}`;
    while (uk > 18 && g.measureText(d.ttdNama || "").width > 300) { uk -= 2; g.font = `400 ${uk}px ${fontTtd}`; }
    teks(d.ttdNama, 1232, yT - 22, { size: uk, warna: "#1e2a5a", rata: "center", font: fontTtd });
  }
  garis(1082, yT, 1380, yT, 2.5, "#444");
  teks(d.ttdJabatan || "", 1232, yT + 34, { size: 27, rata: "center", warna: "#222", maks: 300 });
  if (d.ttdNama) teks("TTE: " + d.ttdNama, 1232, yT + 60, { size: 16, rata: "center", warna: "#777", maks: 330 });
  return c;
}
/** Ukuran kertas nota (mm): lebar setengah A4 mendatar (210 mm), tinggi sebanding isi. */
const ukuranNota = c => [210, Math.round(210 * c.height / c.width * 10) / 10];
/** PDF satu halaman berisi gambar (JPEG) — tanpa pustaka tambahan. Ukuran halaman dalam mm. */
/** opsi.halaman = [lebar, tinggi] mm: gambar ditaruh seukuran asli di tengah atas halaman itu, dengan garis potong (untuk cetak dari HP). */
function buatPdf(kanvas, lebarMm, tinggiMm, opsi = {}){
  const jpg = atob(kanvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
  const pt = mm => +(mm / 25.4 * 72).toFixed(2);
  const W = pt(lebarMm), H = pt(tinggiMm);
  const [PW, PH] = opsi.halaman ? opsi.halaman.map(pt) : [W, H];
  const X = opsi.halaman ? +((PW - W) / 2).toFixed(2) : 0, Y = opsi.halaman ? +(PH - pt(15) - H).toFixed(2) : 0;
  let isi = `q ${W} 0 0 ${H} ${X} ${Y} cm /Im0 Do Q`;
  if (opsi.halaman) { // garis potong di keempat sudut, sedikit di luar kartu
    const a = pt(2), b = pt(7), g = [];
    for (const [x, sx] of [[X, -1], [X + W, 1]]) for (const [y, sy] of [[Y, -1], [Y + H, 1]]) {
      g.push(`${x + sx * a} ${y} m ${x + sx * b} ${y} l S`, `${x} ${y + sy * a} m ${x} ${y + sy * b} l S`);
    }
    isi += `\n0.4 w 0 G ${g.join(" ")}`;
  }
  const obj = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /XObject /Subtype /Image /Width ${kanvas.width} /Height ${kanvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n${jpg}\nendstream`,
    `<< /Length ${isi.length} >>\nstream\n${isi}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; const pos = [];
  obj.forEach((o, i) => { pos.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n` + pos.map(p => String(p).padStart(10, "0") + " 00000 n \n").join("");
  pdf += `trailer\n<< /Size ${obj.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf; // string biner (1 karakter = 1 byte)
}
function simpanPdf(nama, biner){
  if (NATIVE && NATIVE.simpanFile) { const lok = NATIVE.simpanFile(nama, "application/pdf", btoa(biner)); toast(lok ? `PDF tersimpan di ${lok}` : "Gagal menyimpan PDF"); return; }
  const u8 = new Uint8Array(biner.length); for (let i = 0; i < biner.length; i++) u8[i] = biner.charCodeAt(i);
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([u8], { type: "application/pdf" })); a.download = nama;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/** Data nota awal dari transaksi (semua bisa diubah di layar nota). */
function dataNota(s){
  const t = B.toko;
  return {
    no: s.no, toko: t.nama_toko, tagline: t.inv_tagline || "", billTo: s.pelanggan && s.pelanggan !== "CUSTOMER" ? toTitle(s.pelanggan) : "", hp: s.hp || "",
    tanggal: tglID(s.tgl), rows: s.items.map(i => ({ desc: toTitle(i.nama), harga: i.harga, qty: i.qty })), ongkir: s.ongkir || 0, diskon: s.diskon || 0,
    metode: { Tunai: "Cash", Transfer: "Transfer", QRIS: "QRIS" }[s.metode] || s.metode, dibayar: s.bayar < s.total ? s.bayar : null,
    bank: t.inv_bank || "", ttdNama: t.inv_ttd_nama || "", ttdJabatan: t.inv_ttd_jabatan || "", ttdImg: t.inv_ttd || "",
  };
}
const versiApi = () => { try { return Number(JSON.parse(NATIVE.info()).api) || 0; } catch { return 0; } };
/** Layar nota: isian di atas (bisa diedit), pratinjau di bawah, lalu unduh gambar / cetak A4. */
function bukaNota(s){
  const d = dataNota(s);
  const baris = () => d.rows.map((r, i) => `<div class="row nota-baris" data-i="${i}"><input type="text" data-k="desc" value="${esc(r.desc)}" placeholder="Barang / jasa" style="flex:3 1 160px"><input type="number" data-k="harga" value="${r.harga}" placeholder="Harga" inputmode="numeric" style="flex:1 1 90px"><input type="number" data-k="qty" value="${r.qty}" placeholder="Qty" inputmode="decimal" style="flex:0 1 64px"><button type="button" class="btn ghost sm" data-hapus="${i}" aria-label="Hapus baris">✕</button></div>`).join("");
  modal(`<h3>📄 Nota ${esc(s.no)}</h3>
    <div class="nota-edit stack">
      <div class="row"><label class="f grow">Bill To (kepada)<input type="text" id="nBill" value="${esc(d.billTo)}"></label><label class="f grow">No HP<input type="tel" id="nHp" value="${esc(d.hp)}"></label></div>
      <div class="row"><label class="f grow">Tanggal<input type="text" id="nTgl" value="${esc(d.tanggal)}"></label><label class="f grow">No. nota<input type="text" id="nNo" value="${esc(d.no)}"></label></div>
      <div class="small muted">Barang (Deskripsi · Harga · Qty)</div>
      <div id="nRows" class="stack" style="gap:6px">${baris()}</div>
      <button type="button" class="btn sm" id="nTambah">+ Tambah baris</button>
      <div class="row"><label class="f grow">Ongkir<input type="number" id="nOng" value="${d.ongkir || ""}" inputmode="numeric"></label><label class="f grow">Diskon<input type="number" id="nDisc" value="${d.diskon || ""}" inputmode="numeric"></label><label class="f grow">Payment method<input type="text" id="nMet" value="${esc(d.metode)}"></label></div>
      <label class="f">Info rekening<textarea id="nBank" rows="2">${esc(d.bank)}</textarea></label>
      <div class="row"><label class="f grow">Penanda tangan<input type="text" id="nTtdN" value="${esc(d.ttdNama)}"></label><label class="f grow">Jabatan<input type="text" id="nTtdJ" value="${esc(d.ttdJabatan)}"></label></div>
      ${d.ttdImg ? "" : `<p class="small muted" style="margin:0">Tanda tangan elektronik belum dibuat — nama ditulis miring. Buat tanda tangan di Pengaturan → Nota / Invoice.</p>`}
    </div>
    <div class="nota-pratinjau"><canvas id="nCv"></canvas></div>
    <div class="actions" style="flex-wrap:wrap"><button class="btn" data-close>Tutup</button><button class="btn" id="nUnduh" type="button">Unduh gambar</button><button class="btn" id="nPdf" type="button">Unduh PDF</button><button class="btn pri" id="nCetak" type="button">Cetak nota</button></div>`, m => {
    m.closest(".modal")?.classList.add("modal-lebar");
    let kanvas = null, t;
    const baca = () => {
      d.billTo = $("#nBill", m).value; d.hp = $("#nHp", m).value; d.tanggal = $("#nTgl", m).value; d.no = $("#nNo", m).value;
      d.ongkir = num($("#nOng", m).value); d.diskon = num($("#nDisc", m).value); d.metode = $("#nMet", m).value; d.bank = $("#nBank", m).value;
      d.ttdNama = $("#nTtdN", m).value; d.ttdJabatan = $("#nTtdJ", m).value;
      $$(".nota-baris", m).forEach(r => { const x = d.rows[+r.dataset.i]; if (!x) return; x.desc = $('[data-k="desc"]', r).value; x.harga = num($('[data-k="harga"]', r).value); x.qty = $('[data-k="qty"]', r).value; });
    };
    const gambar = async () => {
      baca(); kanvas = await gambarNota(d);
      const cv = $("#nCv", m); if (!cv) return;
      cv.width = kanvas.width; cv.height = kanvas.height; cv.getContext("2d").drawImage(kanvas, 0, 0);
    };
    const nanti = () => { clearTimeout(t); t = setTimeout(gambar, 250); };
    const pasangBaris = () => {
      $$(".nota-baris input", m).forEach(i => i.oninput = nanti);
      $$("[data-hapus]", m).forEach(b => b.onclick = () => { baca(); d.rows.splice(+b.dataset.hapus, 1); $("#nRows", m).innerHTML = baris(); pasangBaris(); gambar(); });
    };
    $$(".nota-edit > .row input, .nota-edit textarea, #nBill, #nHp", m).forEach(i => i.oninput = nanti);
    pasangBaris();
    $("#nTambah", m).onclick = () => { baca(); d.rows.push({ desc: "", harga: 0, qty: 1 }); $("#nRows", m).innerHTML = baris(); pasangBaris(); gambar(); };
    $("#nUnduh", m).onclick = async () => {
      await gambar(); const url = kanvas.toDataURL("image/png"), nama = `nota-${(d.no || "rich-gallery").replace(/[^\w-]+/g, "-")}.png`;
      if (NATIVE && NATIVE.simpanFile) { const lok = NATIVE.simpanFile(nama, "image/png", url.split(",")[1]); toast(lok ? `Tersimpan di ${lok}` : "Gagal menyimpan gambar"); return; }
      const a = document.createElement("a"); a.href = url; a.download = nama; document.body.appendChild(a); a.click(); a.remove();
    };
    $("#nPdf", m).onclick = async () => {
      await gambar();
      const [pw, ph] = ukuranNota(kanvas), nama = `nota-${(d.no || "rich-gallery").replace(/[^\w-]+/g, "-")}.pdf`;
      simpanPdf(nama, buatPdf(kanvas, pw, ph));
    };
    $("#nCetak", m).onclick = async () => {
      await gambar();
      // Setengah A4: lebar 210 mm, tinggi mengikuti isi nota (± 148 mm untuk 1 barang)
      const [pw, ph] = ukuranNota(kanvas);
      if (NATIVE && !NATIVE.cetakUkuran) return toast("Cetak nota butuh aplikasi versi terbaru (1.8.0). Sementara pakai Unduh PDF.");
      $("#page-style").textContent = `@page{size:${pw}mm ${ph}mm;margin:0}`;
      $("#print-area").innerHTML = `<img src="${kanvas.toDataURL("image/png")}" alt="" style="width:${pw}mm;height:${ph}mm;display:block">`;
      $("#print-area").classList.add("a4");
      setTimeout(() => { if (NATIVE) NATIVE.cetakUkuran(pw, ph); else cetakBrowser(); setTimeout(() => $("#print-area").classList.remove("a4"), 1500); }, 120);
    };
    gambar();
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
/** Tanda pembuat aplikasi (layar masuk, setup, dan bawah Pengaturan). */
const TAG_PEMBUAT = `<p class="tag-pembuat">Dibuat oleh <b>Yudsky Tech</b></p>`;
/** Tombol kirim form. e.submitter baru ada di Chrome 81+, WebView perangkat lama (mis. iMin) belum punya. */
const tombolKirim = e => e.submitter || e.target.querySelector('button[type="submit"]');
function tampilLogin(pesan = ""){
  B = null; $("#cartbar").hidden = true; closeModal();
  $("#root").innerHTML = `<div class="auth"><form class="card" id="fLogin" autocomplete="on">
    <div class="merek"><img src="/logo.png" alt="Rich Gallery POS" width="128" height="128"></div>
    <div class="muted">Masuk untuk mulai bekerja</div>
    <label class="f">Nama<input type="text" id="lNama" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
    <label class="f">Password / PIN<input type="password" id="lPw" name="password" autocomplete="current-password" required></label>
    <div class="err" id="lErr">${esc(pesan)}</div>
    <button class="btn pri big" type="submit">Masuk</button>
    <p class="small muted" style="margin:0">Lupa PIN? Minta admin menggantinya di Pengaturan → Pengguna.</p>
    <div id="lAbsen"></div>
    <p class="small muted" style="margin:0;text-align:center;opacity:.7">${(() => { try { const i = JSON.parse(NATIVE.info()); return `Aplikasi ${esc(i.versi || "?")} · tampilan #${esc(String(i.web || "?"))}`; } catch { return ""; } })()}</p>${TAG_PEMBUAT}</form></div>`;
  // Perangkat kasir: karyawan bisa absen tanpa masuk
  if (LOKAL) cekKiosk().then(K => { const d = $("#lAbsen"); if (!d || !K || !K.aktif) return;
    d.innerHTML = `<hr class="sep">` + panelAbsen(K, true);
    pasangJam(d);
    const bm = $("#lAbsenMasuk"); if (bm) bm.onclick = () => bukaAbsen("masuk");
    const bp = $("#lAbsenPulang"); if (bp) bp.onclick = () => bukaAbsen("pulang"); });
  $("#fLogin").onsubmit = async e => {
    e.preventDefault(); const btn = tombolKirim(e); btn.disabled = true; $("#lErr").textContent = ""; const label = btn.textContent; btn.textContent = "Memeriksa…";
    try { await api("POST", "/api/login", { nama: $("#lNama").value, password: $("#lPw").value }); await mulai(); }
    catch (err) { $("#lErr").textContent = err.message; btn.disabled = false; btn.textContent = label; }
  };
}
/** Perangkat kasir baru / habis dipasang ulang: langsung sambungkan ke server toko, semua data (barang, akun, stok) diambil dari server. */
function tampilSetupKasir(){
  $("#root").innerHTML = `<div class="auth"><form class="card" id="fKasir">
    <div class="merek"><img src="/logo.png" alt="Rich Gallery POS" width="128" height="128"></div>
    <div><b>Sambungkan perangkat kasir ini ke server toko.</b> <span class="muted">Barang, stok, akun karyawan, dan pengaturan otomatis diambil dari server. Masukkan akun <b>admin</b> yang dipakai di ${esc(SERVER_TOKO.replace("https://", ""))}.</span></div>
    <label class="f">Nama admin<input type="text" id="kNama" autocomplete="username" required maxlength="40"></label>
    <label class="f">Password admin<input type="password" id="kPw" autocomplete="current-password" required></label>
    <label class="f">Nama perangkat ini<input type="text" id="kAlat" value="iMin kasir" maxlength="40"></label>
    <div class="err" id="kErr"></div>
    <button class="btn pri big" type="submit">Sambungkan</button>
    <button class="btn ghost sm" id="kSendiri" type="button">Pakai tanpa server (buat admin baru)</button>${TAG_PEMBUAT}</form></div>`;
  $("#kSendiri").onclick = () => tampilSetup(true);
  $("#fKasir").onsubmit = async e => {
    e.preventDefault();
    const btn = tombolKirim(e); btn.disabled = true; $("#kErr").textContent = ""; const label = btn.textContent; btn.textContent = "Menghubungi server…";
    const nama = $("#kNama").value.trim(), password = $("#kPw").value;
    try {
      const st = await api("GET", "/api/status");
      // Akun admin sementara di perangkat (nama sama); password & akun lain langsung diganti dengan data server setelah tersambung.
      if (st.perluSetup) {
        const sem = { nama, password: "sementara-" + Math.random().toString(36).slice(2) + "A1" };
        try { localStorage.setItem("rg_setup_sementara", JSON.stringify(sem)); } catch {}
        await api("POST", "/api/setup", sem);
      }
      const isian = { url: SERVER_TOKO, nama, password, perangkat: $("#kAlat").value.trim() || "iMin kasir" };
      const selesai = async () => { await api("POST", "/api/cabang/sinkron").catch(() => {}); try { localStorage.removeItem("rg_setup_sementara"); } catch {} toast("Tersambung ke server toko"); await mulai(); };
      try { await api("POST", "/api/cabang/sambung", isian); }
      catch (err) {
        if (err.status !== 409 || !/belum ada di server/.test(err.message)) throw err;
        // Perangkat ini sudah punya transaksi sendiri (dibuat sebelum tersambung): tanyakan mau dikirim atau tidak.
        btn.disabled = false; btn.textContent = label;
        return modal(`<h3>Ada transaksi di perangkat ini</h3>
          <p style="margin:0">Perangkat ini punya transaksi yang belum ada di server (misalnya penjualan yang dicatat sebelum tersambung).</p>
          <div class="stack">
            <button class="btn pri big" id="kKirim" type="button">Kirim transaksi itu ke server, lalu sambungkan</button>
            <p class="small muted" style="margin:0">Disarankan. Penjualan ikut masuk laporan & stok server. Yang sudah ada di server tidak dikirim dua kali.</p>
            <button class="btn" id="kBuang" type="button">Sambungkan tanpa mengirim (transaksi di perangkat ini diabaikan)</button>
          </div>
          <div class="actions"><button class="btn" data-close>Batal</button></div>`, m => {
          $("#kKirim", m).onclick = e => coba(async () => { await api("POST", "/api/cabang/sambung", { ...isian, kirimLama: true }); closeModal(); await selesai(); }, e.target);
          $("#kBuang", m).onclick = e => konfirmasi("Abaikan transaksi di perangkat ini?", "Transaksi yang belum ada di server tidak akan masuk ke laporan server.", "Sambungkan", () => coba(async () => { await api("POST", "/api/cabang/sambung", { ...isian, paksa: true }); closeModal(); await selesai(); }));
        });
      }
      await selesai();
    } catch (err) {
      $("#kErr").textContent = err.message + (err.status === 401 ? "" : " — periksa internet / DNS Pribadi (dns.google), lalu coba lagi.");
      btn.disabled = false; btn.textContent = label;
    }
  };
}
function tampilSetup(sendiri = false){
  if (LOKAL && !sendiri) return tampilSetupKasir();
  $("#root").innerHTML = `<div class="auth"><form class="card" id="fSetup">
    <div class="merek"><img src="/logo.png" alt="Rich Gallery POS" width="128" height="128"></div>
    <div><b>Selamat datang.</b> <span class="muted">Buat akun admin pertama. Akun ini memegang laporan, pengaturan, dan akun karyawan.</span></div>
    <label class="f">Nama admin<input type="text" id="sNama" autocomplete="username" required maxlength="40"></label>
    <label class="f">Password (min. 8 karakter)<input type="password" id="sPw" autocomplete="new-password" required minlength="8"></label>
    <label class="f">Ulangi password<input type="password" id="sPw2" autocomplete="new-password" required></label>
    <div class="err" id="sErr"></div>
    <button class="btn pri big" type="submit">Buat akun admin</button>${TAG_PEMBUAT}</form></div>`;
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
  pesanan: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M9 15l2 2 4-4"/>',
  absenku: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2.5h6M12 2.5V5"/>',
  absen: '<path d="M8.5 20c1-2 1.5-4.5 1.5-8a2 2 0 0 1 4 0c0 2.5-.3 4.8-1 7"/><path d="M5.5 17c.7-1.6 1-3.3 1-5a5.5 5.5 0 0 1 11 0c0 1.2-.1 2.4-.3 3.5"/><path d="M4 9.5A8.5 8.5 0 0 1 20 9"/><path d="M12 12c0 3.5-.6 6.3-2 8.5"/>',
  gaji: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/><path d="M16 3.5l-4 2.5-4-2.5"/>',
  atur: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
};
const SEMUA_VIEW = [["kasir", "Kasir"], ["absenku", "Absen"], ["pesanan", "Pesanan"], ["riwayat", "Transaksi"], ["produksi", "Produksi"], ["stok", "Stok"], ["mutasi", "Masuk/Keluar"], ["opname", "Opname"], ["biaya", "Pengeluaran", 1], ["laporan", "Laporan", 1], ["absen", "Rekap Absen", 1], ["gaji", "Gaji", 1], ["atur", "Pengaturan"]];
const daftarView = () => SEMUA_VIEW.filter(v => (!v[2] || isAdmin()) && (v[0] !== "absen" || (B && B.toko.absen_aktif))
  && (v[0] !== "absenku" || (LOKAL && kioskInfo && kioskInfo.aktif)));
let view = "kasir";
function shell(){
  $("#root").innerHTML = `<div class="app">
    <header class="topbar">
      <div class="brand"><img src="/monogram.png" alt="" width="30" height="30"><h1>${esc(toTitle(B.toko.nama_toko))}</h1><small>POS</small></div>
      <span class="sp"></span>
      ${isAdmin() ? `<span class="sync-dot" id="syncDot" title="Status sinkron Google Sheet"></span>` : ""}${LOKAL ? `<button class="sync-chip" id="syncChip" type="button" hidden></button>` : ""}
      ${LOKAL && kioskInfo && kioskInfo.boleh ? `<button class="btn sm absen-masuk" id="tbAbsen" type="button">🕘 Absen</button>` : ""}
      <span class="userchip"><b>${esc(B.me.nama)}</b><span class="pill mut">${isAdmin() ? "ADMIN" : "KARYAWAN"}</span><button class="btn ghost sm" id="keluar" type="button">Keluar</button></span>
    </header>
    <nav class="tabs" id="tabs"></nav>
    <main id="main"></main></div>`;
  const ab = $("#tbAbsen"); if (ab) ab.onclick = () => pindah("absenku");
  $("#keluar").onclick = async () => { await api("POST", "/api/logout").catch(() => {}); resetCart(); tampilLogin(); };
  if (isAdmin() || LOKAL) { cekSync(); clearInterval(window.__rgCekSync); window.__rgCekSync = setInterval(cekSync, 30_000); }
}
/** Perangkat kasir: tanda jelas bila ada transaksi yang belum terkirim / ditolak server pusat (untuk semua pengguna). */
async function cekKirimCabang(){
  const chip = $("#syncChip"); if (!chip) return;
  const c = await api("GET", "/api/cabang/ringkas").catch(() => null);
  if (!c || !c.aktif) { chip.hidden = true; return; }
  const lama = c.menunggu && c.terakhir && Date.now() - Date.parse(c.terakhir) > 10 * 60_000;
  chip.hidden = !(c.ditolak || c.menunggu);
  chip.className = "sync-chip " + (c.ditolak || lama || c.galat ? "bad" : "warn");
  chip.textContent = c.ditolak ? `⚠️ ${c.ditolak} transaksi ditolak server` : `⏳ ${c.menunggu} belum terkirim${c.galat ? " (offline)" : ""}`;
  chip.onclick = () => modal(`<h3>Sinkron ke server pusat</h3>
    <p style="margin:0">${c.menunggu ? `<b>${c.menunggu} transaksi</b> masih tersimpan di perangkat ini dan belum masuk ke server, jadi belum terlihat di laporan server dan stok server belum berkurang.` : "Semua transaksi baru sudah terkirim."}</p>
    ${c.galat ? `<p class="small" style="color:var(--bad);margin:0">Kendala: ${esc(c.galat)}</p><p class="small muted" style="margin:0">Periksa internet / WiFi perangkat ini. Transaksi aman tersimpan di perangkat dan akan terkirim otomatis begitu tersambung.</p>` : ""}
    ${c.ditolak ? `<p class="small" style="color:var(--bad);margin:0"><b>${c.ditolak} transaksi ditolak server</b>. Data tetap tersimpan di perangkat ini. ${isAdmin() ? "Tekan <b>Kirim ulang</b>, atau lihat rinciannya di Pengaturan → Server pusat." : "Minta admin menekan Kirim ulang."}</p>` : ""}
    <div class="actions"><button class="btn" data-close>Tutup</button>${c.ditolak && isAdmin() ? `<button class="btn" id="scUlang" type="button">Kirim ulang yang ditolak</button>` : ""}<button class="btn pri" id="scGo" type="button">Sinkron sekarang</button></div>`, m => {
    $("#scGo", m).onclick = e => coba(async () => { const r = await api("POST", "/api/cabang/sinkron"); closeModal(); await muatUlang(); render(); toast(r.galatTerakhir ? "Belum terkirim: " + r.galatTerakhir : r.menunggu ? `${r.menunggu} masih menunggu` : r.ditolak ? `${r.ditolak} masih ditolak` : "Semua sudah terkirim"); }, e.target);
    const u = $("#scUlang", m); if (u) u.onclick = e => coba(async () => { const r = await api("POST", "/api/cabang/kirim-ulang"); closeModal(); await muatUlang(); render(); toast(r.ditolak ? `${r.ditolak} masih ditolak: ${(r.ditolakDaftar[0] || {}).galat || ""}` : `${r.dikirimUlang} transaksi berhasil dikirim ulang`); }, e.target);
  });
}
async function cekSync(){
  cekKirimCabang().catch(() => {});
  if (!isAdmin()) return;
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
  return ({ kasir: vKasir, pesanan: vPesanan, riwayat: vRiwayat, produksi: vProduksi, stok: vStok, mutasi: vMutasi, opname: vOpname, biaya: vBiaya, laporan: vLaporan, absen: vAbsen, absenku: vAbsenku, gaji: vGaji, atur: vAtur })[view]();
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
      <div class="kasir-atas">
      <div class="row">
        <input type="search" id="posQ" placeholder="Cari nama / kode, atau scan barcode…" value="${esc(posQ)}" style="flex:1 1 220px" aria-label="Cari produk">
        <button class="btn" id="manualBtn" type="button">+ Item manual</button>
        <label class="row small muted" style="gap:6px"><input type="checkbox" id="readyOnly" ${hanyaReady ? "checked" : ""}> Stok ready saja</label>
      </div>
      <div class="chips" id="katChips">${kats.map(k => `<button type="button" class="chip ${k === posKat ? "on" : ""}" data-k="${esc(k)}">${esc(k === "SEMUA" ? "Semua" : toTitle(k))}</button>`).join("")}</div>
      </div>
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
  if (ex) ex.qty = +(ex.qty + 1).toFixed(2); else cart.items.push({ product_id: p.id, kode: p.kode, nama: p.nama, kategori: p.kategori, harga: p.harga, qty: 1, ready: p.stok > 0, readyAuto: true });
  saveCart(); drawCart(); toast(`${p.nama} ditambahkan`);
}
function itemManual(){
  modal(`<h3>Item manual</h3><p class="muted small">Untuk pesanan custom yang harganya belum ada di daftar.</p>
    <div class="stack">
      <label class="f">Nama barang<input type="text" id="mn" placeholder="Contoh: BUKET CUSTOM PINK" autocomplete="off"></label>
      <div class="row"><label class="f grow">Harga satuan<input type="number" id="mp" inputmode="numeric" min="0" step="500"></label><label class="f" style="width:100px">Qty<input type="number" id="mq" value="1" min="0.5" step="0.5" inputmode="decimal"></label></div>
      <label class="f">Kategori<select id="mk">${B.kategori.map(k => `<option ${k === "BUKET COSTUME" ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <label class="f">Dibuat oleh (masuk produksi & insentif)<select id="mpb"><option value="">— belum ditentukan —</option>${B.staf.map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join("")}</select></label>
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
          cart.items.push({ product_id: p.id, kode: p.kode, nama: p.nama, kategori, harga, qty, ready: false, pembuat_id: +$("#mpb", m).value || null });
        } else cart.items.push({ product_id: null, kode: "", nama, kategori, harga, qty, ready: false, manual: true, pembuat_id: +$("#mpb", m).value || null });
        saveCart(); closeModal(); drawGrid(); drawCart();
      }, e.target);
    });
}
/** READY / PRODUKSI otomatis mengikuti stok terbaru (mis. stok baru diisi setelah barang masuk keranjang),
 *  kecuali kasir sudah memilihnya sendiri. Produk yang stoknya ada → READY, jadi stok berkurang saat terjual. */
function segarkanReady(){
  for (const it of cart.items) {
    if (!it.product_id || it.readyAuto === false) continue;
    const p = prodBy(it.product_id); if (p) it.ready = p.stok > 0;
  }
}
function drawCart(){
  const el = $("#cart"); if (!el) return;
  segarkanReady();
  const sub = cartSub(), tot = cartTotal(), qty = cart.items.reduce((a, i) => a + i.qty, 0);
  $("#cbCount").textContent = `${fq(qty)} item`; $("#cbTotal").textContent = rp(tot);
  el.innerHTML = `
    <div class="cart-head"><h2 style="font-size:20px;flex:1">Keranjang <span class="muted small num" style="font-family:var(--body);font-weight:600">${fq(qty)} item</span></h2>${cart.items.length ? `<button class="btn ghost sm" id="clr" type="button">Kosongkan</button>` : ""}<button class="btn sm cart-close" id="cclose" type="button">‹ Katalog</button></div>
    <div class="cart-body">
    <div class="seg" id="cJenis" role="group" aria-label="Jenis pelanggan"><button type="button" data-j="baru" class="${cart.lama ? "" : "on"}">Pelanggan baru</button><button type="button" data-j="lama" class="${cart.lama ? "on" : ""}">Pelanggan lama</button></div>
    ${cart.lama ? `<div class="cari-pel"><input type="search" id="cCariPel" placeholder="Cari nama / no HP pelanggan…" autocomplete="off" aria-label="Cari pelanggan"><div class="list" id="cPelList"><div class="empty small">Memuat daftar pelanggan…</div></div></div>` : ""}
    <div class="row"><label class="f grow">Nama pelanggan *<input type="text" id="cCust" value="${esc(cart.pelanggan)}" placeholder="Wajib diisi" autocomplete="off" required></label><label class="f grow">No HP / WA *<input type="tel" id="cHp" value="${esc(cart.hp)}" placeholder="08… (wajib)" autocomplete="off" required></label></div>
    <div class="list saran-pel" id="cSaran" hidden></div>
    <div class="cart-lines">${cart.items.length ? cart.items.map((it, i) => `
      <div class="line" data-i="${i}">
        <div><div class="nm">${esc(it.nama)}</div><div class="code">${it.manual ? "manual" : it.kode}</div></div>
        <div class="num" style="font-weight:700">${rp(it.harga * it.qty)}</div>
        <div class="ctl">
          <span class="qty"><button type="button" data-a="-" aria-label="Kurangi">−</button><input type="number" class="qIn num" value="${it.qty}" min="0" step="0.5" inputmode="decimal" aria-label="Jumlah"><button type="button" data-a="+" aria-label="Tambah">+</button></span>
          <input type="number" class="price-in pIn num" value="${it.harga}" min="0" step="500" inputmode="numeric" aria-label="Harga satuan">
          ${it.product_id ? `<button type="button" class="pill ${it.ready ? "ok" : "mut"}" data-a="r" style="border:0;cursor:pointer" title="Ketuk untuk mengganti: ambil dari stok ready atau dibuat (produksi)">${it.ready ? "READY STOK" : "PRODUKSI · stok tetap"}</button>` : `<span class="pill mut">PRODUKSI</span>`}
          <button type="button" class="btn ghost sm" data-a="x" style="margin-left:auto">Hapus</button>
          ${!it.ready ? `<label class="pembuat-baris"><span class="small muted">Dibuat oleh</span><select class="pbIn" aria-label="Pembuat"><option value="">— pilih pembuat (insentif) —</option>${B.staf.map(u => `<option value="${u.id}" ${+it.pembuat_id === u.id ? "selected" : ""}>${esc(u.nama)}</option>`).join("")}</select></label>` : ""}
        </div>
      </div>`).join("") : `<div class="empty">Belum ada barang.<br>Ketuk produk di katalog atau scan barcode.</div>`}</div>
    <label class="row pesanan-cek"><input type="checkbox" id="cPes" ${cart.pesanan ? "checked" : ""}> <b>Pesanan</b> <span class="small muted">— diambil / diantar nanti, dengan catatan khusus</span></label>
    ${cart.pesanan ? `<div class="pesanan-isi stack">
      <div class="seg" id="cCara" role="group" aria-label="Cara"><button type="button" data-c="ambil" class="${cart.ambil_cara !== "antar" ? "on" : ""}">Diambil</button><button type="button" data-c="antar" class="${cart.ambil_cara === "antar" ? "on" : ""}">Diantar</button></div>
      <div class="row"><label class="f grow">Tanggal ${cart.ambil_cara === "antar" ? "antar" : "ambil"}<input type="date" id="cAmbilT" value="${esc(cart.ambil_tgl || "")}" min="${today()}"></label><label class="f grow">Jam<input type="time" id="cAmbilJ" value="${esc(cart.ambil_jam || "")}"></label></div>
      <label class="f">Catatan khusus / request<textarea id="cReq" rows="3" placeholder="Contoh: warna pink-putih, tulisan 'Happy Graduation Sinta', tambah coklat. ${cart.ambil_cara === "antar" ? "Alamat antar: …" : ""}">${esc(cart.request || "")}</textarea></label>
      <p class="small muted" style="margin:0">Isi <b>Dibayar</b> di bawah dengan nominal DP. Sisanya bisa dilunasi saat diambil, dari menu <b>Pesanan</b>.</p>
    </div>` : ""}
    <label class="row pesanan-cek"><input type="checkbox" id="cKartuOn" ${cart.kartuOn ? "checked" : ""}> <b>Kartu ucapan</b> <span class="small muted">— dicetak / dibuat di Canva</span></label>
    ${cart.kartuOn ? `<div class="pesanan-isi stack">
      <label class="f">Ucapan yang dicetak di kartu (sesuai permintaan pelanggan)<textarea id="cKartu" rows="4" placeholder="Happy Birthday!&#10;Semoga panjang umur dan sehat selalu.&#10;Dari: Rina">${esc(cart.kartu || "")}</textarea></label>
      ${tombolKartu("keranjang")}
      ${B.toko.canva_url ? "" : `<p class="small muted" style="margin:0">Atur link desain Canva di Pengaturan → Canva supaya tombol Buka Canva langsung ke desain kartu toko.</p>`}
    </div>` : ""}
    <div class="row"><label class="f grow">Diskon (Rp)<input type="number" id="cDisc" value="${cart.diskon || ""}" min="0" step="1000" inputmode="numeric"></label><label class="f grow">Ongkir (Rp)<input type="number" id="cOng" value="${cart.ongkir || ""}" min="0" step="1000" inputmode="numeric"></label></div>
    <div class="seg" id="cMet" role="group" aria-label="Metode bayar">${B.metode.map(m => `<button type="button" class="${cart.metode === m ? "on" : ""}" data-m="${m}">${m}</button>`).join("")}</div>
    <div class="seg" id="cMode" role="group" aria-label="Pembayaran" style="display:flex">${[["lunas", "Lunas"], ["dp50", "DP 50%"], ["dp", "DP custom"]].map(([k, l]) => `<button type="button" style="flex:1" data-p="${k}" class="${(cart.bayarMode || "lunas") === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${cart.bayarMode === "dp50" ? `<div class="note" id="dp50Info" style="margin:0">DP 50%: <b class="num">${rp(Math.round(tot / 2))}</b> · sisa <b class="num">${rp(tot - Math.round(tot / 2))}</b> dilunasi nanti (menu Pesanan / struk).</div>`
      : cart.bayarMode === "dp" ? `<label class="f">Nominal DP<input type="number" id="cBayar" value="${cart.bayar || ""}" min="0" step="1000" inputmode="numeric" placeholder="Contoh: 100000"></label>
        <div class="quickpay" id="qp">${[0.25, 0.3, 0.5, 0.75].map(f => Math.round(tot * f / 1000) * 1000).filter((v, i, a) => v > 0 && v < tot && a.indexOf(v) === i).map(v => `<button type="button" class="btn sm" data-v="${v}">${rp(v)}</button>`).join("")}</div>`
      : `<label class="f">Dibayar (kosongkan = lunas pas)<input type="number" id="cBayar" value="${cart.bayar || ""}" min="0" step="1000" inputmode="numeric" placeholder="${tot}"></label>
        <div class="quickpay" id="qp">${quickPays(tot).map(v => `<button type="button" class="btn sm" data-v="${v}">${v === tot ? "Uang pas" : rp(v)}</button>`).join("")}</div>`}
    ${isAdmin() ? `<label class="f">Tanggal transaksi<input type="date" id="cTgl" value="${cart.tgl || today()}"></label>` : ""}
    <label class="f">Catatan (ucapan kartu, jadwal ambil, dll)<textarea id="cNote" rows="2">${esc(cart.catatan)}</textarea></label>
    </div>
    <div class="cart-foot">
      <div class="tot"><span class="muted">Subtotal <span class="num">${rp(sub)}</span></span><span></span><span style="align-self:end;font-weight:700">TOTAL · ${esc(cart.metode)}</span><span class="big num" id="cTot">${rp(tot)}</span></div>
      <div class="small" id="kembali"></div>
      <div class="row" style="flex-wrap:nowrap"><button class="btn big" id="saveOnly" type="button" style="flex:1" ${cart.items.length ? "" : "disabled"} title="Simpan pembayaran tanpa mencetak struk">Bayar</button><button class="btn pri big" id="savePrint" type="button" style="flex:2" ${cart.items.length ? "" : "disabled"}>Bayar &amp; Cetak</button></div>
      ${saleTerakhir ? `<button class="btn ghost sm" id="reprint" type="button" style="align-self:center">Cetak ulang struk terakhir (${esc(saleTerakhir.no)})</button>` : ""}
    </div>`;
  const upd = () => { saveCart(); const t = cartTotal(); $("#cTot").textContent = rp(t); $("#cbTotal").textContent = rp(t); hitKembali(); };
  $("#cCust", el).oninput = e => { cart.pelanggan = e.target.value; saveCart(); saranPelanggan(el, e.target.value, "nama"); };
  $("#cCust", el).onfocus = () => ambilPelanggan().catch(() => {});
  $$("#cJenis button", el).forEach(b => b.onclick = () => { cart.lama = b.dataset.j === "lama"; saveCart(); const sc = $(".cart-body", el).scrollTop; drawCart(); $(".cart-body", el).scrollTop = sc; if (cart.lama) $("#cCariPel")?.focus(); });
  if (cart.lama) pasangCariPelanggan(el);
  $("#cHp", el).oninput = e => { cart.hp = e.target.value; saveCart(); saranPelanggan(el, e.target.value, "hp"); };
  $("#cHp", el).onfocus = () => ambilPelanggan().catch(() => {});
  [$("#cCust", el), $("#cHp", el)].forEach(i => i.addEventListener("blur", () => setTimeout(() => { const s = $("#cSaran", el); if (s && !s.contains(document.activeElement)) s.hidden = true; }, 200)));
  $("#cDisc", el).oninput = e => { cart.diskon = num(e.target.value); upd(); };
  const gambarUlang = () => { const sc = $(".cart-body", el).scrollTop; drawCart(); $(".cart-body", el).scrollTop = sc; };
  $("#cPes", el).onchange = e => { cart.pesanan = e.target.checked; if (cart.pesanan && !cart.ambil_tgl) cart.ambil_tgl = today(); saveCart(); gambarUlang(); };
  $("#cKartuOn", el).onchange = e => { cart.kartuOn = e.target.checked; saveCart(); gambarUlang(); if (cart.kartuOn) $("#cKartu")?.focus(); };
  if (cart.kartuOn) { $("#cKartu", el).oninput = e => { cart.kartu = e.target.value; saveCart(); }; pasangTombolKartu(el, () => $("#cKartu", el).value); }
  if (cart.pesanan) {
    $$("#cCara button", el).forEach(b => b.onclick = () => { cart.ambil_cara = b.dataset.c; saveCart(); gambarUlang(); });
    $("#cAmbilT", el).onchange = e => { cart.ambil_tgl = e.target.value; saveCart(); };
    $("#cAmbilJ", el).onchange = e => { cart.ambil_jam = e.target.value; saveCart(); };
    $("#cReq", el).oninput = e => { cart.request = e.target.value; saveCart(); };
  }
  $("#cOng", el).oninput = e => { cart.ongkir = num(e.target.value); upd(); };
  if ($("#cBayar", el)) $("#cBayar", el).oninput = e => { cart.bayar = num(e.target.value); saveCart(); hitKembali(); };
  $$("#cMode button", el).forEach(b => b.onclick = () => { cart.bayarMode = b.dataset.p; cart.bayar = 0; saveCart(); const sc = $(".cart-body", el).scrollTop; drawCart(); $(".cart-body", el).scrollTop = sc; if (cart.bayarMode === "dp") $("#cBayar")?.focus(); });
  if ($("#cTgl", el)) $("#cTgl", el).onchange = e => { cart.tgl = e.target.value; saveCart(); };
  $("#cNote", el).oninput = e => { cart.catatan = e.target.value; saveCart(); };
  $$("#cMet button", el).forEach(b => b.onclick = () => { cart.metode = b.dataset.m; saveCart(); const sc = $(".cart-body", el).scrollTop; drawCart(); $(".cart-body", el).scrollTop = sc; });
  $$("#qp button", el).forEach(b => b.onclick = () => { cart.bayar = +b.dataset.v; if ($("#cBayar", el)) $("#cBayar", el).value = cart.bayar; saveCart(); hitKembali(); });
  $$(".line", el).forEach(row => {
    const i = +row.dataset.i, it = cart.items[i];
    $$("[data-a]", row).forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === "+") it.qty = +(it.qty + 1).toFixed(2);
      if (a === "-") it.qty = Math.max(0, +(it.qty - 1).toFixed(2));
      if (a === "r") { it.ready = !it.ready; it.readyAuto = false; }
      if (a === "x" || it.qty === 0) cart.items.splice(i, 1);
      saveCart(); drawCart();
    });
    $(".qIn", row).onchange = e => { it.qty = num(e.target.value); if (!it.qty) cart.items.splice(i, 1); saveCart(); drawCart(); };
    $(".pIn", row).onchange = e => { it.harga = num(e.target.value); saveCart(); drawCart(); };
    const pb = $(".pbIn", row); if (pb) pb.onchange = e => { it.pembuat_id = +e.target.value || null; saveCart(); };
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
/** Nominal yang dibayar sekarang menurut pilihan pembayaran (Lunas / DP 50% / DP custom). */
function nilaiBayar(){
  const t = cartTotal();
  if (cart.bayarMode === "dp50") return Math.round(t / 2);
  if (cart.bayarMode === "dp") return cart.bayar || 0;
  return cart.bayar || t;
}
function hitKembali(){
  const k = $("#kembali"); if (!k) return;
  const t = cartTotal(), b = nilaiBayar();
  const info = $("#dp50Info"); if (info) info.innerHTML = `DP 50%: <b class="num">${rp(Math.round(t / 2))}</b> · sisa <b class="num">${rp(t - Math.round(t / 2))}</b> dilunasi nanti (menu Pesanan / struk).`;
  k.innerHTML = b > t ? `Kembalian: <b class="num">${rp(b - t)}</b>` : b < t ? `<span class="pill warn">DP / belum lunas</span> Sisa <b class="num">${rp(t - b)}</b>` : "";
}
function resetCart(){ cart = cartKosong(); saveCart(); }
/* ---------- Pelanggan lama: dipilih dari riwayat transaksi ---------- */
let daftarPel = null, daftarPelWaktu = 0;
async function ambilPelanggan(paksa){
  if (!daftarPel || paksa || Date.now() - daftarPelWaktu > 60_000) { daftarPel = await api("GET", "/api/pelanggan"); daftarPelWaktu = Date.now(); }
  return daftarPel;
}
/** Saran otomatis saat mengetik nama / no HP: pelanggan yang pernah belanja. Ketuk untuk mengisi nama & no HP sekaligus. */
async function saranPelanggan(el, teks, jenis){
  const kotak = $("#cSaran", el); if (!kotak) return;
  const q = String(teks || "").trim().toUpperCase(), qd = q.replace(/\D/g, "").replace(/^62/, "0");
  if (jenis === "nama" ? q.length < 2 : qd.length < 3) { kotak.hidden = true; return; }
  try { await ambilPelanggan(); } catch { return; }
  const hpNorm = h => String(h || "").replace(/\D/g, "").replace(/^62/, "0");
  const cocok = (daftarPel || []).filter(p => jenis === "nama"
      ? p.nama.includes(q) && p.nama !== q
      : hpNorm(p.hp).includes(qd) && hpNorm(p.hp) !== qd)
    .sort((a, b) => (jenis === "nama" ? (b.nama.startsWith(q) - a.nama.startsWith(q)) : 0) || b.transaksi - a.transaksi).slice(0, 5);
  if (!cocok.length) { kotak.hidden = true; return; }
  kotak.innerHTML = cocok.map((p, i) => `<button type="button" class="li click" data-i="${i}" style="width:100%;text-align:left;border:0;background:none;font:inherit;color:inherit">
    <div class="main"><div class="t">${esc(p.nama || "TANPA NAMA")}</div><div class="small muted">${esc(p.hp || "tanpa no HP")} · ${p.transaksi}× belanja</div></div></button>`).join("");
  kotak.hidden = false;
  kotak.onmousedown = e => e.preventDefault(); // kolom ketik tetap fokus, saran tidak tertutup sebelum diketuk
  $$("button", kotak).forEach(b => b.onclick = () => {
    const p = cocok[+b.dataset.i];
    cart.pelanggan = p.nama === "CUSTOMER" ? "" : p.nama; if (p.hp) cart.hp = p.hp; saveCart();
    $("#cCust", el).value = cart.pelanggan; $("#cHp", el).value = cart.hp; kotak.hidden = true;
  });
}
function pasangCariPelanggan(el){
  const kotak = $("#cPelList", el), cari = $("#cCariPel", el);
  const gambar = () => {
    const q = cari.value.trim().toUpperCase(), qd = q.replace(/\D/g, "");
    const cocok = (daftarPel || []).filter(p => !q || p.nama.includes(q) || (qd.length >= 3 && String(p.hp).replace(/\D/g, "").replace(/^62/, "0").includes(qd.replace(/^62/, "0")))).slice(0, 8);
    kotak.innerHTML = cocok.length ? cocok.map((p, i) => `<button type="button" class="li click pel" data-i="${i}" style="width:100%;text-align:left;border:0;background:none;font:inherit;color:inherit">
        <div class="main"><div class="t">${esc(p.nama || "TANPA NAMA")}</div><div class="small muted">${esc(p.hp || "tanpa no HP")} · ${p.transaksi}× belanja · terakhir ${tglPendek(p.terakhir)}</div></div></button>`).join("")
      : `<div class="empty small">${daftarPel && daftarPel.length ? "Tidak ditemukan. Pilih \"Pelanggan baru\" untuk mengisi manual." : "Belum ada data pelanggan. Pelanggan tersimpan otomatis dari transaksi yang memakai nama atau no HP."}</div>`;
    $$(".pel", kotak).forEach(b => b.onclick = () => {
      const p = cocok[+b.dataset.i];
      cart.pelanggan = p.nama === "CUSTOMER" ? "" : p.nama; cart.hp = p.hp || ""; saveCart();
      $("#cCust", el).value = cart.pelanggan; $("#cHp", el).value = cart.hp;
      cari.value = ""; kotak.innerHTML = `<div class="empty small">✓ ${esc(p.nama)}${p.hp ? " · " + esc(p.hp) : ""} dipilih</div>`;
    });
  };
  cari.oninput = gambar;
  ambilPelanggan().then(gambar).catch(e => { kotak.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; });
}

/* ---------- Kartu ucapan: salin teks, buka Canva, cetak di printer struk ---------- */
/** Salin langsung (sinkron) — tetap dalam ketukan pengguna, jadi bisa diikuti membuka tab baru. */
function salinSinkron(teks){
  try { const t = document.createElement("textarea"); t.value = teks; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.top = "0"; t.style.opacity = "0"; document.body.appendChild(t); t.focus(); t.select(); t.setSelectionRange(0, teks.length); const ok = document.execCommand("copy"); t.remove(); return ok; } catch { return false; }
}
/** Salin teks ke papan klip (juga di WebView lama yang belum punya navigator.clipboard). */
async function salinTeks(teks, pesan = "Teks disalin"){
  let ok = salinSinkron(teks);
  if (!ok) { try { if (navigator.clipboard) { await navigator.clipboard.writeText(teks); ok = true; } } catch {} }
  toast(ok ? pesan : "Gagal menyalin. Tekan lama pada teks lalu pilih Salin.");
  return ok;
}
/* Aplikasi tujuan per perangkat (disimpan di perangkat ini): Canva → aplikasi / browser; WhatsApp → WhatsApp / WhatsApp Business. */
const PAKET = { canva: "com.canva.editor", wa: "com.whatsapp", wab: "com.whatsapp.w4b" };
const bisaPilihAplikasi = () => !!(NATIVE && NATIVE.bukaDengan);
/** Buka link. paket: nama paket Android, "browser", atau "" (pilihan Android). */
function bukaLink(url, paket = ""){
  if (bisaPilihAplikasi()) { NATIVE.bukaDengan(url, paket); return; }
  if (NATIVE) { location.href = url; return; } // aplikasi Android versi lama: dibuka di aplikasi yang biasa menangani link ini
  const w = window.open(url, "_blank", "noopener");
  if (!w) toast("Browser memblokir jendela baru. Izinkan pop-up untuk situs ini.");
}
/** Buka desain Canva: di aplikasi Canva (bila terpasang & sudah masuk) atau di browser (canva.com). */
const bukaCanva = url => bukaLink(url, D.canvaBuka === "web" ? "browser" : PAKET.canva);
/** Buka chat WhatsApp dengan pesan terisi, di aplikasi WhatsApp yang dipilih untuk perangkat ini. */
function bukaWA(no, teks){
  if (bisaPilihAplikasi() && (D.waApp === "wa" || D.waApp === "wab")) {
    return NATIVE.bukaDengan(`whatsapp://send?phone=${no}&text=${encodeURIComponent(teks || "")}`, PAKET[D.waApp]);
  }
  bukaLink(`https://wa.me/${no}${teks ? "?text=" + encodeURIComponent(teks) : ""}`);
}
/** Salin isi kartu lalu buka desain Canva: tinggal tempel (paste) teksnya. */
function keCanva(teks){
  if (!B.toko.canva_url) { if (teks) salinTeks(teks, "Teks kartu disalin"); toast("Link Canva belum diatur (Pengaturan → Canva)"); return; }
  const ok = teks ? salinSinkron(teks) : true;
  bukaCanva(B.toko.canva_url);
  if (teks) toast(ok ? "Teks kartu disalin — tempel (paste) di Canva" : "Canva dibuka. Salin teks kartu dengan tombol Salin teks.");
}
/** Cetak kartu ucapan di printer struk: teks di tengah, baris pertama besar. */
function cetakKartu(teks){
  const w = lebar(), L = [{ t: "" }];
  String(teks || "").split("\n").forEach((baris, i) => {
    if (!baris.trim()) { L.push({ t: "" }); return; }
    if (i === 0 && baris.length <= Math.floor(w / 2) * 2) wrap(baris, Math.floor(w / 2)).forEach(x => L.push({ t: x, besar: 1 })); // rata tengah oleh printer
    else wrap(baris, w).forEach(x => L.push({ t: center(x, w) }));
  });
  L.push({ t: "" }, { t: center("~ " + toTitle(B.toko.nama_toko) + " ~", w) });
  cetakBaris(L);
}
/** Tombol-tombol kartu ucapan (dipakai di struk & pesanan). */
const tombolKartu = id => `<div class="row" style="flex-wrap:wrap;gap:6px"><button class="btn sm" data-kartu="salin" data-id="${id}" type="button">Salin teks</button><button class="btn sm" data-kartu="canva" data-id="${id}" type="button">Buka Canva</button><button class="btn sm" data-kartu="cetak" data-id="${id}" type="button">Cetak kartu</button></div>`;
function pasangTombolKartu(akar, teks){
  $$("[data-kartu]", akar).forEach(b => b.onclick = () => {
    const t = typeof teks === "function" ? teks() : teks;
    if (!String(t || "").trim()) return toast("Isi kartu ucapan masih kosong");
    if (b.dataset.kartu === "salin") salinTeks(t, "Teks kartu disalin");
    else if (b.dataset.kartu === "canva") keCanva(t);
    else bukaKartu(t);
  });
}

/* ---------- Kartu ucapan seukuran desain Canva: teks ucapan pelanggan di atas latar desain ---------- */
const PX_MM = 12; // ± 300 dpi
/** Desain kartu bawaan toko (ikut di aplikasi, bisa offline). area = bagian kosong untuk teks [x, y, lebar, tinggi] dalam pecahan gambar. */
const LATAR_BAWAAN = { pita: { src: "/kartu/pita.jpg", nama: "Pita merah @RichGallery (120 × 90 mm)", lebar: 120, tinggi: 90, area: [0.1125, 0.3125, 0.7375, 0.4534] } };
const latarBawaan = kode => String(kode || "").startsWith("bawaan:") ? LATAR_BAWAAN[String(kode).slice(7)] || null : null;
let latarKartu = { kode: "", img: null }, fontKustom = "";
/** Aset kartu dari server (latar desain & font unggahan), disimpan di perangkat supaya cepat & bisa offline. */
async function asetKartu(jenis){
  const kode = B.toko[jenis === "font" ? "kartu_font_kode" : "kartu_latar_kode"] || "";
  if (!kode) return "";
  const kunci = "rg_kartu_" + jenis;
  try { const c = JSON.parse(localStorage.getItem(kunci) || "null"); if (c && c.kode === kode) return c.data; } catch {}
  let r; try { r = await api("GET", "/api/kartu/latar"); } catch { return ""; }
  const data = (jenis === "font" ? r.font : r.latar) || "";
  try { localStorage.setItem(kunci, JSON.stringify({ kode, data })); } catch {}
  return data;
}
async function ambilLatarKartu(){
  const kode = B.toko.kartu_latar_kode || "";
  if (!kode) return null;
  if (latarKartu.kode === kode) return latarKartu.img;
  const bw = latarBawaan(kode);
  latarKartu = { kode, img: await muatGambar(bw ? bw.src : await asetKartu("latar")) };
  return latarKartu.img;
}
/** Muat font kartu sebelum menggambar: "Grown (mirip)" ikut di aplikasi; font unggahan dari server. */
const fontDimuat = {};
async function muatFontKartu(huruf, dataKustom){
  try {
    if (!window.FontFace || !document.fonts) return;
    if (huruf === "grown" && !fontDimuat.grown) {
      const buf = await (await fetch("/fonts/gloock.ttf")).arrayBuffer();
      const f = new FontFace("RG Grown", buf); await f.load(); document.fonts.add(f); fontDimuat.grown = 1;
    }
    if (huruf === "kustom") {
      const data = dataKustom || await asetKartu("font"), kode = dataKustom ? "baru:" + data.length : B.toko.kartu_font_kode;
      if (!data || fontKustom === kode) return;
      const bin = atob(data.split(",")[1]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const f = new FontFace("RG Kustom " + kode, u8.buffer); await f.load(); document.fonts.add(f); fontKustom = kode;
    }
  } catch { /* font gagal dimuat: pakai huruf cadangan */ }
}
const HURUF_KARTU = {
  grown: '"RG Grown", Georgia, serif', script: '"Great Vibes", "Snell Roundhand", "Apple Chancery", "Segoe Script", "Brush Script MT", "Dancing Script", cursive', serif: 'Georgia, "Times New Roman", serif', sans: '"Helvetica Neue", Arial, sans-serif' };
/** Gambar kartu: ukuran sesuai pengaturan (mm), latar desain (bila ada), teks ucapan di area yang dipilih — ukuran huruf menyesuaikan panjang teks. */
async function gambarKartu(teks, o = {}){
  const t = { ...B.toko, ...o };
  const lebar = Number(t.kartu_lebar) || 100, tinggi = Number(t.kartu_tinggi) || 70;
  const W = Math.round(lebar * PX_MM), H = Math.round(tinggi * PX_MM);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  const latar = o.latarImg !== undefined ? o.latarImg : await ambilLatarKartu();
  const bw = latarBawaan(o.latarKode !== undefined ? o.latarKode : t.kartu_latar_kode);
  // Desain bawaan: digambar memenuhi kartu persis (semua hiasan tampil); gambar unggahan: dipotong menyesuaikan.
  if (latar && bw) g.drawImage(latar, 0, 0, W, H);
  else if (latar) { const s = Math.max(W / latar.width, H / latar.height); g.drawImage(latar, (W - latar.width * s) / 2, (H - latar.height * s) / 2, latar.width * s, latar.height * s); }
  // Area teks
  const m = Math.min(W, H) * 0.09;
  let ax = m, ay = m, aw = W - 2 * m, ah = H - 2 * m;
  if (t.kartu_area === "desain" && bw && latar) { [ax, ay, aw, ah] = [bw.area[0] * W, bw.area[1] * H, bw.area[2] * W, bw.area[3] * H]; } // tidak menyentuh hiasan desain
  else if (t.kartu_area === "atas") ah = H / 2 - m; else if (t.kartu_area === "bawah") { ay = H / 2; ah = H / 2 - m; }
  else if (t.kartu_area === "kiri") aw = W / 2 - m; else if (t.kartu_area === "kanan") { ax = W / 2; aw = W / 2 - m; }
  await muatFontKartu(t.kartu_huruf, o.fontData);
  const font = t.kartu_huruf === "kustom" ? `"RG Kustom ${fontKustom}", Georgia, serif` : (HURUF_KARTU[t.kartu_huruf] || HURUF_KARTU.grown), skala = t.kartu_huruf === "script" ? 1.15 : 1;
  const tebalJudul = !["grown", "kustom"].includes(t.kartu_huruf); // Grown seperti di Canva: ketebalan normal
  const paragraf = String(teks || "").replace(/\r/g, "").split("\n");
  const susun = size => {
    const out = [];
    paragraf.forEach((p, i) => {
      const sz = i === 0 && paragraf.length > 1 ? size * 1.25 : size;
      g.font = `${i === 0 && paragraf.length > 1 && tebalJudul ? "700 " : ""}${sz}px ${font}`;
      if (!p.trim()) { out.push({ t: "", sz: size * 0.6 }); return; }
      let baris = "";
      p.split(/\s+/).forEach(k => { const coba = baris ? baris + " " + k : k; if (g.measureText(coba).width > aw && baris) { out.push({ t: baris, sz, b: i === 0 && paragraf.length > 1 && tebalJudul }); baris = k; } else baris = coba; });
      out.push({ t: baris, sz, b: i === 0 && paragraf.length > 1 && tebalJudul });
    });
    return out;
  };
  let size = Math.min(ah / 3, aw / 8) * skala, L;
  for (let n = 0; n < 40; n++) {
    L = susun(size);
    const tinggiTeks = L.reduce((a, l) => a + l.sz * 1.3, 0);
    const lebarMaks = Math.max(...L.map(l => { g.font = `${l.b ? "700 " : ""}${l.sz}px ${font}`; return g.measureText(l.t).width; }));
    if (tinggiTeks <= ah && lebarMaks <= aw) break;
    size *= 0.92;
  }
  const tinggiTeks = L.reduce((a, l) => a + l.sz * 1.3, 0);
  let y = ay + (ah - tinggiTeks) / 2;
  g.fillStyle = t.kartu_warna || "#3a2a2a"; g.textAlign = "center"; g.textBaseline = "top";
  L.forEach(l => { g.font = `${l.b ? "700 " : ""}${l.sz}px ${font}`; g.fillText(l.t, ax + aw / 2, y + l.sz * 0.12); y += l.sz * 1.3; });
  return c;
}
/** Cetak kartu di printer biasa dengan ukuran kertas = ukuran kartu. */
const apakahIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const KERTAS_HP = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A5: [148, 210] };
const kertasHP = () => { try { const k = localStorage.getItem("rg_kertas_hp"); if (KERTAS_HP[k]) return k; } catch {} return "A4"; };
/** Buka PDF kartu (ukuran asli di kertas biasa) di penampil PDF iPhone → tombol Bagikan → Cetak. */
function bukaPdfKartuHP(kanvas, lebar, tinggi, jendela){
  const k = kertasHP(), biner = buatPdf(kanvas, lebar, tinggi, { halaman: KERTAS_HP[k] });
  const u8 = new Uint8Array(biner.length); for (let i = 0; i < biner.length; i++) u8[i] = biner.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u8], { type: "application/pdf" }));
  if (jendela && !jendela.closed) jendela.location.href = url; else location.href = url;
  toast(`Pilih kertas ${k} saat mencetak. Kartu tercetak ${lebar} × ${tinggi} mm, gunting di garis potong.`);
}
async function cetakKartuKertas(teks, jendela){
  const lebar = Number(B.toko.kartu_lebar) || 100, tinggi = Number(B.toko.kartu_tinggi) || 70;
  const c = await gambarKartu(teks);
  if (NATIVE && versiApi() < 6) return toast("Cetak kartu butuh aplikasi versi terbaru. Sementara pakai Unduh gambar.");
  // iPhone/iPad tidak bisa memakai ukuran kertas bebas & mengecilkan halaman web saat dicetak:
  // cetak lewat PDF seukuran kertas biasa, kartu tetap 100% ukuran asli + garis potong.
  if (!NATIVE && apakahIOS()) return bukaPdfKartuHP(c, lebar, tinggi, jendela);
  $("#page-style").textContent = `@page{size:${lebar}mm ${tinggi}mm;margin:0}`;
  $("#print-area").innerHTML = `<img src="${c.toDataURL("image/png")}" alt="" style="width:${lebar}mm;height:${tinggi}mm;display:block">`;
  $("#print-area").classList.add("a4");
  setTimeout(() => {
    if (NATIVE && NATIVE.cetakUkuran) NATIVE.cetakUkuran(lebar, tinggi);
    else if (NATIVE) { NATIVE.cetak(210); toast("Kartu dicetak seukuran aslinya di kertas A4 — gunting sesuai tepi. Pasang aplikasi terbaru untuk cetak langsung di kertas kartu."); }
    else cetakBrowser();
    setTimeout(() => $("#print-area").classList.remove("a4"), 1500);
  }, 120);
}
/** Pratinjau kartu ucapan: teks dari pelanggan, bisa diedit, lalu cetak / unduh. */
function bukaKartu(teks){
  const lebar = Number(B.toko.kartu_lebar) || 100, tinggi = Number(B.toko.kartu_tinggi) || 70;
  modal(`<h3>💌 Kartu ucapan <span class="small muted">${lebar} × ${tinggi} mm</span></h3>
    <label class="f">Teks ucapan (sesuai permintaan pelanggan)<textarea id="kTeks" rows="4">${esc(teks)}</textarea></label>
    <div class="kartu-pratinjau"><canvas id="kCv"></canvas></div>
    ${!NATIVE && apakahIOS() ? `<label class="f">Kertas di printer (cetak dari iPhone)<select id="kKertas">${Object.keys(KERTAS_HP).map(k => `<option ${k === kertasHP() ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <p class="small muted" style="margin:0">iPhone tidak bisa memilih ukuran kertas bebas. Kartu dicetak di kertas biasa dengan ukuran asli ${lebar} × ${tinggi} mm dan garis potong.</p>` : ""}
    <div class="actions" style="flex-wrap:wrap"><button class="btn" data-close>Tutup</button><button class="btn" id="kStruk" type="button">Cetak di printer struk</button><button class="btn" id="kUnduh" type="button">Unduh gambar</button><button class="btn" id="kPdf" type="button">PDF polos</button><button class="btn pri" id="kCetak" type="button">Cetak kartu</button></div>`, m => {
    let t;
    const gambar = async () => { const c = await gambarKartu($("#kTeks", m).value), cv = $("#kCv", m); if (!cv) return; cv.width = c.width; cv.height = c.height; cv.getContext("2d").drawImage(c, 0, 0); return c; };
    $("#kTeks", m).oninput = () => { clearTimeout(t); t = setTimeout(gambar, 250); };
    // iPhone: jendela PDF dibuka langsung saat tombol ditekan (kalau menunggu, Safari memblokirnya).
    $("#kCetak", m).onclick = () => cetakKartuKertas($("#kTeks", m).value, !NATIVE && apakahIOS() ? window.open("", "_blank") : null);
    const kh = $("#kKertas", m); if (kh) kh.onchange = () => { try { localStorage.setItem("rg_kertas_hp", kh.value); } catch {} };
    $("#kPdf", m).onclick = async () => { const c = await gambar(); simpanPdf(`kartu-ucapan-${Date.now()}.pdf`, buatPdf(c, lebar, tinggi)); };
    $("#kStruk", m).onclick = () => cetakKartu($("#kTeks", m).value);
    $("#kUnduh", m).onclick = async () => {
      const c = await gambar(), url = c.toDataURL("image/png"), nama = `kartu-ucapan-${Date.now()}.png`;
      if (NATIVE && NATIVE.simpanFile) { const lok = NATIVE.simpanFile(nama, "image/png", url.split(",")[1]); toast(lok ? `Tersimpan di ${lok}` : "Gagal menyimpan"); return; }
      const a = document.createElement("a"); a.href = url; a.download = nama; document.body.appendChild(a); a.click(); a.remove();
    };
    gambar();
  });
}

/* Semua tautan wa.me (tombol Kirim WA, WA pengingat, dll.) dibuka di aplikasi WhatsApp pilihan perangkat ini. */
document.addEventListener("click", e => {
  const a = e.target && e.target.closest && e.target.closest('a[href^="https://wa.me/"]');
  if (!a || !bisaPilihAplikasi()) return;
  e.preventDefault();
  const u = new URL(a.href); bukaWA(u.pathname.slice(1), u.searchParams.get("text") || "");
}, true);

/* ---------- Pesan WhatsApp ke pelanggan ---------- */
/** Tanggal lengkap dengan hari, mis. "Senin, 20 Oktober 2026". */
const tglHari = iso => { try { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); } catch { return tglID(iso); } };
/** Keterangan pemesanan untuk pesan WA: DP, sisa, jadwal ambil/antar, request, catatan, ucapan kartu (hanya yang ada isinya). */
function detailPesananWA(s){
  const L = [], sisa = Math.max(0, (s.total || 0) - (s.bayar || 0));
  if (sisa > 0) { L.push(`DP (${s.metode}): ${rp(s.bayar || 0)}`); L.push(`Sisa pembayaran: *${rp(sisa)}*`); }
  else L.push(`Pembayaran: Lunas (${s.metode}) ✅`);
  if (s.ambil_tgl) L.push(`${s.ambil_cara === "antar" ? "Diantar" : "Diambil"}: ${tglHari(s.ambil_tgl)}${s.ambil_jam ? " jam " + s.ambil_jam : ""}`);
  if (s.request) L.push(`Request: ${s.request}`);
  if (s.catatan) L.push(`Catatan: ${s.catatan}`);
  if (s.kartu) L.push(`Ucapan kartu:\n"${s.kartu}"`);
  return L.join("\n");
}
/** Isi pesan dari templat di Pengaturan. Kode: {nama} {toko} {no} {tanggal} {total} {barang} {struk} {wa_toko}
 *  {pesanan} (blok keterangan lengkap) {dp} {sisa} {ambil} {request} {catatan} {ucapan} */
function pesanWA(s){
  const tpl = (B.toko.wa_template || "").trim();
  if (!tpl) return "```\n" + strukText(s) + "\n```";
  const nama = s.pelanggan && s.pelanggan !== "CUSTOMER" ? toTitle(s.pelanggan) : "Kak";
  const sisa = Math.max(0, (s.total || 0) - (s.bayar || 0));
  const isi = { nama, toko: toTitle(B.toko.nama_toko), no: s.no, tanggal: tglID(s.tgl), total: rp(s.total),
    wa_toko: B.toko.wa_nomor || B.toko.telp || "", barang: s.items.map(i => toTitle(i.nama) + (i.qty != 1 ? " ×" + fq(i.qty) : "")).join(", "), struk: "```\n" + strukText(s) + "\n```",
    pesanan: detailPesananWA(s), dp: rp(Math.min(s.bayar || 0, s.total || 0)), sisa: rp(sisa),
    ambil: s.ambil_tgl ? `${s.ambil_cara === "antar" ? "diantar" : "diambil"} ${tglHari(s.ambil_tgl)}${s.ambil_jam ? " jam " + s.ambil_jam : ""}` : "-",
    request: s.request || "-", catatan: s.catatan || "-", ucapan: s.kartu || "-" };
  let teks = tpl.replace(/\{(nama|toko|no|tanggal|total|barang|struk|wa_toko|pesanan|dp|sisa|ambil|request|catatan|ucapan)\}/g, (_, k) => isi[k]);
  // Templat lama tanpa kode keterangan: keterangan pemesanan tetap ditambahkan otomatis.
  if (!/\{(pesanan|struk)\}/.test(tpl) && !/\{(dp|sisa|ambil)\}/.test(tpl)) teks += "\n\n📋 *Keterangan pesanan*\n" + isi.pesanan;
  return teks;
}
function nomorWA(hp){ let d = String(hp || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "62" + d.slice(1); else if (d.startsWith("8")) d = "62" + d; return d.length >= 10 ? d : ""; }
/** Buka WhatsApp dengan pesan terisi (tinggal tekan kirim). Di aplikasi Android langsung membuka WhatsApp. */
function kirimWA(s){
  const no = nomorWA(s.hp);
  if (!no) return false;
  bukaWA(no, pesanWA(s));
  return true;
}

/* Ikon aksi cetak/kirim: bentuk & warna berbeda supaya tidak tertukar. */
const IKON_AKSI = {
  struk: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h4"/>',
  nota: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M15 17l1.5 1.5L19 16"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/>',
  kartu: '<path d="M12 20s-7-4.4-7-9.6A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.4C19 15.6 12 20 12 20z"/>',
  wa: '<path d="M4 20l1.3-3.8A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.3-1.8-1-1 .8a4 4 0 0 1-2.4-2.4l.8-1-1-1.8z"/>',
  lihat: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  koreksi: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  hapus: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  batal: '<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7"/>',
  cetak: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
};
const ikon = (k, ukuran = 20) => `<svg viewBox="0 0 24 24" width="${ukuran}" height="${ukuran}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IKON_AKSI[k]}</svg>`;

/** Setelah Bayar & Cetak: pilih cara mencetak (tidak langsung membuka dialog print). */
function pilihCetak(s){
  const mode = { langsung: "printer bawaan iMin", rawbt: "aplikasi RawBT", chrome: NATIVE ? "layanan cetak Android" : "printer komputer" }[D.modeCetak] || (NATIVE ? "layanan cetak Android" : "printer komputer");
  const opsi = [
    ["struk", "🧾", "Struk kasir", `Kertas ${D.kertas == 80 ? "80" : "58"} mm lewat ${mode}`],
    ["nota", "📄", "Nota (setengah A4)", "Invoice berlogo & tanda tangan, bisa diedit dulu"],
    ["pdf", "📥", "PDF struk", "Simpan / kirim sebagai file, ukuran kertas termal"],
    ...(s.kartu ? [["kartu", "💌", "Kartu ucapan", "Ucapan dari pelanggan, seukuran desain Canva"]] : []),
    ...(nomorWA(s.hp) ? [["wa", "💬", "Kirim ke WhatsApp", `Struk / ucapan ke ${s.hp}`]] : []),
    ["lihat", "👁️", "Lihat struk dulu", "Pratinjau, lalu pilih tindakan"],
  ];
  modal(`<h3>✅ Tersimpan: ${esc(s.no)}</h3>
    <p class="small muted" style="margin:0 0 8px">Total ${rp(s.total)}${s.bayar > s.total && s.metode === "Tunai" ? ` · Kembali <b>${rp(s.bayar - s.total)}</b>` : s.bayar < s.total ? ` · Sisa <b>${rp(s.total - s.bayar)}</b>` : ""}. Mau dicetak dengan cara apa?</p>
    <div class="pilih-cetak">${opsi.map(([k, , judul, ket]) => `<button type="button" class="opsi-cetak w-${k}" data-c="${k}"><span class="ik">${ikon(k, 26)}</span><span><b>${judul}</b><small>${esc(ket)}</small></span></button>`).join("")}</div>
    <div class="actions"><button class="btn" data-close>Lewati (tidak dicetak)</button></div>`, m => {
    $$(".opsi-cetak", m).forEach(b => b.onclick = () => {
      const c = b.dataset.c;
      if (c === "struk") { closeModal(); cetak(s); }
      else if (c === "nota") bukaNota(s);
      else if (c === "pdf") pdfStruk(s);
      else if (c === "kartu") bukaKartu(s.kartu);
      else if (c === "wa") kirimWA(s);
      else lihatStruk(s);
    });
  });
}
async function simpanTransaksi(print, tombol){
  if (!cart.items.length) return;
  segarkanReady();
  const wajib = (id, pesan) => { toast(pesan); const el = $("#" + id); if (el) { el.focus(); el.classList.add("salah"); setTimeout(() => el.classList.remove("salah"), 2500); } };
  if (!String(cart.pelanggan || "").trim() || String(cart.pelanggan).trim().toUpperCase() === "CUSTOMER") return wajib("cCust", "Isi nama pelanggan dulu");
  const digitHp = String(cart.hp || "").replace(/\D/g, "").length;
  if (digitHp < 9 || digitHp > 15 || !/^\+?[\d\s-]+$/.test(String(cart.hp).trim())) return wajib("cHp", "Isi nomor HP pelanggan yang benar (contoh 0812xxxxxxx)");
  if (cart.bayarMode === "dp" && !(cart.bayar > 0)) return toast("Isi nominal DP dulu");
  if (cart.bayarMode === "dp" && cart.bayar >= cartTotal()) return toast("Nominal DP sama atau lebih dari total. Pilih Lunas bila dibayar penuh.");
  await coba(async () => {
    const s = await api("POST", "/api/penjualan", {
      tgl: isAdmin() ? (cart.tgl || today()) : undefined, pelanggan: cart.pelanggan, hp: cart.hp, metode: cart.metode,
      bayar: cart.bayarMode === "dp50" || cart.bayarMode === "dp" ? nilaiBayar() : (cart.bayar || undefined), diskon: cart.diskon || 0, ongkir: cart.ongkir || 0, catatan: cart.catatan,
      kartu: cart.kartuOn ? (cart.kartu || "") : "",
      pesanan: cart.pesanan ? { tgl: cart.ambil_tgl || today(), jam: cart.ambil_jam || "", cara: cart.ambil_cara || "ambil", request: cart.request || "" } : undefined,
      items: cart.items.map(i => ({ product_id: i.product_id, nama: i.nama, kategori: i.kategori, harga: i.harga, qty: i.qty, ready: i.ready, pembuat_id: !i.ready && i.pembuat_id ? i.pembuat_id : undefined })),
    });
    saleTerakhir = s; resetCart(); daftarPel = null;
    $("#cart")?.classList.remove("open");
    toast(`Tersimpan: ${s.no}`);
    await muatUlang(); drawGrid(); drawCart();
    if (print) setTimeout(() => pilihCetak(s), 200);
    // Ucapan terima kasih otomatis lewat WhatsApp (bila diaktifkan & ada no HP)
    // Bayar & Cetak: WhatsApp hanya jadi salah satu pilihan (tidak dibuka otomatis).
    if (!print && B.toko.wa_otomatis && nomorWA(s.hp)) setTimeout(() => kirimWA(s), 300);
    setTimeout(cekSync, 3000);
  }, tombol);
}

/* ================= TRANSAKSI ================= */
let rDari = "", rSampai = "", rQ = "", rData = [];
async function vRiwayat(){
  if (!rDari) rDari = rSampai = today();
  if (!isAdmin()) rDari = rSampai = today();
  $("#main").innerHTML = `
    <div class="view-head"><h2>Transaksi</h2><span class="sp"></span>
      ${isAdmin() ? `<input type="date" id="rD" value="${rDari}" style="width:auto" aria-label="Dari"><span class="muted">s/d</span><input type="date" id="rS" value="${rSampai}" style="width:auto" aria-label="Sampai"><button class="btn sm" id="rHari" type="button">Hari ini</button><button class="btn sm" id="rPel" type="button">Data pelanggan</button>` : `<span class="muted small">Hari ini, ${tglID(today())}</span>`}</div>
    <input type="search" id="rQ" placeholder="Cari no invoice, pelanggan, atau barang…" value="${esc(rQ)}" style="margin-bottom:12px">
    <div id="rSum" class="kpis" style="margin-bottom:12px"></div>
    <div id="rList"><div class="empty">Memuat…</div></div>
    ${isAdmin() ? `<div class="row" style="margin-top:16px"><span class="sp" style="flex:1"></span><button class="btn ghost sm danger-teks" id="rHapusSemua" type="button">Hapus semua transaksi di tanggal ini…</button></div>` : ""}`;
  if (isAdmin()) {
    $("#rD").onchange = e => { rDari = e.target.value; if (rSampai < rDari) rSampai = rDari; vRiwayat(); };
    $("#rS").onchange = e => { rSampai = e.target.value; if (rSampai < rDari) rDari = rSampai; vRiwayat(); };
    $("#rHari").onclick = () => { rDari = rSampai = today(); vRiwayat(); };
  }
  let t; $("#rQ").oninput = e => { rQ = e.target.value; clearTimeout(t); t = setTimeout(muatRiwayat, 300); };
  const hs = $("#rHapusSemua"); if (hs) hs.onclick = hapusRentang;
  const rp_ = $("#rPel"); if (rp_) rp_.onclick = dataPelanggan;
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

/** Data pelanggan (admin): dari seluruh riwayat transaksi. */
async function dataPelanggan(){
  const semua = await coba(() => api("GET", "/api/pelanggan?semua=1")); if (!semua) return;
  modal(`<h3>Data pelanggan <span class="muted small">${semua.length} orang</span></h3>
    <input type="search" id="dpQ" placeholder="Cari nama / no HP…" autocomplete="off">
    <div class="list" id="dpList" style="max-height:55vh;overflow:auto"></div>
    <p class="small muted" style="margin:0">Pelanggan tersimpan otomatis dari transaksi yang diberi nama atau no HP${LOKAL && B.cabang ? " (di perangkat ini: transaksi 40 hari terakhir dari server + transaksi perangkat ini)" : ""}.</p>
    <div class="actions"><button class="btn" id="dpCsv" type="button">Unduh CSV</button><button class="btn" data-close>Tutup</button></div>`, m => {
    const gambar = () => {
      const q = $("#dpQ", m).value.trim().toUpperCase(), qd = q.replace(/\D/g, "");
      const c = semua.filter(p => !q || p.nama.includes(q) || (qd.length >= 3 && String(p.hp).replace(/\D/g, "").includes(qd))).slice(0, 300);
      $("#dpList", m).innerHTML = c.length ? c.map(p => `<div class="li"><div class="main"><div class="t">${esc(p.nama || "TANPA NAMA")}</div><div class="small muted">${esc(p.hp || "tanpa no HP")} · ${p.transaksi}× · terakhir ${tglPendek(p.terakhir)}</div></div>
        <div style="text-align:right"><div class="num" style="font-weight:700">${rp(p.total || 0)}</div>${nomorWA(p.hp) ? `<a class="btn sm" href="https://wa.me/${nomorWA(p.hp)}" target="_blank" rel="noopener">WA</a>` : ""}</div></div>`).join("") : `<div class="empty">Tidak ada.</div>`;
    };
    $("#dpQ", m).oninput = gambar; gambar();
    $("#dpCsv", m).onclick = () => unduhCSV(`pelanggan-${today()}.csv`, [["Nama", "No HP", "Jumlah belanja", "Total belanja", "Terakhir"], ...semua.map(p => [p.nama, p.hp, p.transaksi, p.total || 0, p.terakhir])]);
  });
}

/** Bersihkan data uji coba: hapus semua transaksi pada rentang tanggal yang sedang dilihat. */
async function hapusRentang(){
  const semua = await coba(() => api("GET", `/api/penjualan?dari=${rDari}&sampai=${rSampai}`));
  if (!semua) return;
  if (!semua.length) return toast("Tidak ada transaksi pada tanggal ini");
  const aktif = semua.filter(x => !x.batal_at), total = aktif.reduce((a, x) => a + x.total, 0);
  const rentang = tglID(rDari) + (rDari !== rSampai ? " – " + tglID(rSampai) : "");
  modal(`<h3>Hapus semua transaksi?</h3>
    <p><b>${semua.length} transaksi</b> pada ${esc(rentang)} (omzet ${rp(total)}) akan dihapus sepenuhnya dari daftar &amp; laporan. Stok produk READY dikembalikan. Cocok untuk membersihkan data uji coba.</p>
    <p class="small muted" style="margin:0">Tidak bisa dibatalkan. Simpan cadangan dulu bila ragu (Pengaturan → Cadangan).</p>
    <label class="f"><span>Ketik <b>HAPUS</b> untuk konfirmasi</span><input type="text" id="hk" autocomplete="off" autocapitalize="characters"></label>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn danger" id="hok" type="button" disabled>Hapus ${semua.length} transaksi</button></div>`, m => {
    $("#hk", m).oninput = e => { $("#hok", m).disabled = e.target.value.trim().toUpperCase() !== "HAPUS"; };
    $("#hok", m).onclick = e => coba(async () => {
      const r = await api("POST", "/api/penjualan/hapus-rentang", { dari: rDari, sampai: rSampai, konfirmasi: $("#hk", m).value });
      closeModal(); toast(`${r.jumlah} transaksi dihapus`); await muatUlang(); render();
    }, e.target);
  });
}

/* ================= PESANAN (diambil / diantar nanti) ================= */
let psStatus = "aktif";
const besok = () => { const d = new Date(today() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
function labelAmbil(s){
  const t = today(), b = besok();
  if (s.ambil_tgl < t) return { teks: "Terlambat " + tglPendek(s.ambil_tgl), kelas: "bad" };
  if (s.ambil_tgl === t) return { teks: "Hari ini", kelas: "warn" };
  if (s.ambil_tgl === b) return { teks: "Besok", kelas: "ok" };
  return { teks: tglID(s.ambil_tgl), kelas: "mut" };
}
async function vPesanan(){
  $("#main").innerHTML = `
    <div class="view-head"><h2>Pesanan</h2><span class="sp"></span>
      <div class="seg" id="psS"><button type="button" data-s="aktif" class="${psStatus === "aktif" ? "on" : ""}">Belum diambil</button><button type="button" data-s="selesai" class="${psStatus === "selesai" ? "on" : ""}">Selesai</button></div></div>
    <div id="psList"><div class="empty">Memuat…</div></div>`;
  $$("#psS button").forEach(b => b.onclick = () => { psStatus = b.dataset.s; vPesanan(); });
  const L = await coba(() => api("GET", `/api/pesanan?status=${psStatus}`)); if (!L || view !== "pesanan") return;
  const sisaTotal = L.reduce((a, s) => a + Math.max(0, s.total - s.bayar), 0);
  $("#psList").innerHTML = (psStatus === "aktif" && L.length ? `<div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="l">Pesanan aktif</div><div class="v num">${L.length}</div></div><div class="kpi"><div class="l">Hari ini / terlambat</div><div class="v num">${L.filter(s => s.ambil_tgl <= today()).length}</div></div><div class="kpi"><div class="l">Sisa belum dibayar</div><div class="v num">${rp(sisaTotal)}</div></div></div>` : "")
    + (L.length ? `<div class="list">${L.map(s => { const lb = labelAmbil(s), sisa = Math.max(0, s.total - s.bayar); return `<div class="li click" data-id="${s.id}">
      <div class="main"><div class="t">${esc(s.pelanggan)} <span class="code">${esc(s.no)}</span></div>
        <div class="small muted">${s.ambil_cara === "antar" ? "Diantar" : "Diambil"} ${tglPendek(s.ambil_tgl)}${s.ambil_jam ? " " + s.ambil_jam : ""} · ${s.items.map(i => esc(i.nama) + (i.qty != 1 ? " ×" + fq(i.qty) : "")).join(", ")}</div>
        ${s.request ? `<div class="small" style="margin-top:2px">📝 ${esc(s.request.length > 120 ? s.request.slice(0, 120) + "…" : s.request)}</div>` : ""}</div>
      <div style="text-align:right"><div class="num" style="font-weight:700">${rp(s.total)}</div>
        ${psStatus === "aktif" ? `<span class="pill ${lb.kelas}">${esc(lb.teks)}</span><div class="small ${sisa ? "" : "muted"}" style="margin-top:4px">${sisa ? `DP ${rp(s.bayar)} · <b style="color:var(--warn)">sisa ${rp(sisa)}</b>` : "Lunas"}</div>` : `<span class="pill ok">Selesai</span><div class="small muted">${esc(s.diambil_at || "")}</div>`}</div></div>`; }).join("")}</div>`
      : `<div class="list"><div class="empty">${psStatus === "aktif" ? "Tidak ada pesanan yang menunggu. Buat pesanan dari Kasir: centang <b>Pesanan</b> di keranjang." : "Belum ada pesanan selesai."}</div></div>`);
  $$("#psList .li").forEach(r => r.onclick = () => { const s = L.find(x => x.id === +r.dataset.id); if (s) detailPesanan(s); });
}
function detailPesanan(s){
  const sisa = Math.max(0, s.total - s.bayar), lb = labelAmbil(s);
  modal(`<h3>Pesanan ${esc(s.pelanggan)}</h3>
    <div class="stack">
      <p style="margin:0"><span class="pill ${s.diambil_at ? "ok" : lb.kelas}">${s.diambil_at ? "Selesai" : esc(lb.teks)}</span> <b>${s.ambil_cara === "antar" ? "Diantar" : "Diambil"} ${esc(tglID(s.ambil_tgl))}${s.ambil_jam ? " jam " + esc(s.ambil_jam) : ""}</b></p>
      ${s.request ? `<div class="note" style="margin:0;white-space:pre-wrap">📝 ${esc(s.request)}</div>` : ""}
      ${s.kartu ? `<div class="pesanan-isi stack"><b>💌 Kartu ucapan</b><div style="white-space:pre-wrap">${esc(s.kartu)}</div>${tombolKartu(s.id)}</div>` : ""}
      <p class="small" style="margin:0">${s.items.map(i => esc(i.nama) + " ×" + fq(i.qty)).join("<br>")}</p>
      <p style="margin:0">Total <b>${rp(s.total)}</b> · Dibayar ${rp(s.bayar)} ${sisa ? `· <b style="color:var(--warn)">Sisa ${rp(sisa)}</b>` : `· <span class="pill ok">Lunas</span>`}</p>
      ${s.hp ? `<p class="small muted" style="margin:0">${esc(s.hp)}</p>` : ""}
      ${s.diambil_at ? `<p class="small muted" style="margin:0">Selesai ${esc(s.diambil_at)} oleh ${esc(s.diambil_oleh || "-")}</p>` : ""}
      ${sisa && !s.diambil_at ? `<div class="seg" id="lsM" style="display:flex">${B.metode.map(m => `<button type="button" data-m="${m}" class="${m === "Tunai" ? "on" : ""}" style="flex:1">${m}</button>`).join("")}</div>` : ""}
    </div>
    <div class="actions" style="flex-wrap:wrap">
      <button class="btn" data-close>Tutup</button>
      <button class="btn" id="psStruk" type="button">Struk</button>
      ${nomorWA(s.hp) && !s.diambil_at ? `<a class="btn" id="psWa" href="https://wa.me/${nomorWA(s.hp)}?text=${encodeURIComponent(`Halo ${toTitle(s.pelanggan)}, pesanan Anda di ${toTitle(B.toko.nama_toko)} (${s.no}) ${s.ambil_cara === "antar" ? "akan diantar" : "siap diambil"} ${tglID(s.ambil_tgl)}${s.ambil_jam ? " jam " + s.ambil_jam : ""}.${sisa ? ` Sisa pembayaran ${rp(sisa)}.` : ""} Terima kasih 🌸`)}" target="_blank" rel="noopener">WA pengingat</a>` : ""}
      ${s.diambil_at ? `<button class="btn" id="psBuka" type="button">Kembalikan ke belum diambil</button>`
        : sisa ? `<button class="btn" id="psLunas" type="button">Lunasi ${rp(sisa)}</button><button class="btn pri" id="psSelesai" type="button">Lunasi &amp; ${s.ambil_cara === "antar" ? "sudah diantar" : "sudah diambil"}</button>`
        : `<button class="btn pri" id="psSelesai" type="button">${s.ambil_cara === "antar" ? "Sudah diantar" : "Sudah diambil"}</button>`}
    </div>`, m => {
    let metode = "Tunai";
    $$("#lsM button", m).forEach(b => b.onclick = () => { metode = b.dataset.m; $$("#lsM button", m).forEach(x => x.classList.toggle("on", x === b)); });
    $("#psStruk", m).onclick = () => lihatStruk(s, () => vPesanan());
    if (s.kartu) pasangTombolKartu(m, s.kartu);
    const lunasi = () => api("POST", `/api/penjualan/${s.id}/lunasi`, { metode });
    const ls = $("#psLunas", m); if (ls) ls.onclick = e => coba(async () => { await lunasi(); closeModal(); toast(`Lunas (${metode})`); vPesanan(); }, e.target);
    const sl = $("#psSelesai", m); if (sl) sl.onclick = e => coba(async () => { if (sisa) await lunasi(); await api("POST", `/api/penjualan/${s.id}/diambil`, {}); closeModal(); toast("Pesanan selesai"); vPesanan(); }, e.target);
    const bk = $("#psBuka", m); if (bk) bk.onclick = e => coba(async () => { await api("POST", `/api/penjualan/${s.id}/diambil`, { batal: true }); closeModal(); vPesanan(); }, e.target);
  });
}
/** Pengingat saat aplikasi dibuka: pesanan terlambat, hari ini, dan besok (sekali per sesi). */
async function pengingatPesanan(){
  try { if (sessionStorage.getItem("rg_pengingat") === today()) return; } catch {}
  let L; try { L = await api("GET", "/api/pesanan?status=aktif"); } catch { return; }
  const dekat = (L || []).filter(s => s.ambil_tgl <= besok());
  try { sessionStorage.setItem("rg_pengingat", today()); } catch {}
  if (!dekat.length || $("#modalRoot .modal")) return;
  modal(`<h3>🔔 Pengingat pesanan</h3>
    <p class="small muted" style="margin:0">${dekat.length} pesanan perlu disiapkan (terlambat, hari ini, dan besok).</p>
    <div class="list" style="max-height:55vh;overflow:auto">${dekat.map(s => { const lb = labelAmbil(s), sisa = Math.max(0, s.total - s.bayar); return `<div class="li">
      <div class="main"><div class="t">${esc(s.pelanggan)} <span class="pill ${lb.kelas}">${esc(lb.teks)}${s.ambil_jam ? " " + esc(s.ambil_jam) : ""}</span></div>
        <div class="small muted">${s.ambil_cara === "antar" ? "Diantar" : "Diambil"} · ${s.items.map(i => esc(i.nama)).join(", ")}</div>
        ${s.request ? `<div class="small">📝 ${esc(s.request.length > 90 ? s.request.slice(0, 90) + "…" : s.request)}</div>` : ""}</div>
      <div style="text-align:right" class="small">${sisa ? `DP ${rp(s.bayar)}<br><b style="color:var(--warn)">sisa ${rp(sisa)}</b>` : `<span class="pill ok">Lunas</span>`}</div></div>`; }).join("")}</div>
    <div class="actions"><button class="btn" data-close>Tutup</button><button class="btn pri" id="pgBuka" type="button">Buka daftar pesanan</button></div>`, m => {
    $("#pgBuka", m).onclick = () => { closeModal(); psStatus = "aktif"; pindah("pesanan"); };
  });
}

/* ================= ABSENSI (mesin sidik jari) ================= */
let aDari = "", aSampai = "";
async function vAbsen(){
  if (!aDari) aDari = aSampai = today();
  $("#main").innerHTML = `
    <div class="view-head"><h2>Absensi</h2><span class="sp"></span>
      <input type="date" id="aD" value="${aDari}" style="width:auto" aria-label="Dari"><span class="muted">s/d</span><input type="date" id="aS" value="${aSampai}" style="width:auto" aria-label="Sampai">
      <button class="btn sm" id="aHari" type="button">Hari ini</button><button class="btn sm" id="aBulan" type="button">Bulan ini</button></div>
    <div id="aIsi"><div class="empty">Memuat…</div></div>`;
  $("#aD").onchange = e => { aDari = e.target.value; if (aSampai < aDari) aSampai = aDari; vAbsen(); };
  $("#aS").onchange = e => { aSampai = e.target.value; if (aSampai < aDari) aDari = aSampai; vAbsen(); };
  $("#aHari").onclick = () => { aDari = aSampai = today(); vAbsen(); };
  $("#aBulan").onclick = () => { aDari = today().slice(0, 8) + "01"; aSampai = today(); vAbsen(); };
  const R = await coba(() => api("GET", `/api/absen?dari=${aDari}&sampai=${aSampai}`));
  if (!R || view !== "absen") { if (view === "absen" && !R) $("#aIsi").innerHTML = `<div class="empty">Data absensi belum bisa dimuat${LOKAL ? " (perangkat ini mengambilnya dari server pusat, butuh internet)" : ""}.</div>`; return; }
  const satuHari = aDari === aSampai;
  $("#aIsi").innerHTML = `
    <p class="small muted" style="margin:0 0 12px">${(R.shifts || []).map(x => `${esc(x.nama)} ${esc(x.masuk)}–${esc(x.pulang)}`).join(" · ")}. Masuk = absen masuk pertama, pulang = absen pulang terakhir. Datang sebelum jam masuk shift & pulang setelah jam pulang shift dihitung <b>lembur</b>${R.lembur_bulat > 1 ? ` (dibulatkan per ${R.lembur_bulat} menit)` : ""}.</p>
    ${R.takDikenal.length ? `<p class="note" style="margin:0 0 12px">Ada scan dari PIN mesin yang belum dihubungkan ke karyawan: <b>${R.takDikenal.map(t => esc(t.pin) + " (" + t.jumlah + "×)").join(", ")}</b>. Hubungkan di Pengaturan → Absensi sidik jari.</p>` : ""}
    ${!satuHari ? `<section class="panel" style="margin-bottom:12px"><h3 style="font-size:16px;margin:0 0 8px">Ringkasan ${esc(tglID(aDari))} – ${esc(tglID(aSampai))}</h3>
      ${R.ringkas.length ? `<div class="list">${R.ringkas.map(r => `<div class="li"><div class="main"><div class="t">${esc(r.nama)}</div><div class="small muted">${r.tanpaPulang ? r.tanpaPulang + " hari tanpa absen pulang" : "Lengkap"}${r.lembur ? ` · lembur <b>${jamMenit(r.lembur)}</b>${r.lembur_rp ? " = " + rp(r.lembur_rp) : ""}` : ""}</div></div>
        <div style="text-align:right"><div class="num" style="font-weight:700">${r.hadir} hari</div>${r.terlambat ? `<span class="pill warn">${r.terlambat}× terlambat</span>` : `<span class="pill ok">tepat waktu</span>`}</div></div>`).join("")}</div>` : `<div class="empty">Belum ada data.</div>`}</section>` : ""}
    <div class="row" style="margin-bottom:8px"><h3 style="font-size:16px;margin:0;flex:1">${satuHari ? "Kehadiran " + esc(tglID(aDari)) : "Per hari"}</h3>
      ${LOKAL && B.me ? "" : `<button class="btn sm" id="aManual" type="button">+ Absen oleh admin</button>`}<button class="btn sm" id="aCsv" type="button">Unduh CSV</button></div>
    ${R.harian.length ? `<div class="list">${R.harian.map(h => `<div class="li click" data-k="${h.tgl}|${h.user_id}">
      <div class="main"><div class="t">${esc(h.nama)}${satuHari ? "" : ` <span class="small muted">${tglPendek(h.tgl)}</span>`}</div>
        <div class="small muted">${esc(h.shift || "")}${h.shift ? " · " : ""}${h.scan.length} scan${h.scan.some(x => x.sumber === "pin") ? " · 📷 selfie" : ""}${h.scan.some(x => x.sumber === "manual") ? " · ada manual" : ""}</div></div>
      <div style="text-align:right"><div class="num" style="font-weight:700">${h.masuk} – ${h.pulang || "…"}</div>
        ${h.terlambat ? `<span class="pill warn">terlambat</span>` : `<span class="pill ok">tepat</span>`}${h.pulangCepat ? ` <span class="pill mut">pulang cepat</span>` : ""}${h.lembur ? ` <span class="pill">lembur ${jamMenit(h.lembur)}</span>` : ""}</div></div>`).join("")}</div>`
      : `<div class="list"><div class="empty">Belum ada scan pada ${satuHari ? "tanggal" : "periode"} ini.</div></div>`}`;
  $("#aCsv").onclick = () => unduhCSV(`absensi-${aDari}_${aSampai}.csv`, [["Tanggal", "Nama", "Shift", "Masuk", "Pulang", "Jumlah scan", "Terlambat", "Pulang cepat", "Lembur (menit)"],
    ...R.harian.slice().reverse().map(h => [h.tgl, h.nama, h.shift || "", h.masuk, h.pulang, h.scan.length, h.terlambat ? "YA" : "", h.pulangCepat ? "YA" : "", h.lembur || 0])]);
  const man = $("#aManual"); if (man) man.onclick = () => absenManual();
  $$("#aIsi .li.click").forEach(el => el.onclick = () => {
    const h = R.harian.find(x => `${x.tgl}|${x.user_id}` === el.dataset.k); if (!h) return;
    modal(`<h3>${esc(h.nama)} · ${esc(tglID(h.tgl))}</h3>
      <p class="small muted" style="margin:0">${esc(h.shift || "")} ${esc(h.shift_masuk || "")}–${esc(h.shift_pulang || "")}${h.lembur ? ` · lembur <b>${jamMenit(h.lembur)}</b> (datang awal ${h.lembur_awal} mnt, pulang lewat ${h.lembur_akhir} mnt)` : ""}</p>
      <div class="list">${h.scan.map(x => `<div class="li"><div class="main"><div class="t num">${x.jam}${x.jenis ? ` <span class="pill ${x.jenis === "masuk" ? "ok" : "mut"}">${x.jenis}</span>` : ""}</div><div class="small muted">${x.sumber === "manual" ? "Manual oleh " + esc(x.oleh) + (x.ket ? " · " + esc(x.ket) : "") : x.sumber === "pin" ? `PIN + selfie di ${esc(x.perangkat || "perangkat kasir")}${x.jarak != null ? ` · ±${Math.round(x.jarak)} m dari toko` : ""}` : "Mesin sidik jari"}</div></div>
        ${x.foto ? `<button class="btn sm" data-foto="${x.id}" type="button">📷 Foto</button>` : ""}${LOKAL ? "" : `<button class="btn sm danger" data-hapus="${x.id}" type="button">Hapus</button>`}</div>`).join("")}</div>
      <div class="actions"><button class="btn" data-close>Tutup</button></div>`, m => {
      m.querySelectorAll("[data-foto]").forEach(b => b.onclick = () => coba(async () => {
        const f = await api("GET", `/api/absen/${b.dataset.foto}/foto`);
        modal(`<h3>Foto absen ${esc(h.nama)}</h3><img src="${f.foto}" alt="Foto selfie absen" style="width:100%;border-radius:10px"><div class="actions"><button class="btn" data-close>Tutup</button></div>`);
      }, b));
      m.querySelectorAll("[data-hapus]").forEach(b => b.onclick = () => konfirmasi("Hapus scan ini?", "Scan dihapus dari rekap absensi.", "Hapus", () => coba(async () => { await api("DELETE", `/api/absen/${b.dataset.hapus}`); toast("Scan dihapus"); vAbsen(); })));
    });
  });
}
function absenManual(){
  let jenis = new Date().getHours() < 13 ? "masuk" : "pulang";
  modal(`<h3>Absen oleh admin</h3><p class="small muted" style="margin:0">Untuk karyawan yang tidak bisa absen sendiri (mis. HP/mesin bermasalah). Jam absen otomatis <b>jam sekarang</b> dan tidak bisa diubah.</p>
    <div class="stack">
      <div class="seg" id="amJ" style="display:flex"><button type="button" data-j="masuk" style="flex:1" class="${jenis === "masuk" ? "on" : ""}">Masuk</button><button type="button" data-j="pulang" style="flex:1" class="${jenis === "pulang" ? "on" : ""}">Pulang</button></div>
      <label class="f">Karyawan<select id="amU">${B.staf.map(s => `<option value="${s.id}">${esc(s.nama)}</option>`).join("")}</select></label>
      <label class="f">Keterangan<input type="text" id="amK" placeholder="Contoh: HP mati"></label>
    </div>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="amOk" type="button">Absen sekarang</button></div>`, m => {
    $$("#amJ button", m).forEach(b => b.onclick = () => { jenis = b.dataset.j; $$("#amJ button", m).forEach(x => x.classList.toggle("on", x === b)); });
    $("#amOk", m).onclick = e => coba(async () => { const r = await api("POST", "/api/absen/manual", { user_id: +$("#amU", m).value, jenis, ket: $("#amK", m).value }); closeModal(); toast(`Absen ${r.jenis} jam ${r.jam} disimpan`); aDari = aSampai = r.tgl; vAbsen(); }, e.target);
  });
}

/** Pengaturan: aktifkan absensi, alamat untuk mesin, jam kerja, dan PIN mesin tiap karyawan. */
async function aturAbsen(){
  const el = $("#aAbsen"); if (!el) return;
  if (LOKAL && cabangAktifDiSini()) {
    // Perangkat kasir: status absen di perangkat ini & tombol ambil lokasi toko
    const K = await api("GET", "/api/absen/kiosk").catch(() => null); if (!$("#aAbsen")) return;
    el.innerHTML = `<h3 style="font-size:17px">Absensi</h3>
      <p class="small" style="margin:0">Absen PIN + selfie di perangkat ini: ${K && K.boleh ? `<b style="color:var(--ok)">siap dipakai</b> (tombol <b>Masuk</b> / <b>Pulang</b> di atas & di layar masuk)` : `<b>belum bisa</b> — ${esc(K ? K.alasan : "status tidak terbaca")}`}.</p>
      <p class="small muted" style="margin:0">Aktifkan absen, atur shift & lembur, dan izinkan perangkat ini dari server (browser) → Pengaturan. Lokasi toko bisa diambil dari perangkat ini saat berada di toko:</p>
      <button class="btn" id="abLokasiIni" type="button">📍 Pakai lokasi perangkat ini sebagai lokasi toko</button>`;
    $("#abLokasiIni").onclick = e => coba(async () => {
      toast("Membaca lokasi…");
      const p = await ambilLokasi();
      if (p.akurasi > 100) toast(`Akurasi lokasi ±${Math.round(p.akurasi)} m. Sebaiknya coba lagi di dekat pintu/jendela.`);
      await api("POST", "/api/absen/lokasi-toko", { lat: p.lat, lng: p.lng });
      await api("POST", "/api/cabang/sinkron").catch(() => {});
      toast(`Lokasi toko disimpan (±${Math.round(p.akurasi)} m)`); aturAbsen();
    }, e.target);
    return;
  }
  const A = await coba(() => api("GET", "/api/absen/pengaturan")); if (!A || !$("#aAbsen")) return;
  const alamatPenuh = A.alamat ? location.origin + A.alamat : "";
  const koordinat = A.lat && A.lng ? `${A.lat}, ${A.lng}` : "";
  el.innerHTML = `<h3 style="font-size:17px">Absensi karyawan</h3>
    <p class="small muted" style="margin:0">Jam shift & lembur diatur di bagian <b>⏱️ Jam kerja, lembur & insentif lain</b>. Jam absen selalu jam saat karyawan absen (tidak bisa diisi manual).</p>

    <hr class="sep"><h4 style="margin:4px 0 0">📷 Absen PIN + foto selfie di perangkat kasir</h4>
    <p class="small muted" style="margin:0">Hemat memori: <b>foto selfie absen dihapus otomatis tanggal ${(+B.toko.periode_mulai || 15) + 1}</b> setiap bulan (sehari setelah gajian) untuk periode yang sudah digaji. Jam absen & rekapnya tetap tersimpan.</p>
    <p class="small muted" style="margin:0">Karyawan absen di iMin kasir: pilih nama, ketik PIN, ambil foto selfie. Hanya bisa dari perangkat yang diizinkan, dan hanya bila perangkat berada di lokasi toko.</p>
    <label class="row"><input type="checkbox" id="abPinAktif" ${A.pin_aktif ? "checked" : ""}> <b>Aktifkan absen PIN + selfie</b></label>
    <label class="f">Koordinat lokasi toko (lintang, bujur)<input type="text" id="abKoord" value="${esc(koordinat)}" placeholder="-6.3274, 108.3247" inputmode="decimal"></label>
    <p class="small muted" style="margin:0">Cara termudah: di iMin (saat di toko) buka Pengaturan → Absensi → <b>Pakai lokasi perangkat ini</b>. Atau <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(B.toko.alamat || "")}" target="_blank" rel="noopener">buka alamat toko di Google Maps</a>, tekan lama titik toko, salin angka koordinatnya, lalu tempel di sini.</p>
    <button class="btn" id="abLokasiSaya" type="button">📍 Pakai lokasi saya sekarang</button>
    <p class="small muted" style="margin:0" id="abLokasiInfo">Tekan saat sedang berada <b>di dalam toko</b>, lalu tekan <b>Simpan pengaturan absen</b>.</p>
    <label class="f">Radius (meter dari titik toko)<input type="number" id="abRadius" value="${A.radius}" min="20" max="2000" step="10"></label>
    <p class="small muted" style="margin:0">Izinkan perangkat kasir mana yang boleh dipakai absen di bagian <b>Server pusat → Perangkat cabang</b> (tombol "Izinkan absen").</p>
    <button class="btn pri" id="abSimpanUmum" type="button">Simpan pengaturan absen</button>

    <hr class="sep"><h4 style="margin:4px 0 0">🖐️ Mesin sidik jari (Fingerspot)</h4>
    <p class="small muted" style="margin:0">Untuk mesin absen <b>Fingerspot Revo</b> yang tersambung WiFi ke layanan <b>developer.fingerspot.io</b>. Setiap scan dikirim otomatis ke ${LOKAL ? "aplikasi ini" : "server ini"} dan tampil di menu <b>Absensi</b>.</p>
    <label class="row"><input type="checkbox" id="abAktif" ${A.aktif ? "checked" : ""}> <b>Aktifkan mesin sidik jari</b></label>
    ${A.aktif ? `
      ${LOKAL ? `<p class="note" style="margin:0">Mesin absen mengirim data lewat internet, jadi alamat penerimanya harus server online. Sambungkan perangkat ini ke server pusat, lalu aktifkan di server.</p>` : `
      <label class="f">Alamat webhook (tempel di developer.fingerspot.io)<input type="text" id="abUrl" value="${esc(alamatPenuh)}" readonly></label>
      <div class="row"><button class="btn sm" id="abSalin" type="button">Salin alamat</button><button class="btn sm" id="abUji" type="button">Uji alamat</button><button class="btn sm ghost" id="abBaru" type="button">Buat alamat baru</button></div>
      <p class="small ${A.terakhir ? "" : "muted"}" style="margin:0">${A.terakhir ? `Data terakhir diterima: <b>${esc(waktuLokal(A.terakhir.waktu))}</b> (${esc(A.terakhir.jenis)}${A.terakhir.baru ? ", " + A.terakhir.baru + " scan baru" : ""})` : "Belum ada data dari mesin."}</p>`}
      <label class="f">Cloud ID mesin (opsional, untuk menolak mesin lain)<input type="text" id="abMesin" value="${esc(A.mesin)}" placeholder="Lihat di aplikasi/akun Fingerspot"></label>
      <p class="small" style="margin:0"><b>PIN mesin tiap karyawan</b> — isi dengan nomor ID karyawan saat mendaftarkan sidik jarinya di mesin.</p>
      <div class="stack" id="abPin">${A.karyawan.filter(k => k.aktif).map(k => `<div class="row" style="align-items:center"><span style="flex:1">${esc(k.nama)} <span class="small muted">${k.peran}</span></span><input type="text" inputmode="numeric" data-uid="${k.id}" value="${esc(k.pin_absen || "")}" placeholder="PIN" style="width:110px"></div>`).join("")}</div>
      <button class="btn pri" id="abSimpan" type="button">Simpan pengaturan mesin</button>
      <details><summary class="small"><b>Cara menyambungkan mesin</b></summary><ol class="small" style="margin:8px 0 0;padding-left:20px">
        <li>Pasang mesin Fingerspot Revo, sambungkan ke WiFi toko, dan daftarkan ke akun <b>Fingerspot.io</b> (ikuti buku panduan mesin).</li>
        <li>Daftarkan sidik jari tiap karyawan di mesin. Catat nomor ID (PIN) masing-masing, lalu isi di kolom PIN di atas.</li>
        <li>Masuk ke <b>developer.fingerspot.io</b>, pilih mesin, lalu isi <b>Webhook URL</b> dengan alamat di atas.</li>
        <li>Coba scan satu jari, lalu buka menu <b>Absensi</b>: scan harus muncul dalam beberapa detik.</li></ol></details>` : ""}`;
  $("#abLokasiSaya").onclick = e => coba(async () => {
    toast("Membaca lokasi…");
    const p = await ambilLokasi();
    $("#abKoord").value = `${p.lat.toFixed(7)}, ${p.lng.toFixed(7)}`;
    $("#abLokasiInfo").innerHTML = `Lokasi terbaca: <b>${p.lat.toFixed(7)}, ${p.lng.toFixed(7)}</b> (akurasi ±${Math.round(p.akurasi)} m)${p.akurasi > 100 ? " — kurang akurat, coba lagi di dekat pintu/jendela" : ""}. <a href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noopener">Cek di peta</a>, lalu tekan <b>Simpan pengaturan absen</b>.`;
  }, e.target);
  $("#abSimpanUmum").onclick = e => coba(async () => {
    const k = $("#abKoord").value.trim(), m = k.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (k && !m) throw new Error("Format koordinat: lintang, bujur — contoh -6.3274, 108.3247");
    await api("PUT", "/api/absen/pengaturan", { pin_aktif: $("#abPinAktif").checked,
      radius: $("#abRadius").value, lat: m ? m[1] : "", lng: m ? m[2] : "" });
    await muatUlang(); renderNav(); toast("Pengaturan absen disimpan"); aturAbsen();
  }, e.target);
  $("#abAktif").onchange = e => coba(async () => { await api("PUT", "/api/absen/pengaturan", { aktif: e.target.checked }); await muatUlang(); renderNav(); toast(e.target.checked ? "Mesin sidik jari diaktifkan" : "Mesin sidik jari dimatikan"); aturAbsen(); });
  if (!A.aktif) return;
  const salin = $("#abSalin"); if (salin) salin.onclick = () => salinTeks($("#abUrl").value, "Alamat disalin");
  const uji = $("#abUji"); if (uji) uji.onclick = e => coba(async () => {
    const r = await fetch(A.alamat, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "uji", cloud_id: A.mesin || "" }) });
    toast(r.ok ? "Alamat berfungsi: siap menerima data dari mesin" : "Alamat tidak berfungsi (HTTP " + r.status + ")"); aturAbsen();
  }, e.target);
  const baru = $("#abBaru"); if (baru) baru.onclick = () => konfirmasi("Buat alamat baru?", "Alamat lama berhenti berfungsi. Alamat baru harus ditempel lagi di developer.fingerspot.io.", "Buat baru", () => coba(async () => { await api("PUT", "/api/absen/pengaturan", { kunciBaru: true }); aturAbsen(); }));
  $("#abSimpan").onclick = e => coba(async () => {
    await api("PUT", "/api/absen/pengaturan", { mesin: $("#abMesin").value,
      pin: $$("#abPin input").map(i => ({ user_id: +i.dataset.uid, pin: i.value.trim() })) });
    await muatUlang(); toast("Pengaturan mesin disimpan"); aturAbsen();
  }, e.target);
}

/* ================= ABSEN KARYAWAN DI PERANGKAT KASIR (PIN + selfie + lokasi) ================= */
/** Lokasi perangkat (GPS). Mengembalikan { lat, lng, akurasi }. */
function ambilLokasi(){
  return new Promise((ok, gagal) => {
    if (!navigator.geolocation) return gagal(new Error("Perangkat ini tidak bisa membaca lokasi"));
    navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, akurasi: p.coords.accuracy || 0 }),
      e => gagal(new Error(e.code === 1 ? "Izin lokasi ditolak. Izinkan lokasi untuk aplikasi Rich Gallery POS." : "Lokasi tidak terbaca. Nyalakan GPS / Lokasi di pengaturan HP lalu coba lagi.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  });
}
let kioskInfo = null;
async function cekKiosk(){ kioskInfo = LOKAL ? await api("GET", "/api/absen/kiosk").catch(() => null) : null; return kioskInfo; }
/* ================= ABSEN (untuk semua karyawan) =================
   Halaman sederhana: jam sekarang, dua tombol besar (MASUK / PULANG), dan langkah-langkahnya.
   Data absensi tidak ditampilkan di sini (rekap hanya untuk admin di menu Rekap Absen). */
const jamSekarang = () => new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(".", ":");
function panelAbsen(K, ringkas = false){
  const shifts = (B && B.toko && Array.isArray(B.toko.shifts) ? B.toko.shifts : []);
  if (!K || !K.aktif) return ringkas ? "" : `<div class="absen-tutup"><b>Absen belum diaktifkan.</b><br>Admin: Pengaturan → Absensi → aktifkan absen PIN + selfie.</div>`;
  if (!K.boleh) return `<div class="absen-tutup"><b>Absen belum bisa dipakai di perangkat ini.</b><br>${esc(K.alasan)}</div>`;
  return `<div class="absen-panel">
    <div class="absen-jam"><span class="jam" data-jam>${jamSekarang()}</span><span class="tgl">${esc(tglID(today()))}</span></div>
    <div class="absen-tombol">
      <button type="button" class="absen-besar masuk" data-absen="masuk"><span class="ik">☀️</span><b>ABSEN MASUK</b><small>Saat datang kerja</small></button>
      <button type="button" class="absen-besar pulang" data-absen="pulang"><span class="ik">🌙</span><b>ABSEN PULANG</b><small>Saat selesai kerja</small></button>
    </div>
    ${ringkas ? "" : `<ol class="absen-langkah">
      <li><span class="n">1</span><div>Tekan <b>Absen Masuk</b> atau <b>Absen Pulang</b></div></li>
      <li><span class="n">2</span><div>Pilih <b>nama</b> kamu, lalu ketik <b>PIN</b></div></li>
      <li><span class="n">3</span><div>Hadap kamera, tekan <b>Ambil foto</b></div></li>
      <li><span class="n">4</span><div>Tekan <b>Simpan</b> — selesai ✅</div></li>
    </ol>
    ${shifts.length ? `<div class="absen-shift">${shifts.map(x => `<span><b>${esc(x.nama)}</b> ${esc(x.masuk)}–${esc(x.pulang)}</span>`).join("")}</div>` : ""}
    <p class="small muted" style="margin:0;text-align:center">Jam absen tercatat otomatis. Absen hanya bisa di toko, dari perangkat kasir ini.</p>`}
  </div>`;
}
function pasangJam(el){
  $$("[data-absen]", el).forEach(b => b.onclick = () => bukaAbsen(b.dataset.absen));
  const j = $("[data-jam]", el); if (!j) return;
  const t = setInterval(() => { if (!document.body.contains(j)) return clearInterval(t); j.textContent = jamSekarang(); }, 5000);
}
async function vAbsenku(){
  $("#main").innerHTML = `<div class="view-head"><h2>Absen karyawan</h2></div><div id="akIsi"><div class="empty">Memuat…</div></div>`;
  const K = await cekKiosk(); const el = $("#akIsi"); if (view !== "absenku" || !el) return;
  el.innerHTML = panelAbsen(K);
  pasangJam(el);
}

/** Layar absen: pilih nama + PIN + foto selfie, lokasi dicek otomatis. */
async function bukaAbsen(jenisAwal){
  const K = await cekKiosk();
  if (!K || !K.boleh) return toast(K ? K.alasan : "Absen tidak tersedia");
  let jenis = jenisAwal === "pulang" || jenisAwal === "masuk" ? jenisAwal : new Date().getHours() < 13 ? "masuk" : "pulang", foto = "", lokasi = null, stream = null;
  const saya = B && B.me && K.staf.some(s => s.id === B.me.id) ? B.me.id : null;
  modal(`<h3 id="akJudul" class="absen-judul ${jenis}">${jenis === "masuk" ? "☀️ ABSEN MASUK" : "🌙 ABSEN PULANG"} · ${jamSekarang()}</h3>
    <div class="stack">
      <div class="seg" id="akJ" style="display:flex"><button type="button" data-j="masuk" style="flex:1" class="${jenis === "masuk" ? "on" : ""}">Masuk</button><button type="button" data-j="pulang" style="flex:1" class="${jenis === "pulang" ? "on" : ""}">Pulang</button></div>
      <label class="f">1. Nama kamu<select id="akU"><option value="">— pilih nama —</option>${K.staf.map(s => `<option value="${s.id}" ${s.id === saya ? "selected" : ""}>${esc(s.nama)}</option>`).join("")}</select></label>
      <label class="f">2. PIN<input type="password" id="akP" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="PIN / password yang sama untuk masuk aplikasi"></label>
      <div class="small" style="font-weight:700;margin-bottom:-6px">3. Foto selfie</div>
      <div class="absen-kamera"><video id="akV" autoplay playsinline muted></video><img id="akF" alt="Foto selfie" hidden><div id="akKet" class="small muted">Menyalakan kamera…</div></div>
      <div class="row"><button class="btn" id="akAmbil" type="button" disabled>📸 Ambil foto</button><button class="btn ghost" id="akUlang" type="button" hidden>Ulangi foto</button></div>
      <p class="small" id="akLok" style="margin:0">📍 Membaca lokasi…</p>
    </div>
    <div class="actions"><button class="btn" id="akBatal" type="button">Batal</button><button class="btn pri" id="akKirim" type="button" disabled>Simpan absen</button></div>`, m => {
    const v = $("#akV", m), img = $("#akF", m), ket = $("#akKet", m);
    const matikan = () => { try { stream && stream.getTracks().forEach(t => t.stop()); } catch {} stream = null; };
    const siap = () => { $("#akKirim", m).disabled = !(foto && lokasi && lokasi.ok && $("#akU", m).value && $("#akP", m).value); };
    const pantau = setInterval(() => { if (!document.body.contains(v)) { matikan(); clearInterval(pantau); } }, 800);
    $$("#akJ button", m).forEach(b => b.onclick = () => { jenis = b.dataset.j; $$("#akJ button", m).forEach(x => x.classList.toggle("on", x === b)); $("#akKirim", m).textContent = "Simpan absen " + jenis;
      const jd = $("#akJudul", m); jd.className = "absen-judul " + jenis; jd.textContent = (jenis === "masuk" ? "☀️ ABSEN MASUK" : "🌙 ABSEN PULANG") + " · " + jamSekarang(); });
    $("#akKirim", m).textContent = "Simpan absen " + jenis;
    $("#akU", m).onchange = siap; $("#akP", m).oninput = siap;
    $("#akBatal", m).onclick = () => { matikan(); closeModal(); };
    // Kamera depan
    (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Kamera tidak tersedia di aplikasi versi ini. Pasang versi terbaru (Pengaturan → Periksa pembaruan).");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (!document.body.contains(v)) return matikan();
        v.srcObject = stream; await v.play().catch(() => {});
        ket.textContent = "Arahkan wajah ke kamera, lalu tekan Ambil foto"; $("#akAmbil", m).disabled = false;
      } catch (e) { ket.textContent = e.name === "NotAllowedError" ? "Izin kamera ditolak. Izinkan kamera untuk aplikasi ini." : e.name === "NotFoundError" ? "Kamera tidak ditemukan di perangkat ini." : e.message; }
    })();
    $("#akAmbil", m).onclick = () => {
      const w = 360, h = Math.round(w * (v.videoHeight || 480) / (v.videoWidth || 640));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.translate(w, 0); g.scale(-1, 1); g.drawImage(v, 0, 0, w, h); // seperti cermin
      foto = c.toDataURL("image/jpeg", 0.6);
      img.src = foto; img.hidden = false; v.hidden = true; ket.textContent = "";
      $("#akAmbil", m).hidden = true; $("#akUlang", m).hidden = false; siap();
    };
    $("#akUlang", m).onclick = () => { foto = ""; img.hidden = true; v.hidden = false; $("#akAmbil", m).hidden = false; $("#akUlang", m).hidden = true; siap(); };
    // Lokasi
    const bacaLokasi = async () => {
      $("#akLok", m).textContent = "📍 Membaca lokasi…";
      try {
        const p = await ambilLokasi();
        const jarak = isFinite(K.lat) && isFinite(K.lng) ? jarakM(p.lat, p.lng, K.lat, K.lng) : null;
        const ok = jarak == null || jarak <= K.radius + Math.min(p.akurasi, 50);
        lokasi = { ...p, ok };
        $("#akLok", m).innerHTML = jarak == null ? `📍 Lokasi terbaca (±${Math.round(p.akurasi)} m)`
          : ok ? `📍 Di toko — ±${Math.round(jarak)} m dari titik toko <span class="pill ok">OK</span>`
          : `📍 <b style="color:var(--bad)">Di luar toko</b> — ±${Math.round(jarak)} m (batas ${K.radius} m). <button class="btn sm" id="akLokUlang" type="button">Cek ulang</button>`;
        const u = $("#akLokUlang", m); if (u) u.onclick = bacaLokasi;
      } catch (e) { lokasi = null; $("#akLok", m).innerHTML = `📍 ${esc(e.message)} <button class="btn sm" id="akLokUlang" type="button">Coba lagi</button>`; $("#akLokUlang", m).onclick = bacaLokasi; }
      siap();
    };
    bacaLokasi();
    $("#akKirim", m).onclick = e => coba(async () => {
      const r = await api("POST", "/api/absen/pin", { user_id: +$("#akU", m).value, pin: $("#akP", m).value, jenis, foto, lat: lokasi.lat, lng: lokasi.lng, akurasi: lokasi.akurasi });
      matikan(); closeModal();
      modal(`<h3>✅ Absen ${r.jenis} tercatat</h3><p style="font-size:18px;margin:0"><b>${esc(r.nama)}</b> — jam <b>${esc(r.jam)}</b></p><p class="small muted">±${r.jarak} m dari titik toko</p><div class="actions"><button class="btn pri" data-close>Selesai</button></div>`);
    }, e.target);
  });
}
/** 90 → "1 j 30 m" */
const jamMenit = m => { m = Math.round(m || 0); const j = Math.floor(m / 60), r = m % 60; return (j ? j + " j" : "") + (j && r ? " " : "") + (r || !j ? r + " m" : ""); };
const JENIS_LAIN = { kurir: "🛵 Jasa kurir non online", lapangan: "🧑‍🔧 Kerja lapangan", konten: "🎬 Buat konten" };
const jarakM = (lat1, lng1, lat2, lng2) => { const R = 6371000, r = x => x * Math.PI / 180; const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
const cabangAktifDiSini = () => !!(B && B.cabang);

/* ================= GAJI KARYAWAN (admin) =================
   Gaji kotor = gaji pokok + insentif produksi + insentif lain + lembur + bonus; gaji bersih = kotor − potong kasbon. */
let gPer = null;
async function vGaji(){
  if (!gPer) gPer = periodeDari(today(), B.toko.periode_mulai);
  const [a] = gPer;
  $("#main").innerHTML = `<div class="view-head"><h2>Gaji karyawan</h2></div>
    <div class="row" style="margin-bottom:12px"><button class="btn sm" id="gPrev" type="button" aria-label="Periode sebelumnya">‹</button><div style="flex:1;text-align:center" id="gJudul"><b>Memuat…</b></div><button class="btn sm" id="gNext" type="button" aria-label="Periode berikutnya">›</button></div>
    <div id="gIsi"><div class="empty">Memuat…</div></div>`;
  $("#gPrev").onclick = () => { gPer = geserPeriode(a, -1, B.toko.periode_mulai); vGaji(); };
  $("#gNext").onclick = () => { gPer = geserPeriode(a, 1, B.toko.periode_mulai); vGaji(); };
  const [G, K] = await Promise.all([coba(() => api("GET", `/api/gaji?tgl=${a}`)), api("GET", "/api/kasbon").catch(() => null)]);
  if (view !== "gaji") return;
  if (!G) { $("#gIsi").innerHTML = `<div class="empty">Data gaji belum bisa dimuat${LOKAL ? " (diambil dari server pusat, butuh internet)" : ""}.</div>`; return; }
  const ro = !!G.dariPusat; // di perangkat cabang: hanya lihat
  $("#gJudul").innerHTML = `<div class="small muted" style="text-transform:uppercase;letter-spacing:.05em;font-weight:700">Periode gaji</div><b>${tglID(G.dari)} – ${tglID(G.sampai)}</b><div class="small">Gajian: <b>${tglID(G.tgl_gajian)}</b></div>`;
  const tot = k => G.rows.reduce((t, r) => t + (r[k] || 0), 0);
  const belum = G.rows.filter(r => !r.bayar && r.kotor > 0);
  $("#gIsi").innerHTML = `
    ${ro ? `<p class="note" style="margin:0 0 12px">Data gaji dari server pusat. Pembayaran gaji, gaji pokok & kasbon diatur dari server (browser).</p>` : ""}
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="l">Total gaji kotor</div><div class="v num">${rp(tot("kotor"))}</div></div>
      <div class="kpi"><div class="l">Potong kasbon</div><div class="v num">${rp(tot("potong_hutang"))}</div></div>
      <div class="kpi"><div class="l">Total gaji bersih</div><div class="v num">${rp(tot("bersih"))}</div><div class="small muted">${belum.length ? belum.length + " karyawan belum dibayar" : "semua sudah dibayar"}</div></div>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Nama</th><th class="r">Pokok</th><th class="r">Insentif</th><th class="r">Lembur</th><th class="r">Kotor</th><th class="r">Kasbon</th><th class="r">Bersih</th><th>Status</th><th></th></tr></thead><tbody>
    ${G.rows.map(r => `<tr><td><b>${esc(r.nama)}</b><div class="small muted">${r.hadir} hari hadir${r.terlambat ? ` · ${r.terlambat}× telat` : ""}</div></td>
      <td class="r num">${rp(r.pokok)}</td>
      <td class="r num">${rp(r.ins_produksi + r.ins_lain)}${r.insentif_terpisah ? `<div class="small muted">sudah dibayar terpisah</div>` : ""}</td>
      <td class="r num">${r.lembur_menit ? `${rp(r.lembur)}<div class="small muted">${jamMenit(r.lembur_menit)}</div>` : "-"}</td>
      <td class="r num">${rp(r.kotor)}${r.bonus ? `<div class="small muted">bonus ${rp(r.bonus)}</div>` : ""}</td>
      <td class="r num">${r.bayar ? (r.potong_hutang ? "−" + rp(r.potong_hutang) : "-") : r.hutang ? `<span style="color:var(--bad)">hutang ${rp(r.hutang)}</span>` : "-"}</td>
      <td class="r num" style="font-weight:700">${rp(r.bersih)}</td>
      <td>${r.bayar ? `<span class="pill ok">DIBAYAR</span><div class="small muted">${tglPendek(r.bayar.tgl)} · ${esc(r.bayar.metode)}</div>` : r.kotor ? `<span class="pill warn">BELUM</span>` : ""}</td>
      <td class="r" style="white-space:nowrap">${r.bayar ? `<button class="btn sm" data-slip="${r.user_id}" type="button">Slip</button>${ro ? "" : ` <button class="btn sm ghost" data-batal="${r.bayar.id}" type="button">Batalkan</button>`}`
        : r.kotor && !ro ? `<button class="btn sm pri" data-bayar="${r.user_id}" type="button">Bayar</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">Belum ada karyawan.</td></tr>`}
    </tbody></table></div>
    <p class="small muted" style="margin:8px 0 0">Kotor = gaji pokok + insentif produksi + insentif lain + lembur (${rp(G.lembur_per_jam)}/jam) + bonus. Bersih = kotor − potongan kasbon. Setiap pembayaran otomatis tercatat di Pengeluaran (kategori Gaji Karyawan).</p>

    <div class="grid2" style="align-items:start;margin-top:18px">
      <section class="panel stack" id="gPokok"><h3 style="font-size:17px">Gaji pokok</h3>
        <p class="small muted" style="margin:0">Gaji pokok per periode (per bulan) tiap karyawan.</p>
        <div class="stack">${G.rows.map(r => `<div class="row" style="align-items:center"><span style="flex:1">${esc(r.nama)}</span><input type="number" data-pokok="${r.user_id}" value="${r.gaji_pokok ?? r.pokok ?? 0}" min="0" step="50000" inputmode="numeric" style="width:150px" ${ro ? "disabled" : ""}></div>`).join("")}</div>
        ${ro ? "" : `<button class="btn pri" id="gPokokSimpan" type="button">Simpan gaji pokok</button>`}
      </section>
      <section class="panel stack"><h3 style="font-size:17px">Kasbon / hutang karyawan</h3>
        ${K ? `${K.saldo.length ? `<div class="list">${K.saldo.map(x => `<div class="li"><div class="main"><div class="t">${esc(x.nama)}</div><div class="small muted">sisa hutang</div></div><b class="num" style="color:var(--bad)">${rp(x.sisa)}</b></div>`).join("")}</div>` : `<p class="small muted" style="margin:0">Tidak ada hutang karyawan.</p>`}
          ${ro ? "" : `<div class="row"><button class="btn" id="gKasbon" type="button">+ Kasbon baru</button><button class="btn" id="gCicil" type="button">Bayar cicilan</button></div>`}
          <details><summary class="small"><b>Riwayat kasbon</b></summary><div class="list" style="margin-top:8px">${K.rows.length ? K.rows.map(x => `<div class="li"><div class="main"><div class="t">${esc(x.nama)} · ${x.jenis === "pinjam" ? "Kasbon" : x.jenis === "bayar" ? "Bayar cicilan" : "Potong gaji"}</div><div class="small muted">${tglPendek(x.tgl)} · ${esc(x.ket)}${x.metode ? " · " + esc(x.metode) : ""} · ${esc(x.oleh)}</div></div>
            <b class="num" style="color:${x.jenis === "pinjam" ? "var(--bad)" : "var(--ok)"}">${x.jenis === "pinjam" ? "+" : "−"}${rp(x.nominal)}</b>${ro || x.jenis === "potong" ? "" : `<button class="btn ghost sm" data-hapus-kasbon="${x.id}" type="button">Hapus</button>`}</div>`).join("") : `<div class="empty">Belum ada catatan.</div>`}</div></details>`
          : `<p class="small muted" style="margin:0">Data kasbon belum bisa dimuat.</p>`}
      </section>
    </div>`;
  $$("[data-bayar]").forEach(b => b.onclick = () => bayarGaji(G, G.rows.find(r => r.user_id === +b.dataset.bayar)));
  $$("[data-slip]").forEach(b => b.onclick = () => slipGaji(G, G.rows.find(r => r.user_id === +b.dataset.slip)));
  $$("[data-batal]").forEach(b => b.onclick = () => konfirmasi("Batalkan pembayaran gaji?", "Pengeluaran gaji & potongan kasbonnya ikut dibatalkan, lalu gaji bisa dibayar ulang dengan angka yang benar.", "Batalkan",
    () => coba(async () => { await api("DELETE", `/api/gaji/${b.dataset.batal}`); toast("Pembayaran gaji dibatalkan"); vGaji(); })));
  const sp = $("#gPokokSimpan"); if (sp) sp.onclick = e => coba(async () => {
    await api("PUT", "/api/gaji/pokok", { pokok: $$("[data-pokok]").map(i => ({ user_id: +i.dataset.pokok, gaji_pokok: num(i.value) })) });
    toast("Gaji pokok tersimpan"); vGaji();
  }, e.target);
  const kb = $("#gKasbon"); if (kb) kb.onclick = () => formKasbon("pinjam", G, K);
  const kc = $("#gCicil"); if (kc) kc.onclick = () => formKasbon("bayar", G, K);
  $$("[data-hapus-kasbon]").forEach(b => b.onclick = () => konfirmasi("Hapus catatan kasbon?", "Catatan ini (dan pengeluarannya, bila kasbon baru) dihapus.", "Hapus",
    () => coba(async () => { await api("DELETE", `/api/kasbon/${b.dataset.hapusKasbon}`); toast("Catatan kasbon dihapus"); vGaji(); })));
}
function formKasbon(jenis, G, K){
  const sisa = new Map((K.saldo || []).map(x => [x.user_id, x.sisa]));
  const orang = jenis === "bayar" ? G.rows.filter(r => sisa.get(r.user_id) > 0) : G.rows;
  if (!orang.length) return toast(jenis === "bayar" ? "Tidak ada karyawan yang punya hutang" : "Belum ada karyawan");
  let metode = "Tunai";
  modal(`<h3>${jenis === "pinjam" ? "Kasbon baru" : "Bayar cicilan kasbon"}</h3>
    <p class="small muted" style="margin:0">${jenis === "pinjam" ? "Uang yang dipinjam karyawan. Otomatis tercatat di Pengeluaran (Kasbon Karyawan) dan bisa dipotong dari gaji." : "Karyawan mengembalikan hutang di luar potong gaji."}</p>
    <div class="stack">
      <label class="f">Karyawan<select id="kbU">${orang.map(r => `<option value="${r.user_id}">${esc(r.nama)}${sisa.get(r.user_id) ? " — hutang " + rp(sisa.get(r.user_id)) : ""}</option>`).join("")}</select></label>
      <div class="row"><label class="f grow">Tanggal<input type="date" id="kbT" value="${today()}" max="${today()}"></label><label class="f grow">Nominal (Rp)<input type="number" id="kbN" min="0" step="10000" inputmode="numeric"></label></div>
      <label class="f">Keterangan singkat (wajib)<input type="text" id="kbK" maxlength="150" placeholder="${jenis === "pinjam" ? "Contoh: keperluan sekolah anak" : "Contoh: cicilan ke-1"}"></label>
      <div class="seg" id="kbM" style="display:flex"><button type="button" data-m="Tunai" style="flex:1" class="on">💵 Tunai</button><button type="button" data-m="Transfer" style="flex:1">🏦 Transfer</button></div>
    </div>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="kbOk" type="button">Simpan</button></div>`, m => {
    $$("#kbM button", m).forEach(b => b.onclick = () => { metode = b.dataset.m; $$("#kbM button", m).forEach(x => x.classList.toggle("on", x === b)); });
    $("#kbOk", m).onclick = e => {
      const nominal = num($("#kbN", m).value), ket = $("#kbK", m).value.trim();
      if (!nominal) return toast("Isi nominal"); if (!ket) return toast("Tulis keterangan singkat");
      coba(async () => { const r = await api("POST", "/api/kasbon", { user_id: +$("#kbU", m).value, jenis, tgl: $("#kbT", m).value, nominal, ket, metode });
        closeModal(); toast(`Tersimpan. Sisa hutang ${rp(r.sisa)}`); vGaji(); }, e.target);
    };
  });
}
function bayarGaji(G, r){
  let metode = "Transfer";
  const tglBayar = G.tgl_gajian <= today() ? G.tgl_gajian : today();
  modal(`<h3>Bayar gaji ${esc(r.nama)}</h3><p class="muted" style="margin:0">Periode ${tglID(G.dari)} – ${tglID(G.sampai)}</p>
    <div class="list">
      <div class="li"><div class="main">Gaji pokok</div><b class="num">${rp(r.pokok)}</b></div>
      <div class="li"><div class="main">Insentif produksi <span class="small muted">${fq(r.qty || 0)} pcs</span></div><b class="num">${rp(r.ins_produksi)}</b></div>
      ${(r.lainDetail || []).map(d => `<div class="li"><div class="main">${esc(d.label)} <span class="small muted">${d.kali}×</span></div><b class="num">${rp(d.nominal)}</b></div>`).join("")}
      <div class="li"><div class="main">Lembur <span class="small muted">${jamMenit(r.lembur_menit)} × ${rp(G.lembur_per_jam)}/jam</span></div><b class="num">${rp(r.lembur)}</b></div>
      ${r.insentif_terpisah ? `<div class="li"><div class="main small muted">Insentif periode ini sudah dibayar terpisah (${rp(r.insentif_terpisah)}), tidak dihitung lagi.</div></div>` : ""}
    </div>
    <div class="stack">
      <div class="row"><label class="f" style="width:150px">Bonus (Rp)<input type="number" id="gbB" value="0" min="0" step="10000" inputmode="numeric"></label><label class="f grow">Keterangan bonus<input type="text" id="gbBK" maxlength="120" placeholder="Contoh: bonus target"></label></div>
      <label class="f">Potong kasbon / hutang (Rp)${r.hutang ? ` — sisa hutang <b>${rp(r.hutang)}</b>` : ""}<input type="number" id="gbP" value="${Math.min(r.hutang, r.kotor)}" min="0" max="${r.hutang}" step="10000" inputmode="numeric" ${r.hutang ? "" : "disabled"}></label>
      <div class="list" id="gbHit"></div>
      <div class="seg" id="gbM" style="display:flex"><button type="button" data-m="Tunai" style="flex:1">💵 Tunai</button><button type="button" data-m="Transfer" style="flex:1" class="on">🏦 Transfer</button></div>
      <div class="row"><label class="f grow">Tanggal bayar<input type="date" id="gbT" value="${tglBayar}" max="${today()}"></label><label class="f grow">Catatan<input type="text" id="gbK" maxlength="200"></label></div>
    </div>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="gbOk" type="button">Bayar gaji</button></div>`, m => {
    const hitung = () => {
      const bonus = num($("#gbB", m).value) || 0, potong = Math.min(num($("#gbP", m).value) || 0, r.hutang), kotor = r.kotor + bonus;
      $("#gbHit", m).innerHTML = `<div class="li"><div class="main"><b>Gaji kotor</b></div><b class="num">${rp(kotor)}</b></div>
        ${potong ? `<div class="li"><div class="main">Potong kasbon <span class="small muted">sisa hutang jadi ${rp(r.hutang - potong)}</span></div><b class="num" style="color:var(--bad)">−${rp(potong)}</b></div>` : ""}
        <div class="li"><div class="main"><b>Gaji bersih diterima</b></div><b class="num" style="font-size:18px">${rp(kotor - potong)}</b></div>`;
    };
    hitung(); $("#gbB", m).oninput = hitung; $("#gbP", m).oninput = hitung;
    $$("#gbM button", m).forEach(b => b.onclick = () => { metode = b.dataset.m; $$("#gbM button", m).forEach(x => x.classList.toggle("on", x === b)); });
    $("#gbOk", m).onclick = e => coba(async () => {
      const g = await api("POST", "/api/gaji/bayar", { user_id: r.user_id, periode_dari: G.dari, bonus: num($("#gbB", m).value) || 0, bonus_ket: $("#gbBK", m).value.trim(),
        potong_hutang: num($("#gbP", m).value) || 0, metode, tgl: $("#gbT", m).value, ket: $("#gbK", m).value.trim() });
      closeModal(); toast(`Gaji ${r.nama} dibayar ${rp(g.bersih)} (${metode})`);
      const G2 = await api("GET", `/api/gaji?tgl=${G.dari}`); vGaji();
      const r2 = G2.rows.find(x => x.user_id === r.user_id); if (r2) slipGaji(G2, r2);
    }, e.target);
  });
}
function slipGajiLines(G, r){
  const w = lebar(), garis = "-".repeat(w), L = [], b = r.bayar || {};
  L.push({ t: center(B.toko.nama_toko, w), b: 1 }, { t: center("SLIP GAJI", w), b: 1 }, { t: garis });
  L.push({ t: lr("Nama", r.nama, w) }, { t: lr("Periode", tglPendek(G.dari) + "-" + tglPendek(G.sampai), w) }, { t: lr("Hadir", r.hadir + " hari", w) }, { t: garis });
  L.push({ t: lr("Gaji pokok", angka(r.pokok), w) }, { t: lr(`Insentif produksi ${fq(r.qty || 0)}pcs`, angka(r.ins_produksi), w) });
  if (r.ins_lain) L.push({ t: lr("Insentif lain", angka(r.ins_lain), w) });
  if (r.lembur_menit) L.push({ t: lr("Lembur " + jamMenit(r.lembur_menit), angka(r.lembur), w) });
  if (r.bonus) { L.push({ t: lr("Bonus", angka(r.bonus), w) }); if (b.bonus_ket) wrap("  " + b.bonus_ket, w).forEach(l => L.push({ t: l })); }
  L.push({ t: garis }, { t: lr("GAJI KOTOR", "Rp" + angka(r.kotor), w), b: 1 });
  if (r.potong_hutang) L.push({ t: lr("Potong kasbon", "-" + angka(r.potong_hutang), w) });
  L.push({ t: lr("GAJI BERSIH", "Rp" + angka(r.bersih), w), b: 1 }, { t: garis });
  if (r.bayar) L.push({ t: lr("Dibayar " + tglPendek(b.tgl), b.metode, w) });
  if (r.hutang) L.push({ t: lr("Sisa hutang", "Rp" + angka(r.hutang), w) });
  if (b.ket) wrap(b.ket, w).forEach(l => L.push({ t: l }));
  L.push({ t: "" }, { t: lr("Penerima", "Dibayar oleh", w) }, { t: "" }, { t: "" }, { t: lr("(" + r.nama + ")", "(" + (b.oleh || B.me.nama) + ")", w) });
  return L;
}
function slipGaji(G, r){
  const L = slipGajiLines(G, r);
  modal(`<h3>Slip gaji ${esc(r.nama)}</h3><pre class="receipt-prev">${esc(L.map(l => l.t).join("\n"))}</pre>
    <div class="actions"><button class="btn" data-close>Tutup</button><button class="btn pri" id="sgP">Cetak slip</button></div>`, m => $("#sgP", m).onclick = () => cetakBaris(L));
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
        <hr class="sep">
        <h3 style="font-size:17px">Insentif lain</h3>
        <div class="seg" id="ilJ" style="display:flex;flex-wrap:wrap">${Object.entries(JENIS_LAIN).map(([k, t], i) => `<button type="button" data-j="${k}" style="flex:1" class="${i ? "" : "on"}">${t}</button>`).join("")}</div>
        <div class="row"><label class="f grow">Tanggal<input type="date" id="ilT" value="${today()}" max="${today()}"></label><label class="f grow">Karyawan<select id="ilU">${pembuatList.map(s => `<option value="${s.id}" ${s.id === pOleh ? "selected" : ""}>${esc(s.nama)}</option>`).join("")}</select></label></div>
        <div class="row">${isAdmin() ? `<label class="f" style="width:140px">Nominal (Rp)<input type="number" id="ilN" min="0" step="500" inputmode="numeric"></label>` : ""}<label class="f grow">Keterangan<input type="text" id="ilK" placeholder="Contoh: antar ke Jatibarang / video reels"></label></div>
        <button class="btn pri" id="ilSave" type="button">Simpan insentif lain</button>
      </section>
      <section class="stack" style="min-width:0">
        <div class="row"><button class="btn sm" id="pPrev" type="button" aria-label="Periode sebelumnya">‹</button><div style="flex:1;text-align:center"><div class="small muted" style="text-transform:uppercase;letter-spacing:.05em;font-weight:700">Periode insentif</div><b>${tglID(a)} – ${tglID(b)}</b></div><button class="btn sm" id="pNext" type="button" aria-label="Periode berikutnya">›</button></div>
        <div id="pRekap"><div class="empty">Memuat…</div></div>
      </section>
    </div>
    <h3 style="font-size:17px;margin:22px 0 10px">Catatan produksi periode ini</h3>
    <div id="pLog"><div class="empty">Memuat…</div></div>
    <h3 style="font-size:17px;margin:22px 0 10px">Catatan insentif lain periode ini</h3>
    <div id="ilLog"><div class="empty">Memuat…</div></div>`;
  let ilJenis = "kurir";
  const tarifLain = j => Number(B.toko["ins_" + j]) || 0;
  const isiNominal = () => { if ($("#ilN")) $("#ilN").value = tarifLain(ilJenis) || ""; };
  isiNominal();
  $$("#ilJ button").forEach(bt => bt.onclick = () => { ilJenis = bt.dataset.j; $$("#ilJ button").forEach(x => x.classList.toggle("on", x === bt)); isiNominal(); });
  $("#ilSave").onclick = e => {
    const tgl = $("#ilT").value || today(), nominal = $("#ilN") ? num($("#ilN").value) : null;
    if (isAdmin() && !nominal) return toast("Isi nominal insentif");
    coba(async () => {
      await api("POST", "/api/insentif-lain", { tgl, user_id: +$("#ilU").value, jenis: ilJenis, nominal, ket: $("#ilK").value.trim() });
      toast(`${JENIS_LAIN[ilJenis].replace(/^\S+ /, "")}${nominal ? " " + rp(nominal) : ""} dicatat`);
      pPer = periodeDari(tgl, B.toko.periode_mulai); vProduksi();
    }, e.target);
  };
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
    const [rek, log, lain] = await Promise.all([isAdmin() ? api("GET", `/api/insentif?tgl=${a}`) : null, api("GET", `/api/produksi?dari=${a}&sampai=${b}`), api("GET", `/api/insentif-lain?dari=${a}&sampai=${b}`)]);
    if (view !== "produksi") return;
    if (!isAdmin()) {
      const saya = log.filter(x => x.pembuat_id === B.me.id).reduce((t, x) => t + x.qty, 0);
      $("#pRekap").innerHTML = `<div class="kpis"><div class="kpi"><div class="l">Produksi saya periode ini</div><div class="v num">${fq(saya)} pcs</div></div></div>
        <p class="small muted" style="margin:8px 0 0">Rincian insentif & gaji hanya bisa dilihat admin.</p>`;
    }
    const rows = rek ? rek.rows : [];
    if (rek) {
    const totQ = rows.reduce((x, r) => x + r.qty, 0), totI = rows.reduce((x, r) => x + r.total, 0);
    $("#pRekap").innerHTML = `<div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">${isAdmin() ? "Total produksi" : "Produksi saya"}</div><div class="v num">${fq(totQ)}</div></div><div class="kpi"><div class="l">${isAdmin() ? "Total insentif" : "Insentif saya"}</div><div class="v num">${rp(totI)}</div></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Nama</th><th class="r">Produksi</th><th class="r">Lain</th><th class="r">Lembur</th><th class="r">Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.nama)}</b></td><td class="r num">${r.qty ? `${rp(r.insentif)}<div class="small muted">${fq(r.qty)} pcs</div>` : "-"}</td>
        <td class="r num">${r.lain ? rp(r.lain) : "-"}</td><td class="r num">${r.lembur_menit ? `${r.lembur_rp ? rp(r.lembur_rp) : ""}<div class="small muted">${jamMenit(r.lembur_menit)}</div>` : "-"}</td>
        <td class="r num" style="font-weight:700">${rp(r.total)}</td>
        <td>${r.bayar ? `<span class="pill ok">DIBAYAR</span><div class="small muted">${tglPendek(r.bayar.tgl)}${r.bayar.nominal !== r.total ? " · " + rp(r.bayar.nominal) : ""}</div>` : r.total ? `<span class="pill warn">BELUM</span>` : ""}</td>
        <td class="r" style="white-space:nowrap">${r.qty || r.total ? `<button class="btn sm" data-slip="${r.pembuat_id}" type="button">Slip</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">Belum ada data.</td></tr>`}
      </tbody></table></div>
      ${rek.lemburTersedia === false ? `<p class="note" style="margin:8px 0 0">Lembur belum ikut dihitung: data absen ada di server pusat dan perangkat ini sedang offline.</p>` : ""}
      <p class="small" style="margin:8px 0 0">Insentif & lembur dibayarkan bersama gaji tanggal ${B.toko.periode_mulai} lewat menu <a href="#gaji" id="keGaji"><b>Gaji</b></a>.</p>
      <p class="small muted" style="margin:4px 0 0">Total = insentif produksi + insentif lain + lembur (${B.toko.lembur_per_jam ? rp(B.toko.lembur_per_jam) + "/jam" : "upah lembur belum diatur"}). Tarif ${rp(B.toko.insentif)} per produk, periode tanggal ${B.toko.periode_mulai} s/d ${B.toko.periode_mulai - 1 || "akhir bulan"}.${isAdmin() ? " Ubah di Pengaturan; tarif khusus per produk diisi di menu Stok." : ""}</p>`;
    $$("[data-slip]").forEach(bt => bt.onclick = () => slipInsentif(rek, rows.find(r => r.pembuat_id === +bt.dataset.slip)));
    $("#keGaji").onclick = e => { e.preventDefault(); gPer = pPer; pindah("gaji"); };
    }
    $("#pLog").innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Tanggal</th><th>Barang</th><th class="r">Qty</th><th>Pembuat</th>${isAdmin() ? `<th class="r">Insentif</th>` : ""}<th></th></tr></thead><tbody>
      ${log.length ? log.map(x => { const bolehHapus = !x.dibayar && (isAdmin() || (x.user_id === B.me.id && x.tgl === today()));
        return `<tr><td class="small">${tglPendek(x.tgl)}</td><td>${esc(x.nama)} <span class="code">${x.kode || ""}</span>${x.restock ? "" : ' <span class="pill mut">pesanan</span>'}</td><td class="r num">${fq(x.qty)}</td><td>${esc(x.pembuat)}</td>${isAdmin() ? `<td class="r num">${rp(x.qty * x.tarif)}</td>` : ""}
          <td class="r" style="white-space:nowrap">${bolehHapus ? `<button class="btn sm" data-ubah="${x.id}" type="button">Ubah</button> <button class="btn ghost sm" data-del="${x.id}" type="button">Hapus</button>` : x.dibayar ? `<span class="small muted">dibayar</span>` : ""}</td></tr>`; }).join("")
        : `<tr><td colspan="6" class="empty">Belum ada catatan produksi di periode ini.</td></tr>`}</tbody></table></div>`;
    $$("[data-ubah]").forEach(bt => bt.onclick = () => ubahProduksi(log.find(p => p.id === +bt.dataset.ubah)));
    $$("[data-del]").forEach(bt => bt.onclick = () => { const x = log.find(p => p.id === +bt.dataset.del);
      konfirmasi("Hapus catatan produksi?", `${x.nama} ×${fq(x.qty)} oleh ${x.pembuat}.${x.restock ? " Stok ready ikut dikurangi." : ""}`, "Hapus",
        () => coba(async () => { await api("DELETE", `/api/produksi/${x.id}`); await muatUlang(); vProduksi(); })); });
    $("#ilLog").innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Karyawan</th><th>Keterangan</th>${isAdmin() ? `<th class="r">Nominal</th>` : ""}<th></th></tr></thead><tbody>
      ${lain.length ? lain.map(x => { const bolehHapus = !x.dibayar && (isAdmin() || (x.oleh_id === B.me.id && x.tgl === today()));
        return `<tr><td class="small">${tglPendek(x.tgl)}</td><td>${JENIS_LAIN[x.jenis] || esc(x.jenis)}</td><td>${esc(x.nama)}</td><td class="small">${esc(x.ket || "")}</td>${isAdmin() ? `<td class="r num">${rp(x.nominal)}</td>` : ""}<td class="r">${bolehHapus ? `<button class="btn ghost sm" data-del-lain="${x.id}" type="button">Hapus</button>` : ""}</td></tr>`; }).join("")
        : `<tr><td colspan="6" class="empty">Belum ada insentif lain di periode ini.</td></tr>`}</tbody></table></div>`;
    $$("[data-del-lain]").forEach(bt => bt.onclick = () => { const x = lain.find(p => p.id === +bt.dataset.delLain);
      konfirmasi("Hapus insentif lain?", `${(JENIS_LAIN[x.jenis] || x.jenis).replace(/^\S+ /, "")}${x.nominal != null ? " " + rp(x.nominal) : ""} untuk ${x.nama}.`, "Hapus",
        () => coba(async () => { await api("DELETE", `/api/insentif-lain/${x.id}`); vProduksi(); })); });
  });
}
/** Ubah catatan produksi yang salah input: produk, pembuat, atau jumlah (stok ready ikut dikoreksi). */
function ubahProduksi(x){
  if (!x) return;
  modal(`<h3>Ubah catatan produksi</h3><p class="small muted" style="margin:0">${tglID(x.tgl)}${x.restock ? " · stok ready ikut dikoreksi otomatis" : ""}</p>
    <div class="stack">
      <label class="f">Produk<input type="text" id="upI" list="prodList" value="${x.kode ? esc(x.kode + " · " + x.nama) : esc(x.nama)}" autocomplete="off" ${x.kode ? "" : "disabled"}></label>
      ${x.kode ? "" : `<p class="small muted" style="margin:0">Barang custom dari kasir: nama barang tidak bisa diganti di sini, tapi pembuat & jumlahnya bisa.</p>`}
      <div class="row"><label class="f grow">Pembuat<select id="upO">${B.staf.map(s => `<option value="${s.id}" ${s.id === x.pembuat_id ? "selected" : ""}>${esc(s.nama)}</option>`).join("")}</select></label>
        <label class="f" style="width:100px">Qty<input type="number" id="upQ" value="${x.qty}" min="0" step="1" inputmode="numeric"></label></div>
    </div>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="upOk" type="button">Simpan perubahan</button></div>`, m => {
    $("#upOk", m).onclick = e => {
      const body = { pembuat_id: +$("#upO", m).value, qty: num($("#upQ", m).value) };
      if (!body.qty) return toast("Isi jumlah");
      if (x.kode) {
        const v = $("#upI", m).value.trim(), kode = v.split("·")[0].trim().toUpperCase();
        const pr = B.produk.find(p => p.kode === kode) || cariScan(v)?.x;
        if (!pr || !B.produk.includes(pr)) return toast(`Produk "${v}" tidak ditemukan. Pilih dari daftar.`);
        body.product_id = pr.id;
      }
      coba(async () => { await api("PUT", `/api/produksi/${x.id}`, body); closeModal(); toast("Catatan produksi diubah"); await muatUlang(); vProduksi(); }, e.target);
    };
  });
}
function slipLines(rek, r){
  const w = lebar(), garis = "-".repeat(w), L = [];
  L.push({ t: center(B.toko.nama_toko, w), b: 1 }, { t: center("SLIP INSENTIF", w), b: 1 }, { t: garis });
  L.push({ t: lr("Nama", r.nama, w) }, { t: lr("Periode", tglPendek(rek.dari) + "-" + tglPendek(rek.sampai), w) }, { t: garis });
  r.detail.forEach(x => { wrap(x.nama, w).forEach(l => L.push({ t: l })); L.push({ t: lr(`  ${fq(x.qty)} x ${angka(x.tarif)}`, angka(x.qty * x.tarif), w) }); });
  if (r.qty) L.push({ t: garis }, { t: lr("Produksi " + fq(r.qty) + " pcs", "Rp" + angka(r.insentif), w) });
  if (r.lain) { L.push({ t: garis }); (r.lainDetail || []).forEach(d => L.push({ t: lr(`${d.label} ${d.kali}x`, "Rp" + angka(d.nominal), w) })); }
  if (r.lembur_menit) L.push({ t: garis }, { t: lr("Lembur " + jamMenit(r.lembur_menit), "Rp" + angka(r.lembur_rp || 0), w) });
  L.push({ t: garis }, { t: lr("TOTAL INSENTIF", "Rp" + angka(r.total ?? r.insentif), w), b: 1 });
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
    <p class="muted">Periode ${tglID(rek.dari)} – ${tglID(rek.sampai)}</p>
    <div class="list">
      <div class="li"><div class="main">Insentif produksi <span class="small muted">${fq(r.qty)} pcs</span></div><b class="num">${rp(r.insentif)}</b></div>
      ${(r.lainDetail || []).map(d => `<div class="li"><div class="main">${esc(d.label)} <span class="small muted">${d.kali}×</span></div><b class="num">${rp(d.nominal)}</b></div>`).join("")}
      ${r.lembur_menit ? `<div class="li"><div class="main">Lembur <span class="small muted">${jamMenit(r.lembur_menit)}</span></div><b class="num">${rp(r.lembur_rp)}</b></div>` : ""}
      <div class="li"><div class="main"><b>Total</b></div><b class="num">${rp(r.total)}</b></div>
    </div>
    <div class="stack">
      <label class="f">Nominal dibayar<input type="number" id="bN" value="${r.total}" min="0" step="500" inputmode="numeric"></label>
      <label class="f">Tanggal bayar<input type="date" id="bT" value="${today()}"></label>
      <label class="f">Catatan (bonus, potongan, dll)<input type="text" id="bK"></label>
      <label class="row small"><input type="checkbox" id="bE" checked> Catat juga di Pengeluaran (kategori Insentif Produksi)</label>
      <p class="note">Setelah ditandai dibayar, catatan produksi & insentif lain ${esc(r.nama)} di periode ini terkunci.</p>
    </div>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="bOk">Tandai sudah dibayar</button></div>`, m => {
      $("#bOk", m).onclick = e => coba(async () => {
        await api("POST", "/api/insentif/bayar", { pembuat_id: r.pembuat_id, periode_dari: rek.dari, nominal: num($("#bN", m).value), tgl: $("#bT", m).value, ket: $("#bK", m).value, catat_pengeluaran: $("#bE", m).checked });
        closeModal(); toast(`Insentif ${r.nama} tercatat dibayar`); vProduksi();
      }, e.target);
    });
}

/* ================= STOK ================= */
let sJenis = "produk", sQ = "", sFil = "SEMUA", sKat = "SEMUA", sUbah = false, sBaru = {};
function vStok(){
  const isP = sJenis === "produk", arr = isP ? B.produk : B.bahan;
  const kats = ["SEMUA", ...new Set(arr.map(x => x.kategori).filter(Boolean))];
  if (!kats.includes(sKat)) sKat = "SEMUA";
  $("#main").innerHTML = `
    <div class="view-head"><h2>Stok</h2>
      <div class="seg" id="sJ"><button type="button" data-j="produk" class="${isP ? "on" : ""}">Produk jadi</button><button type="button" data-j="bahan" class="${!isP ? "on" : ""}">Bahan baku</button></div>
      <span class="sp"></span>${isAdmin() ? `<button class="btn ${sUbah ? "pri" : ""}" id="sUbahBtn" type="button">✏️ ${sUbah ? "Sedang ubah stok" : "Ubah stok manual"}</button>` : ""}<button class="btn" id="sLbl" type="button">Cetak label barcode</button>${isAdmin() ? `<button class="btn pri" id="sAdd" type="button">+ ${isP ? "Produk" : "Bahan"} baru</button>` : ""}</div>
    ${sUbah ? `<div class="panel stok-ubah-bar"><div class="row" style="align-items:center">
      <span style="flex:1" class="small">Ketik stok baru di kolom <b>Stok</b>. Yang diubah ditandai kuning. <span id="sJml"></span></span>
      <button class="btn sm" id="sNol" type="button">Nolkan yang tampil</button><button class="btn sm" id="sBatal" type="button">Batal</button><button class="btn sm pri" id="sSimpan" type="button">Simpan stok</button></div></div>` : ""}
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
  if ($("#sUbahBtn")) $("#sUbahBtn").onclick = () => { if (sUbah && Object.keys(sBaru).length && !confirm("Batalkan perubahan stok yang belum disimpan?")) return; sUbah = !sUbah; sBaru = {}; vStok(); };
  if (sUbah) {
    $("#sBatal").onclick = () => { sUbah = false; sBaru = {}; vStok(); };
    $("#sNol").onclick = () => { $$("#sBody input.sIn").forEach(i => { i.value = 0; i.dispatchEvent(new Event("input")); }); };
    $("#sSimpan").onclick = e => {
      const items = Object.entries(sBaru).map(([id, v]) => ({ id: +id, fisik: v }));
      if (!items.length) return toast("Belum ada stok yang diubah");
      coba(async () => {
        for (let i = 0; i < items.length; i += 1500) await api("POST", "/api/opname", { jenis: sJenis, ket: "Ubah stok manual", items: items.slice(i, i + 1500) });
        toast(`${items.length} stok ${sJenis === "produk" ? "produk" : "bahan"} diperbarui`); sUbah = false; sBaru = {}; await muatUlang(); vStok();
      }, e.target);
    };
  }
  $("#sLbl").onclick = () => modalLabel();
  drawStok();
}
function drawStok(){
  const isP = sJenis === "produk", arr = isP ? B.produk : B.bahan, q = sQ.trim().toUpperCase();
  const list = arr.filter(x => (!q || x.nama.toUpperCase().includes(q) || x.kode.includes(q) || (x.barcode || "").includes(q)) && (sKat === "SEMUA" || x.kategori === sKat) && (sFil === "SEMUA" || (sFil === "MINUS" ? x.stok < 0 : statusStok(x.stok, x.stok_min)[0] === sFil)));
  const nilai = arr.reduce((a, x) => a + Math.max(0, x.stok) * (isP ? (x.hpp ?? 0) : x.harga), 0);
  const sedikit = arr.filter(x => x.stok > 0 && x.stok <= (x.stok_min || 0)).length, minus = arr.filter(x => x.stok < 0).length;
  $("#sKpi").innerHTML = `<div class="kpi"><div class="l">Jumlah item</div><div class="v num">${arr.length}</div></div>${isAdmin() || !isP ? `<div class="kpi"><div class="l">${isP ? "Nilai stok (HPP)" : "Nilai aset bahan"}</div><div class="v num">${rp(nilai)}</div></div>` : ""}<div class="kpi"><div class="l">Stok sedikit</div><div class="v num" style="color:var(--warn)">${sedikit}</div></div><div class="kpi"><div class="l">Stok minus</div><div class="v num" style="color:var(--bad)">${minus}</div></div>`;
  $("#sBody").innerHTML = list.length ? list.map(x => { const [st, cl] = statusStok(x.stok, x.stok_min); return `<tr class="click" data-id="${x.id}"><td class="code">${x.kode}</td><td>${esc(x.nama)}${isP && !x.aktif ? ' <span class="pill mut">nonaktif</span>' : ""}</td><td class="code">${esc(x.barcode || "")}</td><td class="small muted">${esc(x.kategori || "-")}</td><td class="r num">${x.harga ? rp(x.harga) : "-"}</td>${sUbah ? `<td class="r"><input type="number" class="sIn num ${sBaru[x.id] != null ? "berubah" : ""}" data-id="${x.id}" data-lama="${x.stok}" value="${sBaru[x.id] ?? x.stok}" step="any" inputmode="decimal" style="width:96px;text-align:right" aria-label="Stok ${esc(x.nama)}"></td>` : `<td class="r num" style="font-weight:700;${x.stok < 0 ? "color:var(--bad)" : ""}">${fq(x.stok)}</td>`}<td><span class="pill ${cl}">${st}</span></td></tr>`; }).join("") : `<tr><td colspan="7" class="empty">Tidak ada data yang cocok.</td></tr>`;
  $$("#sBody tr.click").forEach(r => r.onclick = e => { if (sUbah) return; bukaItem(sJenis, +r.dataset.id); });
  if (sUbah) {
    const hitungUbah = () => { const n = Object.keys(sBaru).length; const j = $("#sJml"); if (j) j.innerHTML = n ? `<b>${n} barang diubah</b>` : ""; };
    $$("#sBody input.sIn").forEach(i => {
      i.onclick = e => e.stopPropagation();
      i.oninput = () => { const v = i.value === "" ? null : Number(i.value);
        if (v == null || !isFinite(v) || v === Number(i.dataset.lama)) delete sBaru[i.dataset.id]; else sBaru[i.dataset.id] = v;
        i.classList.toggle("berubah", sBaru[i.dataset.id] != null); hitungUbah(); };
    });
    hitungUbah();
  }
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
    <div class="view-head"><h2>Pengeluaran</h2><span class="sp"></span><input type="month" id="bB" value="${bBulan}" style="width:auto" aria-label="Bulan"><button class="btn sm" id="bCsv" type="button">Unduh CSV</button></div>
    <div class="grid2" style="align-items:start">
      <section class="panel stack">
        <div class="row"><label class="f grow">Tanggal<input type="date" id="xT" value="${today()}"></label><label class="f grow">Kategori<select id="xK">${B.katPengeluaran.map(k => `<option>${k}</option>`).join("")}</select></label></div>
        <label class="f">Keterangan singkat (wajib)<input type="text" id="xD" maxlength="200" placeholder="Contoh: beli mawar merah 2 ikat"></label>
        <label class="f">Nominal (Rp)<input type="number" id="xN" min="0" step="500" inputmode="numeric"></label>
        <button class="btn pri big" id="xSave" type="button">Simpan pengeluaran</button>
      </section>
      <section class="stack" style="min-width:0" id="bList"><div class="empty">Memuat…</div></section>
    </div>`;
  $("#bB").onchange = e => { bBulan = e.target.value || today().slice(0, 7); vBiaya(); };
  $("#xSave").onclick = e => coba(async () => {
    const nominal = num($("#xN").value); if (!nominal) return toast("Isi nominal");
    if (!$("#xD").value.trim()) return toast("Tulis keterangan singkat pengeluaran");
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
      <div class="list">${list.length ? list.map(e => `<div class="li"><div class="main"><div class="t">${esc(e.ket || e.kategori)}</div><div class="small muted">${tglPendek(e.tgl)} · ${esc(e.kategori)} · ${esc(e.oleh)}${e.sumber ? ` · <span class="pill mut">otomatis dari ${e.sumber === "gaji" ? "Gaji" : e.sumber === "kasbon" ? "Kasbon" : "Insentif"}</span>` : ""}</div></div><div class="num" style="font-weight:700">${rp(e.nominal)}</div>${e.sumber ? "" : `<button class="btn ghost sm" data-id="${e.id}" type="button">Hapus</button>`}</div>`).join("") : `<div class="empty">Belum ada pengeluaran bulan ini.</div>`}</div>`;
    $("#bCsv").onclick = () => unduhCSV(`pengeluaran-${bBulan}.csv`, [["Tanggal", "Kategori", "Keterangan", "Nominal", "Dicatat oleh"], ...list.slice().reverse().map(e => [e.tgl, e.kategori, e.ket, e.nominal, e.oleh])]);
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
        <div class="row"><button class="btn" id="pTest" type="button">Cetak struk uji</button><button class="btn" id="pKartu" type="button">Cetak kartu uji</button></div>
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
      <section class="panel stack" id="aWa"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aCanva"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aKartu"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aNota"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aSync"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aJam"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aAbsen"><div class="empty">Memuat…</div></section>
      <section class="panel stack" id="aReset"><div class="empty">Memuat…</div></section>
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
      ${TAG_PEMBUAT}
    </div>`;
  if (NATIVE) aturMode();
  $("#pK").onchange = e => { D.kertas = +e.target.value; simpanD(); vAtur(); };
  $("#pM").onchange = e => { D.modeCetak = e.target.value; D.modeDipilih = true; simpanD(); vAtur(); };
  $("#thm").onchange = e => { D.tema = e.target.value; simpanD(); terapkanTema(); };
  $("#pTest").onclick = () => cetak({ no: B.toko.prefix + "UJI", tgl: today(), jam: "00:00", kasir: B.me.nama, pelanggan: "UJI CETAK", hp: "", items: [{ nama: "BUKET BUNGA 100K", harga: 100000, qty: 1 }, { nama: "COKLAT SILVERQUEEN", harga: 15000, qty: 2 }], subtotal: 130000, diskon: 0, ongkir: 0, total: 130000, metode: "Tunai", bayar: 150000, catatan: "" });
  $("#pKartu").onclick = () => cetakKartu("Happy Birthday!\nSemoga panjang umur, sehat selalu,\ndan bahagia.\n\nDari: Rina");
  $("#pwSave").onclick = e => coba(async () => { await api("POST", "/api/akun/password", { lama: $("#pwL").value, baru: $("#pwB").value }); $("#pwL").value = $("#pwB").value = ""; toast("Password diganti"); }, e.target);
  if (!isAdmin()) return;
  aturToko(); aturUser(); aturWA(); aturCanva(); aturKartu(); aturNota(); aturSync(); aturCabang(); aturJam(); aturAbsen(); aturReset();
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
/** Pilihan aplikasi di perangkat ini (Android): keterangan terpasang / belum. */
const ketAplikasi = paket => !NATIVE || !NATIVE.adaAplikasi ? "" : NATIVE.adaAplikasi(paket) ? " ✓ terpasang" : " — belum terpasang";

/** WhatsApp: nomor toko, aplikasi yang dipakai di perangkat ini, dan pesan ucapan terima kasih. */
async function aturWA(){
  const s = await coba(() => api("GET", "/api/pengaturan")); if (!s || !$("#aWa")) return;
  const pusat = LOKAL && B.cabang;
  $("#aWa").innerHTML = `<h3 style="font-size:17px">💬 WhatsApp</h3>
    ${pusat ? `<p class="note" style="margin:0">Nomor & pesan diatur di server (browser), lalu otomatis ikut ke sini. Aplikasi WhatsApp bisa dipilih untuk perangkat ini.</p>` : ""}
    <label class="f">Nomor WA toko<input type="tel" id="waNo" value="${esc(s.wa_nomor || s.telp || "")}" placeholder="08…" ${pusat ? "disabled" : ""}></label>
    <p class="small muted" style="margin:0">Bisa diganti kapan saja. Dipakai untuk kode <code>{wa_toko}</code> di pesan dan tombol tes. Pesan ke pelanggan terkirim dari akun WhatsApp yang sedang masuk di HP/perangkat yang dipakai.</p>
    ${bisaPilihAplikasi() ? `<label class="f">Kirim pakai aplikasi (perangkat ini)<select id="waApp">
        <option value="" ${!D.waApp ? "selected" : ""}>Tanya / pilihan Android</option>
        <option value="wa" ${D.waApp === "wa" ? "selected" : ""}>WhatsApp${ketAplikasi(PAKET.wa)}</option>
        <option value="wab" ${D.waApp === "wab" ? "selected" : ""}>WhatsApp Business${ketAplikasi(PAKET.wab)}</option></select></label>`
      : NATIVE ? `<p class="small muted" style="margin:0">Untuk memilih WhatsApp / WhatsApp Business, pasang aplikasi versi terbaru (Pengaturan → Periksa pembaruan).</p>` : ""}
    <label class="row"><input type="checkbox" id="waAuto" ${s.wa_otomatis ? "checked" : ""} ${pusat ? "disabled" : ""}> <b>Kirim ucapan terima kasih otomatis setelah transaksi</b></label>
    <label class="f">Isi pesan<textarea id="waTpl" rows="7" ${pusat ? "disabled" : ""}>${esc(s.wa_template)}</textarea></label>
    <p class="small muted" style="margin:0">Kode otomatis: <code>{nama}</code> · <code>{toko}</code> · <code>{no}</code> · <code>{tanggal}</code> · <code>{total}</code> · <code>{barang}</code> · <code>{struk}</code> · <code>{wa_toko}</code><br>Keterangan pesanan: <code>{pesanan}</code> (DP, sisa, jadwal ambil/antar, request, catatan, ucapan — otomatis hanya yang ada isinya) · <code>{dp}</code> · <code>{sisa}</code> · <code>{ambil}</code> · <code>{request}</code> · <code>{catatan}</code> · <code>{ucapan}</code></p>
    <div class="row"><button class="btn sm" id="waLihat" type="button">Lihat contoh pesan</button><button class="btn sm" id="waUji" type="button">Kirim tes ke nomor ini</button></div>
    ${pusat ? "" : `<button class="btn pri" id="waSimpan" type="button">Simpan pengaturan WhatsApp</button>`}`;
  const sel = $("#waApp"); if (sel) sel.onchange = e => { D.waApp = e.target.value; simpanD(); toast("Aplikasi WhatsApp perangkat ini disimpan"); };
  $("#waLihat").onclick = () => {
    const simpan = { ...B.toko }; B.toko.wa_template = $("#waTpl").value; B.toko.wa_nomor = $("#waNo").value;
    const contoh = pesanWA({ no: B.toko.prefix + "000001234", tgl: today(), jam: "10:00", kasir: B.me.nama, pelanggan: "BU ANI", hp: "0812", items: [{ nama: "BUKET BUNGA 100K", harga: 100000, qty: 1 }], subtotal: 100000, diskon: 0, ongkir: 0, total: 100000, metode: "Tunai", bayar: 100000, catatan: "" });
    B.toko = simpan;
    modal(`<h3>Contoh pesan</h3><pre class="receipt-prev" style="white-space:pre-wrap">${esc(contoh)}</pre><div class="actions"><button class="btn" data-close>Tutup</button></div>`);
  };
  $("#waUji").onclick = () => { const no = nomorWA($("#waNo").value); if (!no) return toast("Isi nomor WA dulu"); bukaWA(no, "Tes pesan dari Rich Gallery POS ✅"); };
  const sv = $("#waSimpan"); if (sv) sv.onclick = e => coba(async () => {
    await api("PUT", "/api/pengaturan", { wa_nomor: $("#waNo").value.trim(), wa_template: $("#waTpl").value, wa_otomatis: $("#waAuto").checked });
    await muatUlang(); toast("Pengaturan WhatsApp tersimpan"); aturWA();
  }, e.target);
}

/** Kartu ucapan: ukuran sama dengan desain Canva, latar dari desain Canva (opsional), gaya teks. */
async function aturKartu(){
  const s = await coba(() => api("GET", "/api/pengaturan")); if (!s || !$("#aKartu")) return;
  const pusat = LOKAL && B.cabang, dis = pusat ? "disabled" : "";
  let latarBaru; // undefined = tidak berubah, "" = dihapus, data URL = baru
  $("#aKartu").innerHTML = `<h3 style="font-size:17px">💌 Kartu ucapan</h3>
    <p class="small muted" style="margin:0">Teks ucapan dari pelanggan (kolom <b>Kartu ucapan</b> di kasir) dicetak di kartu dengan ukuran yang sama seperti desain Canva. Lihat ukurannya di Canva: <b>Ubah ukuran</b> / <b>File → Lihat pengaturan</b>.</p>
    ${pusat ? `<p class="note" style="margin:0">Diatur di server (browser), lalu otomatis ikut ke perangkat ini.</p>` : ""}
    <div class="row"><label class="f grow">Lebar (mm)<input type="number" id="kaL" value="${s.kartu_lebar}" min="30" max="300" step="0.5" ${dis}></label><label class="f grow">Tinggi (mm)<input type="number" id="kaT" value="${s.kartu_tinggi}" min="30" max="300" step="0.5" ${dis}></label></div>
    <p class="small muted" style="margin:0">Bila ukuran di Canva dalam cm, kalikan 10 (10 cm = 100 mm). Dalam inci, kalikan 25,4. Dalam px (96 dpi), bagi 3,78.</p>
    <div class="row"><label class="f grow">Huruf<select id="kaH" ${dis}><option value="grown" ${s.kartu_huruf === "grown" ? "selected" : ""}>Grown (mirip, seperti di Canva)</option><option value="kustom" ${s.kartu_huruf === "kustom" ? "selected" : ""}>Font unggahan sendiri${s.kartu_font_kode ? "" : " (belum ada)"}</option><option value="script" ${s.kartu_huruf === "script" ? "selected" : ""}>Tulisan indah (script)</option><option value="serif" ${s.kartu_huruf === "serif" ? "selected" : ""}>Klasik (serif)</option><option value="sans" ${s.kartu_huruf === "sans" ? "selected" : ""}>Modern (sans)</option></select></label>
      <label class="f grow">Warna teks<input type="color" id="kaW" value="${esc(s.kartu_warna || "#3a2a2a")}" ${dis} style="height:44px"></label>
      <label class="f grow">Posisi teks<select id="kaA" ${dis}>${[["desain", "Bagian kosong desain (otomatis)"], ["tengah", "Tengah"], ["atas", "Setengah atas"], ["bawah", "Setengah bawah"], ["kiri", "Setengah kiri"], ["kanan", "Setengah kanan"]].map(([v, l]) => `<option value="${v}" ${s.kartu_area === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <p class="small muted" style="margin:0">"Grown" adalah font khusus Canva yang tidak bisa diunduh, jadi dipakai huruf gratis yang paling mirip (Gloock). Bila punya file font sendiri (.ttf / .otf), unggah di sini lalu pilih <b>Font unggahan sendiri</b>.</p>
    ${pusat ? "" : `<div class="row"><label class="btn sm" for="kaFont">Unggah file font</label><input type="file" id="kaFont" accept=".ttf,.otf,.woff,.woff2,font/*" hidden><span class="small muted" id="kaFontKet">${s.kartu_font_kode ? "Font sendiri sudah tersimpan." : ""}</span></div>`}
    <p class="small" style="margin:0"><b>Latar desain (opsional):</b> di Canva tekan <b>Bagikan → Unduh → PNG/JPG</b>, lalu pilih file itu di sini. Ucapan pelanggan dicetak di atas desain tersebut. Pilih posisi teks di bagian kosong desain.</p>
    ${pusat ? "" : `<div class="row"><button class="btn sm" id="kaPita" type="button">🎀 Pakai desain pita Rich Gallery (120 × 90 mm)</button></div>`}
    ${pusat ? "" : `<div class="row"><label class="btn sm" for="kaFile">Pilih gambar desain</label><input type="file" id="kaFile" accept="image/png,image/jpeg" hidden><button class="btn sm ghost" id="kaHapus" type="button" ${s.kartu_latar_kode ? "" : "hidden"}>Hapus latar</button></div>`}
    <div class="kartu-pratinjau"><canvas id="kaCv"></canvas></div>
    ${pusat ? "" : `<button class="btn pri" id="kaSimpan" type="button">Simpan pengaturan kartu</button>`}`;
  const opsi = () => ({ kartu_lebar: num($("#kaL").value) || 100, kartu_tinggi: num($("#kaT").value) || 70, kartu_huruf: $("#kaH").value, kartu_warna: $("#kaW").value, kartu_area: $("#kaA").value });
  let latarImg = await ambilLatarKartu(), fontBaru, latarKode = s.kartu_latar_kode || "";
  const contoh = async () => { const c = await gambarKartu("Happy Birthday, Sinta!\nSemoga panjang umur, sehat selalu, dan semua impianmu tercapai.\n\nDari: Rina", { ...opsi(), latarImg, latarKode, fontData: fontBaru }); const cv = $("#kaCv"); if (!cv) return; cv.width = c.width; cv.height = c.height; cv.getContext("2d").drawImage(c, 0, 0); };
  $$("#aKartu input:not([type=file]), #aKartu select").forEach(i => i.oninput = i.onchange = contoh);
  const f = $("#kaFile"); if (f) f.onchange = e => { const file = e.target.files[0]; if (!file) return; e.target.value = "";
    const r = new FileReader(); r.onload = async () => {
      const img = await muatGambar(String(r.result)); if (!img) return toast("Gambar tidak terbaca");
      const o = opsi(), W = Math.round(o.kartu_lebar * PX_MM), H = Math.round(o.kartu_tinggi * PX_MM);
      const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
      const sk = Math.max(W / img.width, H / img.height); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.drawImage(img, (W - img.width * sk) / 2, (H - img.height * sk) / 2, img.width * sk, img.height * sk);
      let q = 0.88; latarBaru = c.toDataURL("image/jpeg", q); while (latarBaru.length > 1_300_000 && q > 0.4) { q -= 0.1; latarBaru = c.toDataURL("image/jpeg", q); }
      latarImg = await muatGambar(latarBaru); latarKode = "unggah"; $("#kaHapus").hidden = false; if ($("#kaA").value === "desain") $("#kaA").value = "tengah";
      if (Math.abs(img.width / img.height - W / H) > 0.03) toast("Perbandingan gambar berbeda dengan ukuran kartu — gambar dipotong menyesuaikan. Periksa ukuran kartu.");
      contoh();
    }; r.readAsDataURL(file); };
  const hp = $("#kaHapus"); if (hp) hp.onclick = () => { latarBaru = ""; latarImg = null; latarKode = ""; hp.hidden = true; contoh(); };
  const kp = $("#kaPita"); if (kp) kp.onclick = async () => {
    const bw = LATAR_BAWAAN.pita; latarBaru = "bawaan:pita"; latarKode = "bawaan:pita"; latarImg = await muatGambar(bw.src);
    $("#kaL").value = bw.lebar; $("#kaT").value = bw.tinggi; $("#kaA").value = "desain"; $("#kaHapus").hidden = false; contoh();
    toast("Desain pita dipilih. Tekan Simpan pengaturan kartu.");
  };
  const ff = $("#kaFont"); if (ff) ff.onchange = e => { const file = e.target.files[0]; if (!file) return; e.target.value = "";
    if (file.size > 1_400_000) return toast("File font terlalu besar (maks ± 1,4 MB)");
    const r = new FileReader(); r.onload = () => { fontBaru = String(r.result); $("#kaH").value = "kustom"; $("#kaFontKet").textContent = file.name + " — belum disimpan"; contoh(); }; r.readAsDataURL(file); };
  const sv = $("#kaSimpan"); if (sv) sv.onclick = e => coba(async () => {
    const body = opsi(); if (latarBaru !== undefined) body.kartu_latar = latarBaru; if (fontBaru) body.kartu_font = fontBaru;
    await api("PUT", "/api/pengaturan", body); await muatUlang(); latarKartu = { kode: "", img: null }; toast("Pengaturan kartu tersimpan"); aturKartu();
  }, e.target);
  contoh();
}

/** Nota / invoice A4: keterangan toko, rekening, dan tanda tangan elektronik (digambar langsung di layar). */
async function aturNota(){
  const s = await coba(() => api("GET", "/api/pengaturan")); if (!s || !$("#aNota")) return;
  const pusat = LOKAL && B.cabang;
  $("#aNota").innerHTML = `<h3 style="font-size:17px">📄 Nota / Invoice (setengah A4)</h3>
    <p class="small muted" style="margin:0">Format nota seperti invoice toko. Dibuka dari struk transaksi → <b>📄 Nota</b>; isinya bisa diedit sebelum diunduh (gambar / PDF) atau dicetak. Lebar setengah A4 (210 mm), tingginya mengikuti jumlah barang.</p>
    ${pusat ? `<p class="note" style="margin:0">Diatur di server (browser), lalu otomatis ikut ke perangkat ini.</p>` : ""}
    <label class="f">Keterangan di bawah nama toko<input type="text" id="ivTag" value="${esc(s.inv_tagline)}" ${pusat ? "disabled" : ""}></label>
    <label class="f">Info rekening (kiri bawah)<textarea id="ivBank" rows="2" ${pusat ? "disabled" : ""}>${esc(s.inv_bank)}</textarea></label>
    <div class="row"><label class="f grow">Nama penanda tangan<input type="text" id="ivNama" value="${esc(s.inv_ttd_nama)}" ${pusat ? "disabled" : ""}></label><label class="f grow">Jabatan<input type="text" id="ivJab" value="${esc(s.inv_ttd_jabatan)}" ${pusat ? "disabled" : ""}></label></div>
    <div class="small"><b>Tanda tangan elektronik</b> — ${esc(s.inv_ttd_nama || "penanda tangan")} menggambar tanda tangannya sendiri di kotak ini (jari / mouse / pena).</div>
    <div class="ttd-kotak"><canvas id="ivPad" width="560" height="200" aria-label="Kotak tanda tangan"></canvas>${s.inv_ttd ? `<img id="ivLama" src="${s.inv_ttd}" alt="Tanda tangan tersimpan">` : ""}</div>
    <div class="row">${pusat ? "" : `<button class="btn sm" id="ivUlang" type="button">${s.inv_ttd ? "Gambar ulang" : "Hapus coretan"}</button>${s.inv_ttd ? `<button class="btn sm danger" id="ivHapus" type="button">Hapus tanda tangan</button>` : ""}`}</div>
    ${pusat ? "" : `<button class="btn pri" id="ivSimpan" type="button">Simpan pengaturan nota</button>`}`;
  if (pusat) return;
  const pad = $("#ivPad"), g = pad.getContext("2d"), lama = $("#ivLama");
  let ada = false, coret = false, minX = 1e9, minY = 1e9, maxX = 0, maxY = 0;
  g.lineWidth = 3.2; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#14213d";
  const titik = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  const catat = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  pad.style.touchAction = "none";
  pad.onpointerdown = e => { if (lama) lama.hidden = true; coret = true; ada = true; pad.setPointerCapture?.(e.pointerId); const [x, y] = titik(e); catat(x, y); g.beginPath(); g.moveTo(x, y); };
  pad.onpointermove = e => { if (!coret) return; const [x, y] = titik(e); catat(x, y); g.lineTo(x, y); g.stroke(); };
  pad.onpointerup = pad.onpointercancel = () => { coret = false; };
  const kosongkan = () => { g.clearRect(0, 0, pad.width, pad.height); ada = false; minX = minY = 1e9; maxX = maxY = 0; };
  $("#ivUlang").onclick = () => { kosongkan(); if (lama) lama.hidden = true; };
  const hp = $("#ivHapus"); if (hp) hp.onclick = () => konfirmasi("Hapus tanda tangan?", "Nota akan menampilkan nama penanda tangan saja.", "Hapus", () => coba(async () => { await api("PUT", "/api/pengaturan", { inv_ttd: "" }); await muatUlang(); aturNota(); }));
  $("#ivSimpan").onclick = e => coba(async () => {
    const body = { inv_tagline: $("#ivTag").value, inv_bank: $("#ivBank").value, inv_ttd_nama: $("#ivNama").value, inv_ttd_jabatan: $("#ivJab").value };
    if (ada && maxX > minX) { // potong ke area coretan supaya ringan
      const p = 8, x = Math.max(0, minX - p), y = Math.max(0, minY - p), w = Math.min(pad.width, maxX + p) - x, h = Math.min(pad.height, maxY + p) - y;
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(pad, x, y, w, h, 0, 0, w, h);
      body.inv_ttd = c.toDataURL("image/png");
    }
    await api("PUT", "/api/pengaturan", body); await muatUlang(); toast("Pengaturan nota tersimpan"); aturNota();
  }, e.target);
}

/** Canva: link desain kartu, akun, dan cara membuka di perangkat ini (aplikasi / browser). */
async function aturCanva(){
  const s = await coba(() => api("GET", "/api/pengaturan")); if (!s || !$("#aCanva")) return;
  const pusat = LOKAL && B.cabang;
  $("#aCanva").innerHTML = `<h3 style="font-size:17px">🎨 Canva — kartu ucapan</h3>
    ${pusat ? `<p class="note" style="margin:0">Link & akun Canva diatur di server (browser), lalu otomatis ikut ke sini. Cara membuka bisa dipilih untuk perangkat ini.</p>` : ""}
    <p class="small muted" style="margin:0">Buka desain kartu toko di Canva → <b>Bagikan → Salin link</b>, lalu tempel di sini. Di kasir, tombol <b>Buka Canva</b> menyalin isi kartu lalu membuka desain ini: tinggal tempel teksnya.</p>
    <label class="f">Link desain / template Canva<input type="url" id="cvUrl" value="${esc(s.canva_url || "")}" placeholder="https://www.canva.com/design/…" ${pusat ? "disabled" : ""}></label>
    <label class="f">Email akun Canva toko (pengingat akun yang dipakai)<input type="email" id="cvEmail" value="${esc(s.canva_email || "")}" placeholder="toko@gmail.com" ${pusat ? "disabled" : ""}></label>
    <label class="f">Buka Canva di perangkat ini<select id="cvBuka">
      <option value="aplikasi" ${D.canvaBuka !== "web" ? "selected" : ""}>Aplikasi Canva${NATIVE ? ketAplikasi(PAKET.canva) : " (bila terpasang)"}</option>
      <option value="web" ${D.canvaBuka === "web" ? "selected" : ""}>Browser (canva.com)</option></select></label>
    <p class="small muted" style="margin:0">${NATIVE ? "Aplikasi Canva" : "Di komputer, link Canva dibuka di browser. Aplikasi Canva desktop"} langsung menampilkan desain bila sudah masuk dengan akun${s.canva_email ? " <b>" + esc(s.canva_email) + "</b>" : " Canva toko"}. Bila belum masuk, Canva meminta masuk dulu (sekali saja).${NATIVE && !bisaPilihAplikasi() ? " Untuk memaksa buka di browser, pasang aplikasi versi terbaru." : ""}</p>
    <div class="row"><button class="btn sm" id="cvUji" type="button">Buka Canva</button></div>
    ${pusat ? "" : `<button class="btn pri" id="cvSimpan" type="button">Simpan pengaturan Canva</button>`}`;
  $("#cvBuka").onchange = e => { D.canvaBuka = e.target.value; simpanD(); toast("Disimpan untuk perangkat ini"); };
  $("#cvUji").onclick = () => { const u = $("#cvUrl").value.trim() || B.toko.canva_url; if (!u) return toast("Isi link Canva dulu"); bukaCanva(u); };
  const sv = $("#cvSimpan"); if (sv) sv.onclick = e => coba(async () => {
    await api("PUT", "/api/pengaturan", { canva_url: $("#cvUrl").value.trim(), canva_email: $("#cvEmail").value.trim() });
    await muatUlang(); toast("Pengaturan Canva tersimpan"); aturCanva();
  }, e.target);
}
/** Jam operasional, shift kerja, lembur, dan tarif insentif lain. */
async function aturJam(){
  const el = $("#aJam"); if (!el) return;
  const J = await coba(() => api("GET", "/api/jam-kerja")); if (!J || !$("#aJam")) return;
  const pusat = LOKAL && B.cabang, dis = pusat ? "disabled" : "";
  const barisShift = (x, i) => `<div class="jShift stack" style="gap:6px;border:1px solid var(--line);border-radius:10px;padding:8px">
    <div class="row" style="flex-wrap:nowrap;align-items:center"><input type="text" class="jN" value="${esc(x.nama)}" maxlength="30" aria-label="Nama shift" style="flex:1;min-width:0;font-weight:700" ${dis}>
      ${pusat ? "" : `<button class="btn sm ghost" data-hapus-shift="${i}" type="button" aria-label="Hapus shift">✕</button>`}</div>
    <div class="row" style="flex-wrap:nowrap"><label class="f" style="flex:1;min-width:0">Masuk<input type="time" class="jM" value="${esc(x.masuk)}" style="padding-left:8px;padding-right:4px" ${dis}></label><label class="f" style="flex:1;min-width:0">Pulang<input type="time" class="jP" value="${esc(x.pulang)}" style="padding-left:8px;padding-right:4px" ${dis}></label></div></div>`;
  const opsiShift = v => `<option value="">Otomatis</option>${J.shifts.map((x, i) => `<option value="${i + 1}" ${String(v) === String(i + 1) ? "selected" : ""}>${esc(x.nama)} (${x.masuk}–${x.pulang})</option>`).join("")}`;
  el.innerHTML = `<h3 style="font-size:17px">⏱️ Jam kerja, lembur & insentif lain</h3>
    ${pusat ? `<p class="note" style="margin:0">Diatur di server (browser) → Pengaturan, lalu otomatis ikut ke perangkat ini.</p>` : ""}
    <div class="row"><label class="f grow">Toko buka<input type="time" id="jBuka" value="${esc(J.jam_buka)}" ${dis}></label><label class="f grow">Toko tutup<input type="time" id="jTutup" value="${esc(J.jam_tutup)}" ${dis}></label></div>
    <h4 style="margin:4px 0 0">Shift karyawan</h4>
    <div class="stack" id="jShifts">${J.shifts.map(barisShift).join("")}</div>
    ${pusat ? "" : `<button class="btn sm" id="jAddShift" type="button" style="align-self:flex-start">+ Tambah shift</button>`}
    <h4 style="margin:4px 0 0">Lembur</h4>
    <p class="small muted" style="margin:0">Dihitung otomatis dari absen: datang sebelum jam masuk shift + pulang setelah jam pulang shift. Jam absen mengikuti jam saat absen (tidak bisa diisi manual).</p>
    <div class="row"><label class="f grow">Upah lembur per jam (Rp)<input type="number" id="jUpah" value="${J.lembur_per_jam}" min="0" step="500" inputmode="numeric" ${dis}></label>
      <label class="f grow">Pembulatan<select id="jBulat" ${dis}>${[[1, "Per menit"], [15, "Per 15 menit"], [30, "Per 30 menit"], [60, "Per 1 jam"]].map(([v, t]) => `<option value="${v}" ${J.lembur_bulat === v ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
    <p class="small muted" style="margin:0">Pembulatan ke bawah. Contoh per 30 menit: lembur 50 menit dihitung 30 menit. Upah bisa diubah kapan saja (tentatif); rekap insentif memakai upah yang berlaku saat dibuka.</p>
    <h4 style="margin:4px 0 0">Insentif lain (nominal bawaan per kegiatan)</h4>
    <div class="row"><label class="f grow">Jasa kurir non online<input type="number" id="jKurir" value="${J.ins_kurir}" min="0" step="500" inputmode="numeric" ${dis}></label>
      <label class="f grow">Kerja lapangan<input type="number" id="jLap" value="${J.ins_lapangan}" min="0" step="500" inputmode="numeric" ${dis}></label>
      <label class="f grow">Buat konten<input type="number" id="jKonten" value="${J.ins_konten}" min="0" step="500" inputmode="numeric" ${dis}></label></div>
    <p class="small muted" style="margin:0">Dicatat di menu <b>Produksi</b> → Insentif lain. Nominal bisa disesuaikan saat mencatat.</p>
    <h4 style="margin:4px 0 0">Shift tiap karyawan</h4>
    <p class="small muted" style="margin:0">"Otomatis" memilih shift yang jam masuknya paling dekat dengan jam datang. Pilih shift tetap supaya lembur datang awal terhitung tepat.</p>
    <div class="stack" id="jKary">${J.karyawan.filter(k => k.aktif).map(k => `<div class="row" style="align-items:center"><span style="flex:1">${esc(k.nama)} <span class="small muted">${k.peran}</span></span><select data-uid="${k.id}" style="width:auto;max-width:60%" ${dis}>${opsiShift(k.shift)}</select></div>`).join("")}</div>
    ${pusat ? "" : `<button class="btn pri" id="jSimpan" type="button">Simpan jam kerja & insentif</button>`}`;
  if (pusat) return;
  const ambilShift = () => $$("#jShifts .jShift").map(r => ({ nama: $(".jN", r).value.trim(), masuk: $(".jM", r).value, pulang: $(".jP", r).value }));
  $("#jAddShift").onclick = () => { J.shifts = ambilShift(); J.shifts.push({ nama: `Shift ${J.shifts.length + 1}`, masuk: "09:00", pulang: "17:00" }); $("#jShifts").innerHTML = J.shifts.map(barisShift).join(""); pasangHapus(); };
  const pasangHapus = () => $$("[data-hapus-shift]").forEach(b => b.onclick = () => {
    J.shifts = ambilShift(); if (J.shifts.length <= 1) return toast("Minimal satu shift");
    J.shifts.splice(+b.dataset.hapusShift, 1); $("#jShifts").innerHTML = J.shifts.map(barisShift).join(""); pasangHapus();
  });
  pasangHapus();
  $("#jSimpan").onclick = e => coba(async () => {
    await api("PUT", "/api/jam-kerja", { jam_buka: $("#jBuka").value, jam_tutup: $("#jTutup").value, shifts: ambilShift(),
      lembur_per_jam: num($("#jUpah").value), lembur_bulat: +$("#jBulat").value,
      ins_kurir: num($("#jKurir").value), ins_lapangan: num($("#jLap").value), ins_konten: num($("#jKonten").value),
      shift_karyawan: $$("#jKary select").map(x => ({ user_id: +x.dataset.uid, shift: x.value })) });
    await muatUlang(); toast("Jam kerja & insentif tersimpan"); aturJam();
  }, e.target);
}
/** Hard reset: mulai input dari awal (butuh kode reset; bawaan "OK", bisa diganti). */
async function aturReset(){
  const el = $("#aReset"); if (!el) return;
  const pusat = LOKAL && B.cabang;
  const R = pusat ? null : await api("GET", "/api/reset").catch(() => null); if (!$("#aReset")) return;
  el.innerHTML = `<h3 style="font-size:17px">⚠️ Hard reset (mulai dari awal)</h3>
    ${pusat ? `<p class="note" style="margin:0">Perangkat ini tersambung ke server pusat. Hard reset dilakukan dari server (browser); perangkat ini ikut kosong otomatis saat sinkron.</p>` : `
    <p class="small muted" style="margin:0">Untuk input ulang dari awal. Akun karyawan, PIN, dan pengaturan toko <b>tidak</b> ikut terhapus. Simpan cadangan dulu sebelum reset.</p>
    <label class="row" style="flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="rsT" style="margin-top:4px;flex:none"> <span><b>Hapus semua transaksi & catatan</b><br><span class="small muted">Penjualan, pesanan, riwayat stok, produksi, insentif, pengeluaran, absensi, gaji, kasbon.</span></span></label>
    <label class="row" style="flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="rsS" style="margin-top:4px;flex:none"> <span><b>Nolkan semua stok</b><br><span class="small muted">Barang tetap ada, stoknya jadi 0 untuk diisi ulang di menu Stok.</span></span></label>
    <label class="row" style="flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="rsK" style="margin-top:4px;flex:none"> <span><b>Hapus semua barang</b> (produk jadi & bahan baku)<br><span class="small muted">Katalog dikosongkan, barang dibuat ulang dari awal.</span></span></label>
    <button class="btn danger" id="rsGo" type="button">Hard reset…</button>
    <hr class="sep">
    <p class="small" style="margin:0"><b>Hapus transaksi lama saja.</b> Semua transaksi & catatan yang tanggalnya <u>sebelum</u> tanggal ini dihapus (penjualan, pesanan, riwayat stok, produksi, insentif, pengeluaran, absensi, gaji, kasbon). Data mulai tanggal ini tetap. Stok, barang, akun, dan pengaturan tidak berubah.</p>
    <label class="f">Hapus semua yang sebelum tanggal<input type="date" id="rsTgl" value="${today().slice(0, 8)}15"></label>
    <div class="small muted" id="rsJml">Menghitung…</div>
    <button class="btn danger" id="rsLama" type="button">Hapus transaksi lama…</button>
    <details><summary class="small"><b>Ganti kode reset</b> ${R && R.kodeBawaan ? `<span class="pill warn">masih bawaan "OK"</span>` : ""}</summary>
      <div class="stack" style="margin-top:8px">
        <label class="f">Kode reset sekarang<input type="password" id="rkL" autocomplete="off"></label>
        <label class="f">Kode reset baru<input type="password" id="rkB" autocomplete="off"></label>
        <label class="f">Ulangi kode baru<input type="password" id="rkB2" autocomplete="off"></label>
        <button class="btn" id="rkOk" type="button">Simpan kode reset</button>
      </div></details>`}`;
  if (pusat) return;
  const NAMA_TBL = { sales: "penjualan/pesanan", stock_moves: "riwayat stok", produksi: "produksi", insentif_bayar: "bayar insentif", insentif_lain: "insentif lain", kasbon: "kasbon", gaji_bayar: "gaji", expenses: "pengeluaran", absen: "absensi" };
  const teksJumlah = j => { const a = Object.entries(j || {}).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${NAMA_TBL[t] || t}`); return a.length ? a.join(", ") : "tidak ada"; };
  let jml = null;
  const hitung = async () => {
    const t = $("#rsTgl").value; jml = null;
    if (!t) { $("#rsJml").textContent = "Pilih tanggal."; return; }
    $("#rsJml").textContent = "Menghitung…";
    const r = await api("GET", "/api/reset?sebelum=" + encodeURIComponent(t)).catch(() => null);
    if (!$("#rsJml") || $("#rsTgl").value !== t) return;
    jml = r && r.jumlah; $("#rsJml").innerHTML = jml ? `Akan dihapus (sebelum ${esc(tglID(t))}): <b>${esc(teksJumlah(jml))}</b>` : "Gagal menghitung.";
  };
  $("#rsTgl").onchange = hitung; hitung();
  $("#rsLama").onclick = () => {
    const t = $("#rsTgl").value; if (!t) return toast("Pilih tanggal dulu");
    modal(`<h3>⚠️ Hapus transaksi lama</h3><p>Semua transaksi & catatan <b>sebelum ${esc(tglHari(t))}</b> dihapus${jml ? `: <b>${esc(teksJumlah(jml))}</b>` : ""}. Tindakan ini <b>tidak bisa dibatalkan</b>${LOKAL ? "" : " dan perangkat kasir yang tersambung ikut menghapusnya saat sinkron"}. Stok barang tidak berubah.</p>
      <p class="small muted">Saran: unduh cadangan database dulu (bagian Cadangan di bawah).</p>
      <label class="f">Masukkan kode reset admin<input type="password" id="rsKode2" autocomplete="off" placeholder="Kode reset"></label>
      <div class="actions"><button class="btn" data-close>Batal</button><button class="btn danger" id="rsYa2" type="button">Hapus sekarang</button></div>`, m => {
      $("#rsKode2", m).focus();
      $("#rsYa2", m).onclick = e => coba(async () => {
        const r = await api("POST", "/api/reset", { sebelum: t, kode: $("#rsKode2", m).value });
        closeModal(); await muatUlang(); renderNav();
        toast("Terhapus: " + teksJumlah(r.dihapus)); vAtur();
        return r;
      }, e.target);
    });
  };
  $("#rsGo").onclick = () => {
    const pilih = { transaksi: $("#rsT").checked, stok: $("#rsS").checked, katalog: $("#rsK").checked };
    if (!pilih.transaksi && !pilih.stok && !pilih.katalog) return toast("Centang data yang mau direset");
    const daftarTeks = [pilih.transaksi && "semua transaksi & catatan", pilih.stok && "stok jadi 0", pilih.katalog && "semua barang"].filter(Boolean).join(", ");
    modal(`<h3>⚠️ Hard reset</h3><p>Yang dihapus: <b>${daftarTeks}</b>. Tindakan ini <b>tidak bisa dibatalkan</b>${LOKAL ? "" : " dan perangkat kasir yang tersambung ikut dikosongkan saat sinkron"}.</p>
      <label class="f">Masukkan kode reset admin<input type="password" id="rsKode" autocomplete="off" placeholder="Kode reset"></label>
      <div class="actions"><button class="btn" data-close>Batal</button><button class="btn danger" id="rsYa" type="button">Reset sekarang</button></div>`, m => {
      $("#rsKode", m).focus();
      $("#rsYa", m).onclick = e => coba(async () => {
        const r = await api("POST", "/api/reset", { ...pilih, kode: $("#rsKode", m).value });
        closeModal(); resetCart();
        await muatUlang(); renderNav(); toast("Hard reset selesai"); vAtur();
        return r;
      }, e.target);
    });
  };
  $("#rkOk").onclick = e => {
    if ($("#rkB").value !== $("#rkB2").value) return toast("Kode baru dan ulangannya tidak sama");
    coba(async () => { await api("PUT", "/api/reset/kode", { lama: $("#rkL").value, baru: $("#rkB").value }); toast("Kode reset diganti"); aturReset(); }, e.target);
  };
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
const SERVER_TOKO = "https://pos.richgallery.my.id";
const waktuLokal = iso => iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-";
/** Daftar perangkat kasir (aplikasi) yang tersambung ke server: izin absen, ganti nama, cabut.
 *  Tampil di server (browser) dan juga di aplikasi perangkat untuk admin (diteruskan ke server). */
async function daftarPerangkatCabang(el, kodeIni = ""){
  const muat = () => daftarPerangkatCabang(el, kodeIni);
    const d = await coba(() => api("GET", "/api/cabang/perangkat")); if (!d || view !== "atur" || !document.body.contains(el)) return;
    el.innerHTML = `<h3 style="font-size:17px">Perangkat cabang${kodeIni ? " (semua aplikasi kasir)" : ""}</h3>
      <p class="small muted" style="margin:0">Perangkat kasir (mis. iMin) yang bekerja offline dan mengirim transaksinya ke server ini. Sambungkan dari Pengaturan di perangkat itu.</p>
      ${d.length ? d.map(x => `<div class="row" style="border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--surface);align-items:center">
        <div style="flex:1;min-width:0"><b>${esc(x.kode)} · ${esc(x.nama)}</b>${x.kode === kodeIni ? ` <span class="pill ok">perangkat ini</span>` : ""}${x.dicabut ? ` <span class="pill mut">dicabut</span>` : ""}
          <div class="small muted">Terakhir: ${x.terakhir ? waktuLokal(x.terakhir.replace(" ", "T") + "Z") : "belum pernah"} · ${x.diterima} transaksi diterima${x.ditolak ? ` · <span style="color:var(--bad)">${x.ditolak} ditolak</span>` : ""}</div></div>
        ${x.dicabut ? "" : `<button class="btn sm ${x.absen ? "pri" : ""}" data-absen="${x.id}" data-v="${x.absen ? 0 : 1}" type="button">${x.absen ? "✓ Boleh absen" : "Izinkan absen"}</button><button class="btn sm" data-nama="${x.id}" type="button">Ganti nama</button><button class="btn sm danger" data-cabut="${x.id}" type="button">Cabut</button>`}</div>`).join("")
        : `<div class="empty">Belum ada perangkat yang tersambung.</div>`}`;
    el.querySelectorAll("[data-absen]").forEach(b => b.onclick = () => coba(async () => {
      await api("PUT", `/api/cabang/perangkat/${b.dataset.absen}`, { absen: b.dataset.v === "1" });
      if (LOKAL) { await cekKiosk(); renderNav(); }
      toast(b.dataset.v === "1" ? "Perangkat diizinkan untuk absen karyawan" : "Izin absen dicabut"); muat();
    }, b));
    el.querySelectorAll("[data-nama]").forEach(b => b.onclick = () => {
      const x = d.find(y => y.id === +b.dataset.nama);
      modal(`<h3>Ganti nama perangkat ${esc(x.kode)}</h3>
        <label class="f">Nama perangkat<input type="text" id="pn" value="${esc(x.nama)}" maxlength="40" placeholder="Contoh: iMin Kasir Depan"></label>
        <p class="small muted" style="margin:0">Nama baru otomatis tampil juga di perangkat itu saat sinkron berikutnya. Seri nota (${esc(x.kode)}) tidak berubah.</p>
        <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="pok" type="button">Simpan</button></div>`, m => {
        $("#pok", m).onclick = e => coba(async () => { await api("PUT", `/api/cabang/perangkat/${x.id}`, { nama: $("#pn", m).value }); closeModal(); toast("Nama perangkat diganti"); muat(); }, e.target);
      });
    });
    el.querySelectorAll("[data-cabut]").forEach(b => b.onclick = () => konfirmasi("Cabut perangkat ini?", "Perangkat tidak bisa mengirim transaksi lagi sampai disambungkan ulang. Data yang sudah diterima tetap ada.", "Cabut", async () => { await api("DELETE", `/api/cabang/perangkat/${b.dataset.cabut}`); toast("Perangkat dicabut"); muat(); }));
}
async function aturCabang(){
  const el = $("#aCabang"); if (!el) return;
  if (!LOKAL) { // di server: daftar perangkat yang tersambung
    await daftarPerangkatCabang(el);
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
    ${st.ditolak ? `<p class="small" style="margin:0;color:var(--bad)">${st.ditolak} transaksi ditolak server (tetap tersimpan di perangkat ini):<br>${st.ditolakDaftar.map(x => `${esc(x.aksi)}${x.no ? " " + esc(x.no) : ""}: ${esc(x.galat || "")}`).join("<br>")}</p>
      <button class="btn" id="cbUlang" type="button">Kirim ulang yang ditolak</button>` : ""}
    <p class="small muted" style="margin:0">Sinkron berjalan otomatis setiap ada transaksi, dan memeriksa data baru tiap 10 detik selama aplikasi terbuka dan ada internet. Tarik layar ke bawah untuk sinkron seketika. Produk, akun dan pengaturan toko diubah di server pusat.</p>
    ${![SERVER_TOKO, "https://rich-gallery-pos.yudi-b27fjr.workers.dev"].includes(st.url.replace(/\/+$/, "")) ? `<p class="note" style="margin:0">Server toko sekarang ada di Cloudflare: <b>${esc(SERVER_TOKO)}</b>. Untuk pindah: tekan <b>Putuskan</b> (setelah semua transaksi terkirim), lalu sambungkan lagi. Alamat Cloudflare sudah terisi otomatis.</p>` : ""}
    ${st.dicabut ? `<div class="note" style="margin:0"><b>Perangkat ini dicabut dari server pusat.</b> Transaksi di perangkat ini tetap aman dan belum hilang. Tekan <b>Sambungkan ulang</b> lalu masukkan akun admin server; transaksi yang menunggu langsung dikirim.</div>
      <button class="btn pri big" id="cbSU" type="button">🔄 Sambungkan ulang</button>` : ""}
    <div class="row"><button class="btn pri" id="cbSync" type="button">Sinkron sekarang</button><button class="btn" id="cbNama" type="button">Ganti nama perangkat</button><button class="btn" id="cbPutus" type="button">Putuskan</button></div>
    <hr class="sep"><div class="stack" id="cbPerangkat"><div class="empty small">Memuat daftar perangkat…</div></div>`;
  daftarPerangkatCabang($("#cbPerangkat"), st.kode).catch(() => { const x = $("#cbPerangkat"); if (x) x.innerHTML = `<p class="small muted" style="margin:0">Daftar perangkat belum bisa dimuat (butuh internet).</p>`; });
  $("#cbNama").onclick = () => modal(`<h3>Ganti nama perangkat</h3>
    <label class="f">Nama perangkat<input type="text" id="pn" value="${esc(st.nama)}" maxlength="40" placeholder="Contoh: iMin Kasir Depan"></label>
    <p class="small muted" style="margin:0">Nama ini tampil di server pusat. Seri nota (${esc(st.kode)}) tidak berubah. Butuh internet.</p>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="pok" type="button">Simpan</button></div>`, m => {
    $("#pok", m).onclick = e => coba(async () => { await api("POST", "/api/cabang/nama", { nama: $("#pn", m).value }); closeModal(); toast("Nama perangkat diganti"); aturCabang(); }, e.target);
  });
  const su = $("#cbSU"); if (su) su.onclick = () => modal(`<h3>Sambungkan ulang ke server pusat</h3>
    <p class="small" style="margin:0">Server: <b>${esc(st.url)}</b>. Masukkan akun <b>admin di server</b>. Transaksi yang belum terkirim (${st.menunggu}) tidak hilang dan langsung dikirim.</p>
    <label class="f">Nama admin server<input type="text" id="suN" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(B.me.peran === "admin" ? B.me.nama : "")}"></label>
    <label class="f">Password admin server<input type="password" id="suP" autocomplete="off"></label>
    <div class="actions"><button class="btn" data-close>Batal</button><button class="btn pri" id="suOk" type="button">Sambungkan ulang</button></div>`, m => {
    $("#suOk", m).onclick = e => coba(async () => {
      const r = await api("POST", "/api/cabang/sambung-ulang", { nama: $("#suN", m).value, password: $("#suP", m).value });
      closeModal(); await muatUlang();
      toast(r.galatTerakhir ? "Tersambung, tapi: " + r.galatTerakhir : r.menunggu ? `Tersambung. ${r.menunggu} transaksi masih menunggu` : "Tersambung ulang. Semua transaksi terkirim ✅");
      aturCabang(); cekSync();
    }, e.target);
  });
  const cu = $("#cbUlang"); if (cu) cu.onclick = e => coba(async () => { const r = await api("POST", "/api/cabang/kirim-ulang"); await muatUlang(); toast(r.ditolak ? `${r.ditolak} masih ditolak` : `${r.dikirimUlang} transaksi berhasil dikirim ulang`); aturCabang(); cekSync(); }, e.target);
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
    if (!st.masuk) {
      // Penyambungan perangkat baru sempat gagal (mis. internet putus): lanjutkan dari layar sambungkan, bukan layar masuk.
      let sem = null; try { sem = JSON.parse(localStorage.getItem("rg_setup_sementara") || "null"); } catch {}
      if (LOKAL && sem && !st.cabang) { try { await api("POST", "/api/login", sem); tampilSetupKasir(); return halamanTampil(); } catch { try { localStorage.removeItem("rg_setup_sementara"); } catch {} } }
      tampilLogin(); return halamanTampil();
    }
    await muatUlang();
  } catch (e) {
    if (e.status === 401) return;
    $("#root").innerHTML = `<div class="auth"><div class="card"><h1>Tidak terhubung</h1><p>${esc(e.message)}</p><button class="btn pri" id="ulang">Coba lagi</button></div></div>`;
    $("#ulang").onclick = mulai; return;
  }
  try { const h = location.hash.slice(1); if (SEMUA_VIEW.some(v => v[0] === h)) view = h; } catch {}
  if (LOKAL) await cekKiosk();
  pPer = null; shell(); render();
  halamanTampil();
  setTimeout(pengingatPesanan, 800);
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
