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
