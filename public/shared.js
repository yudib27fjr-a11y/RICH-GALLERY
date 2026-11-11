// Aturan bersama: dipakai server (Node) dan browser. Ubah di sini, berlaku di keduanya.

export const KATEGORI = ["BUKET BUNGA","BUKET WISUDA","BUKET UANG","BUKET SNACK","BUKET COSTUME","BUKET BONEKA","SINGLE FLOWER","ROUND BUKET","BAG FLOWERS","HOT BALON","BLOOM BOX","SNACK TOWER","STANDING UCAPAN","STANDING FLOWER","SEWA STANDING UCAPAN","SEWA HAND BUKET","SEWA SESERAHAN","MAHAR","BUKET HARI GURU","BUKET BAG WISUDA","BUKET PROFESI","VAS BUNGA","HAMPERS","ADDITIONAL"];
export const KAT_BAHAN = ["KERTAS","BUNGA","PITA","BONEKA","BLOOM BOX","BALON KARET","BALON PVC","AKRILIK","STANDING FLOWERS","LAIN-LAIN"];
export const KAT_PENGELUARAN = ["Belanja Bahan","Operasional","Gaji Karyawan","Kasbon Karyawan","Insentif Produksi","Listrik & Air","Transport / Ongkir","Sewa Tempat","Promosi","Lain-lain"];
export const METODE = ["Tunai","Transfer","QRIS"];

const ATURAN_KAT = [["WISUDA","BUKET WISUDA"],["SKRIPSI","BUKET WISUDA"],["UANG","BUKET UANG"],["TOWER","SNACK TOWER"],["SNACK","BUKET SNACK"],["GURU","BUKET HARI GURU"],["SEWA STANDING","SEWA STANDING UCAPAN"],["SEWA HAND","SEWA HAND BUKET"],["SEWA","SEWA SESERAHAN"],["SESERAHAN","SEWA SESERAHAN"],["HANTARAN","SEWA SESERAHAN"],["MAHAR","MAHAR"],["STANDING FLOWER","STANDING FLOWER"],["STANDING","STANDING UCAPAN"],["PAPAN","STANDING UCAPAN"],["BONEKA","BUKET BONEKA"],["SINGLE","SINGLE FLOWER"],["ROUND","ROUND BUKET"],["TOTE","ADDITIONAL"],["PAPER","ADDITIONAL"],["FLOWER BAG","BAG FLOWERS"],["BAG FLOWER","BAG FLOWERS"],["BALON","HOT BALON"],["BLOOM","BLOOM BOX"],["VAS","VAS BUNGA"],["PARSEL","HAMPERS"],["PARCEL","HAMPERS"],["HAMPERS","HAMPERS"],["KERANJANG","HAMPERS"],["PROFESI","BUKET PROFESI"],["CUSTOM","BUKET COSTUME"],["THUMBELINA","BUKET BUNGA"],["FRESH","BUKET BUNGA"],["BUKET","BUKET BUNGA"],["HAND","BUKET BUNGA"]];
export function tebakKategori(nama){
  const n = String(nama || "").toUpperCase();
  for (const [k, v] of ATURAN_KAT) if (n.includes(k)) return v;
  return "ADDITIONAL";
}

export const pad = (n, l = 2) => String(n).padStart(l, "0");

/* ---- Barcode EAN-13 ----
   Barcode internal toko berawalan 20 (rentang khusus pemakaian dalam toko):
   201 + 9 digit nomor ID = produk jadi, 202 + 9 digit = bahan baku, lalu 1 digit cek. */
