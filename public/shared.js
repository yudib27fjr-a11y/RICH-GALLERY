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