export function eanCek(d12){ let s = 0; for (let i = 0; i < 12; i++) s += +d12[i] * (i % 2 ? 3 : 1); return String((10 - s % 10) % 10); }
export const eanValid = b => /^\d{13}$/.test(String(b || "")) && eanCek(b.slice(0, 12)) === b[12];
export function barcodeDefault(jenis, kode){
  const n = parseInt(String(kode).replace(/\D/g, ""), 10);
  if (isNaN(n) || n > 999999999) return "";
  const b = "20" + (jenis === "bahan" ? "2" : "1") + pad(n, 9);
  return b + eanCek(b);
}
const EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const EAN_PAR = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
export function eanBits(b){
  const par = EAN_PAR[+b[0]]; let s = "101";
  for (let i = 1; i <= 6; i++) s += (par[i - 1] === "L" ? EAN_L : EAN_G)[+b[i]];
  s += "01010";
  for (let i = 7; i <= 12; i++) s += EAN_R[+b[i]];
  return s + "101";
}
export function eanSVG(b, hMod = 50){
  const bits = eanBits(b), q = 9, W = bits.length + q * 2; let r = "";
  for (let i = 0; i < bits.length; i++) if (bits[i] === "1") {
    let j = i; while (bits[j + 1] === "1") j++;
    const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    r += `<rect x="${i + q}" y="0" width="${j - i + 1}" height="${guard ? hMod + 5 : hMod}"/>`; i = j;
  }
  const t = (x, s) => `<text x="${x}" y="${hMod + 12}" font-size="10" font-family="monospace" text-anchor="middle">${s}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${hMod + 14}" preserveAspectRatio="none" fill="#000">${r}${t(q - 4, b[0])}${t(q + 3 + 21, b.slice(1, 7))}${t(q + 50 + 21, b.slice(7))}</svg>`;
}

/* ---- Tanggal & periode insentif ---- */
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const validTgl = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(new Date(s + "T00:00:00").getTime());
/** Periode berjalan dari tanggal `mulai` sampai sehari sebelum tanggal `mulai` bulan berikutnya. */
export function periodeDari(iso, mulai){
  const D = Math.min(28, Math.max(1, +mulai || 1));
  const [y, m, d] = iso.split("-").map(Number);
  const s = d >= D ? new Date(y, m - 1, D) : new Date(y, m - 2, D);
  const e = D === 1 ? new Date(s.getFullYear(), s.getMonth() + 1, 0) : new Date(s.getFullYear(), s.getMonth() + 1, D - 1);
  return [isoOf(s), isoOf(e)];
}
export function geserPeriode(dariIso, n, mulai){
  const [y, m, d] = dariIso.split("-").map(Number);
  return periodeDari(isoOf(new Date(y, m - 1 + n, d)), mulai);
}
export function tambahHari(iso, n){ const [y, m, d] = iso.split("-").map(Number); return isoOf(new Date(y, m - 1, d + n)); }

/* ---- Baca teks nota belanja hasil OCR → { toko, tgl, no, total, items:[{nama, kode, qty, harga, jumlah}] } ----
   Mendukung pola umum struk kasir: "12x 14000  Rp168000", "NAMA BARANG 2 x 5.000 10.000", "NAMA BARANG  2  5.000  10.000". */
const angkaOCR = s => { const t = String(s || "").replace(/[Oo]/g, "0").replace(/[Il|!]/g, "1").replace(/[Ss](?=\d|$)/g, "5").replace(/[Bb](?=\d)/g, "8").replace(/[^\d]/g, ""); return t ? +t : NaN; };
// "Rp 1 45.000" / "Rpl06500" / "Re35000" → angka saja (spasi di dalam angka setelah Rp disatukan)
const bersihRp = l => l.replace(/\b(?:r\s?[pera]|pp|rd)\.?\s?([\dOoIl](?:[\dOoIl.,]|\s(?=[\dOoIl]))*)/gi, (_, n) => " " + n.replace(/\s+/g, ""));
const KODE_BRS = /^\s*((?:DPT|DEPT|PLU|SKU|KD)\s*[.:]?\s*[0-9OoIl]{1,6})[^0-9A-Za-z]*(?:\S{0,2}[^0-9A-Za-z]*)?$/i;
const TOKEN_ANGKA = "[0-9OoIl|]{1,3}(?:[.,][0-9Oo]{3})+|[0-9OoIlSB]{3,}";
export function bacaStruk(teks, hariIni = ""){
  const L = String(teks || "").replace(/\r/g, "").split("\n").map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const hurufN = s => (s.match(/[A-Za-z]/g) || []).length, digitN = s => (s.match(/\d/g) || []).length;
  const res = { toko: "", tgl: "", no: "", total: 0, items: [] };
  res.toko = (L.find(l => hurufN(l) >= 4 && hurufN(l) >= l.replace(/\s/g, "").length * 0.6) || "").replace(/[^A-Za-z0-9 &'.-]/g, "").trim();
  for (const l of L) {
    const d = l.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (d && !res.tgl) { const th = d[3].length === 2 ? "20" + d[3] : d[3], t = `${th}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`; if (+d[2] >= 1 && +d[2] <= 12 && +d[1] >= 1 && +d[1] <= 31 && (!hariIni || t <= hariIni)) res.tgl = t; }
    const n = l.match(/(?:#|no\.?\s*(?:nota|struk|trx|faktur)?\s*[:#]?\s*)(\d{3,})/i); if (n && !res.no) res.no = n[1];
  }
  const KUNCI_TOTAL = /\b(grand\s*total|total|jumlah|credit|debit|tunai|cash|bayar|qris|transfer)/i, BUKAN_BARANG = /\b(total|subtotal|kembali|change|tunai|cash|credit|debit|diskon|ppn|pajak|terima kasih|bayar)\b/i;
  const totalKand = [], totalMentah = [];
  const reX = new RegExp(`^(.*?)\\s*\\b([0-9OoIl|]{1,3})\\s*[xX×*]\\s*(${TOKEN_ANGKA})(?:\\s+.*?(${TOKEN_ANGKA}))?[^0-9A-Za-z]*$`);
  const re3 = new RegExp(`^(.*[A-Za-z].*?)\\s+([0-9]{1,3})\\s+(${TOKEN_ANGKA})\\s+(${TOKEN_ANGKA})\\s*$`);
  L.forEach((mentah, i) => {
    const l = bersihRp(mentah);
    if (KUNCI_TOTAL.test(l)) { totalMentah.push(l); const nums = (l.match(new RegExp(TOKEN_ANGKA, "g")) || []).map(angkaOCR).filter(x => x >= 100); if (nums.length) totalKand.push({ v: Math.max(...nums), utama: /total|credit|debit|qris|transfer/i.test(l) }); return; }
    if (BUKAN_BARANG.test(l)) return;
    let m = l.match(reX), nama = "", qty, harga, jml;
    if (m) { nama = m[1]; qty = angkaOCR(m[2]); harga = angkaOCR(m[3]); jml = m[4] ? angkaOCR(m[4]) : NaN; }
    else if ((m = l.match(re3))) { nama = m[1]; qty = +m[2]; harga = angkaOCR(m[3]); jml = angkaOCR(m[4]); if (Math.abs(qty * harga - jml) > 1) return; }
    else return;
    if (!(qty > 0 && qty < 1000) || !(harga > 0)) return;
    // Harga satuan vs jumlah: percayai jumlah bila habis dibagi qty, kalau tidak pakai qty × harga
    if (jml > 0 && qty * harga !== jml) {
      // pilih yang paling masuk akal: jumlah (kanan) habis dibagi qty & tidak lebih "ganjil" (nol di belakang) daripada qty × harga
      const nol = v => (String(v).match(/0*$/) || [""])[0].length;
      const a = qty * harga, okB = jml % qty === 0 && jml >= harga && String(jml).length >= String(a).length && nol(jml) >= nol(a);
      if (okB) harga = jml / qty; else jml = a;
    }
    if (!(jml > 0)) jml = qty * harga;
    nama = nama.replace(/[^A-Za-z0-9 .,&'/-]/g, " ").replace(/\s+/g, " ").trim();
    if (hurufN(nama) < 3) { // nama di baris sebelumnya (teks saja) bila ada
      const sb = L[i - 1] || "";
      nama = hurufN(sb) >= 3 && digitN(sb) <= hurufN(sb) / 2 && !KODE_BRS.test(sb) && !reX.test(bersihRp(sb)) && !KUNCI_TOTAL.test(sb) && i > 1 && sb !== L[0] ? sb.replace(/[^A-Za-z0-9 .,&'/-]/g, " ").trim() : "";
    }
    const sd = L[i + 1] || "", kode = (sd.match(KODE_BRS) || [])[1];
    res.items.push({ nama, kode: kode ? kode.replace(/\s+/g, "").replace(/[Oo]/g, "0").toUpperCase() : "", qty, harga, jumlah: jml });
  });
  const jumlahBaris = res.items.reduce((a, x) => a + x.jumlah, 0);
  // Total yang salah baca 1–2 karakter (mis. "Rp52@1000"): coba ganti karakter aneh dengan angka → kalau cocok dengan jumlah barang, pakai itu
  if (jumlahBaris && !totalKand.some(x => x.v === jumlahBaris)) for (const l of totalMentah) for (const run of l.match(/[\dOoIl@#$&%?]{4,}/g) || []) {
    const pola = run.replace(/[Oo]/g, "0").replace(/[Il]/g, "1"), aneh = (pola.match(/[^\d]/g) || []).length;
    if (aneh >= 1 && aneh <= 2 && (new RegExp("^" + pola.replace(/[^\d]/g, "\\d") + "$").test(String(jumlahBaris)) || pola.replace(/[^\d]/g, "") === String(jumlahBaris))) totalKand.push({ v: jumlahBaris, utama: true });
  }
  const utama = totalKand.filter(x => x.utama);
  res.total = (utama.length ? utama : totalKand).map(x => x.v).sort((a, b) => Math.abs(a - jumlahBaris) - Math.abs(b - jumlahBaris))[0] || jumlahBaris;
  res.adaTotal = totalKand.length > 0;
  res.cocok = !!res.items.length && res.adaTotal && res.total === jumlahBaris;
  return res;
}

/* ---------- Baca rincian pesanan marketplace (TikTok Shop, dll.) dari teks hasil OCR screenshot / salinan teks ---------- */
const BULAN_ID = { jan: 1, feb: 2, peb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
const RINGKAS_OL = /^(sub\s?total|total|ongkos|ongkir|biaya|diskon|voucher|potongan|gratis|koin|bonus|hemat|cashback|metode|pembayaran|bayar|id\s?pesanan|no\.?\s?pesanan|nomor|order\s?id|waktu|tanggal|alamat|status|kurir|jasa\s?kirim|opsi\s?pengiriman|pengiriman|resi|no\.?\s?resi|dibayar|harga\s?total|rincian\s?pembayaran)/i;
const ABAIKAN_OL = /^(chat|kunjungi|beli\s?lagi|lacak|hubungi|lihat|rincian|detail|pesanan\s?(saya|dikirim|selesai|diproses|tiba)|sedang|dikirim|selesai|tiba|diterima|kembali|ajukan|nilai|ulasan|minta|batalkan|salin|copy|tiktok\s?shop|shop\s?\|?\s?tokopedia|informasi|penerima)/i;
const ALAMAT_OL = /\b(jl|jln|jalan|kec|kecamatan|kab|kabupaten|kota|kel|kelurahan|desa|rt|rw|provinsi|sulawesi|jawa|sumatera|kalimantan|indonesia|perumahan|perum|blok|lorong|lr|btn|kompleks)\b\.?/i;
const uangOL = l => {
  const o = [];
  for (const m of l.matchAll(/(-|−)?\s?R[pP]\s?([\dOoIl][\dOoIl.,]*)/g)) { const v = angkaOCR(m[2].replace(/[.,]\d{1,2}$/, "")); if (v > 0) o.push(m[1] ? -v : v); }
  if (!o.length) for (const m of l.matchAll(/(-|−)?\s?\b(\d{1,3}(?:[.,]\d{3})+)\b(?![.,]?\d)/g)) { const v = +m[2].replace(/[.,]/g, ""); if (v > 0) o.push(m[1] ? -v : v); }
  return o;
};
/** Teks rincian pesanan (OCR screenshot "Detail pesanan" TikTok Shop / Tokopedia / Shopee, atau teks yang disalin) → { toko, no, tgl, items[{nama,variasi,qty,harga}], subtotal, ongkir, biaya, diskon, total, metode, adaTotal, cocok }. */
export function bacaPesananOnline(teks, hariIni = ""){
  const L0 = String(teks || "").replace(/\r/g, "").split("\n").map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const tandaToko = L0.map(x => /[>›»]\s*$/.test(x) && !/^[<‹«]/.test(x)); // "Nama Toko >" = baris toko penjual
  const L = L0.map(x => x.replace(/[|‹›»«>]+\s*$/, "").trim());
  const huruf = s => (s.match(/[A-Za-z]/g) || []).length;
  const R = { toko: "", no: "", tgl: "", items: [], subtotal: 0, ongkir: 0, biaya: 0, diskon: 0, total: 0, metode: "" };
  let buf = [];
  const nilaiDi = i => { const a = uangOL(L[i]); if (a.length) return a[a.length - 1]; const b = L[i + 1] && !huruf(L[i + 1].replace(/R[pP]/g, "")) ? uangOL(L[i + 1]) : []; return b.length ? b[b.length - 1] : 0; };
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    // tanggal: 11/11/2026, 11-11-2026, 11 Nov 2026
    if (!R.tgl) { let m = l.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/); if (m && +m[2] <= 12) R.tgl = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      else if ((m = l.match(/\b(\d{1,2})\s([A-Za-z]{3})[a-z]*\.?\s(20\d{2})\b/)) && BULAN_ID[m[2].toLowerCase()]) R.tgl = `${m[3]}-${pad(BULAN_ID[m[2].toLowerCase()])}-${m[1].padStart(2, "0")}`; }
    if (/(id|no\.?|nomor)\s?pesanan|order\s?id/i.test(l)) { const m = (l + " " + (L[i + 1] || "")).match(/\b(\d{10,22}|[0-9]{6}[0-9A-Z]{6,16})\b/); if (m) R.no = m[1]; buf = []; continue; }
    if (/bayar di tempat|\bCOD\b|cash on delivery/i.test(l)) R.metode = "COD";
    if (RINGKAS_OL.test(l)) {
      const v = Math.abs(nilaiDi(i));
      if (/^sub\s?total/i.test(l)) { if (!/pengiriman|ongkir/i.test(l)) R.subtotal = R.subtotal || v; else R.ongkir = R.ongkir || v; }
      else if (/diskon|voucher|potongan|gratis|koin|hemat|cashback|bonus/i.test(l)) R.diskon += v;
      else if (/ongkos|ongkir|biaya\s?pengiriman|^pengiriman/i.test(l)) R.ongkir += v;
      else if (/^biaya/i.test(l)) R.biaya += v;
      else if (/^(total|harga\s?total)/i.test(l) && v) R.total = v;
      else if (/^metode|^pembayaran/i.test(l) && !R.metode) { const s = l.replace(/^(metode\s?pembayaran|pembayaran)\s*:?\s*/i, "").replace(/R[pP].*$/, "").trim(); if (huruf(s) >= 3) R.metode = s.slice(0, 40); }
      buf = []; continue;
    }
    if (tandaToko[i] && !R.items.length && huruf(l) >= 3 && !RINGKAS_OL.test(l)) { R.toko = l.slice(0, 80); buf = []; continue; }
    if (/^[x×]\s?\d{1,3}$/i.test(l)) { const it = R.items[R.items.length - 1]; if (it) it.qty = +l.replace(/\D/g, ""); continue; }
    const amt = uangOL(l), qm = l.match(/(?:^|\s)[x×]\s?(\d{1,3})\b/i);
    if (amt.length || qm) {
      const sisa = l.replace(/(-|−)?\s?R[pP]\s?[\dOoIl][\dOoIl.,]*/g, " ").replace(/(?:^|\s)[x×]\s?\d{1,3}\b/gi, " ").replace(/\s+/g, " ").trim();
      if (huruf(sisa) >= 4 && !ABAIKAN_OL.test(sisa)) buf.push(sisa);
      const harga = amt.length ? Math.min(...amt.filter(v => v > 0)) : 0, qty = qm ? +qm[1] : 1;
      if (!buf.length && R.items.length) { const it = R.items[R.items.length - 1]; if (!it.harga && harga) { it.harga = harga; if (qm) it.qty = qty; continue; } if (qm && !amt.length) { it.qty = qty; continue; } }
      if (!buf.length) continue;
      // baris toko (sebelum barang pertama): berakhiran ">" sudah dibuang; kenali dari kata toko / official / store
      let nama = buf.filter(x => !/^varia(si|n)\b/i.test(x)), variasi = (buf.find(x => /^varia(si|n)\b/i.test(x)) || "").replace(/^varia(si|n)\s*:?\s*/i, "");
      const akhir = nama[nama.length - 1] || "";
      if (!variasi && nama.length >= 2 && akhir.length <= 40 && (/[,/]|\d\s?(pcs|pc|cm|m|ikat|tangkai|lembar|meter|yard|roll|pack)\b/i.test(akhir) || (akhir.length <= 20 && akhir.split(" ").length <= 2))) variasi = nama.pop();
      if (!R.items.length && !R.toko && nama.length >= 3) R.toko = nama[nama.length - 3].slice(0, 80);
      R.items.push({ nama: nama.slice(-2).join(" ").slice(0, 160), variasi: variasi.slice(0, 80), qty, harga });
      buf = []; continue;
    }
    if (huruf(l) >= 3 && !ABAIKAN_OL.test(l) && !ALAMAT_OL.test(l) && l.replace(/\D/g, "").length < 8 /* bukan baris no. HP */) { buf.push(l); if (buf.length > 4) buf.shift(); }
  }
  if (!R.no) { const m = L.join(" ").match(/\b(\d{15,22})\b/); if (m) R.no = m[1]; }
  if (!R.tgl) R.tgl = hariIni;
  R.items = R.items.filter(x => x.nama && huruf(x.nama) >= 3);
  const jml = R.items.reduce((a, x) => a + x.harga * x.qty, 0);
  R.adaTotal = R.total > 0;
  R.cocok = !!R.items.length && ((R.subtotal > 0 && Math.abs(jml - R.subtotal) < 1) || (R.adaTotal && Math.abs(jml + R.ongkir + R.biaya - R.diskon - R.total) < 1));
  return R;
}

/* ---- Unit usaha Rich Gallery: 1 kasir untuk semua, unit dikenali otomatis dari kategori produk / jenis pesanan ---- */
export const UNIT = [
  { id: "bouquet", nama: "Gift & Bouquet", brand: "nyenengin.id", ikon: "💐", warna: "#db2777" },
  { id: "hampers", nama: "Rich Hampers", brand: "Rich Hampers", ikon: "🎁", warna: "#d97706" },
  { id: "party", nama: "Rich Party", brand: "Rich Party", ikon: "🎈", warna: "#7c3aed" },
  { id: "hantaran", nama: "Rich Hantaran", brand: "Rich Hantaran", ikon: "💍", warna: "#059669" },
  { id: "papan", nama: "Papan Ucapan", brand: "Papan Ucapan", ikon: "🪧", warna: "#b91c1c" },
];
export const UNIT_KAT_BAWAAN = { "HAMPERS": "hampers", "SNACK TOWER": "hampers", "SEWA SESERAHAN": "hantaran", "MAHAR": "hantaran", "SEWA HAND BUKET": "hantaran",
  "STANDING UCAPAN": "papan", "STANDING FLOWER": "papan", "SEWA STANDING UCAPAN": "papan", "DEKORASI": "party" };
export const UNIT_JENIS = { dekorasi: "party", seserahan: "hantaran", mahar: "hantaran", standing: "papan", parcel: "hampers", buket_uang: "bouquet", buket_costume: "bouquet" };
/** Unit dari kategori produk ("" = ikut barang lain, mis. ADDITIONAL). peta = pengaturan admin { KATEGORI: unit }. */
export function unitKategori(kat, peta = {}){
  const k = String(kat || "").toUpperCase().trim();
  if (peta && peta[k] && UNIT.some(u => u.id === peta[k])) return peta[k];
  if (UNIT_KAT_BAWAAN[k]) return UNIT_KAT_BAWAAN[k];
  if (!k || k === "ADDITIONAL") return "";
  if (/DEKOR|PARTY/.test(k)) return "party";
  if (/HAMPERS|PARSEL|PARCEL/.test(k)) return "hampers";
  if (/SESERAHAN|HANTARAN|MAHAR/.test(k)) return "hantaran";
  if (/STANDING|PAPAN/.test(k)) return "papan";
  return "bouquet";
}
/** Unit tiap barang dalam satu transaksi. Jenis pesanan (dekorasi, seserahan, …) mengalahkan unit bawaan "bouquet";
 *  barang tanpa unit (Additional) ikut unit dengan nilai terbesar di transaksi itu. */
export function unitBarang(items, jenis = "", peta = {}){
  const viaJenis = UNIT_JENIS[jenis] || "";
  const awal = (items || []).map(i => { const u = unitKategori(i.kategori, peta); return viaJenis && (!u || u === "bouquet") && viaJenis !== "bouquet" ? viaJenis : u; });
  const nilai = {}; (items || []).forEach((i, n) => { if (awal[n]) nilai[awal[n]] = (nilai[awal[n]] || 0) + (i.harga || 0) * (i.qty || 1); });
  const utama = Object.keys(nilai).sort((a, b) => nilai[b] - nilai[a])[0] || viaJenis || "bouquet";
  return awal.map(u => u || utama);
}
