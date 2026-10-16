/* Ekspor/impor seluruh data toko dalam bentuk JSON.
   Dipakai untuk: cadangan & pulihkan di server Cloudflare (tidak ada file .db di sana),
   dan "kirim semua data perangkat ini" saat memindahkan iMin ke server baru. */
import { all, run, getSettings } from "./db.js";
import { versiSkema } from "./db.js";

/** Urutan induk → anak (untuk menyisipkan). Menghapus memakai urutan terbalik. */
export const TABEL_DATA = ["settings", "users", "products", "materials", "sales", "sale_items", "stock_moves", "produksi", "insentif_bayar", "expenses", "absen", "insentif_lain"];
const NAMA_AMAN = /^[a-z_][a-z0-9_]*$/;
/** Pengaturan milik perangkat/server masing-masing, tidak ikut dipindah. */
const SETELAN_LOKAL = k => k.startsWith("cabang_") || k === "impor_oleh";

export function eksporData(){
  const tabel = {};
  for (const t of TABEL_DATA) tabel[t] = all(`SELECT * FROM ${t} ORDER BY rowid`);
  tabel.settings = tabel.settings.filter(r => !SETELAN_LOKAL(r.kunci));
  return { format: "rich-gallery-data", versiSkema: versiSkema(), dibuat: new Date().toISOString(), toko: getSettings().nama_toko, tabel };
}

/** Kosongkan data toko (bukan daftar perangkat cabang). Sesi ikut terhapus, jadi semua pengguna masuk lagi. */
export function hapusData(){
  run("DELETE FROM sessions");
  for (const t of [...TABEL_DATA].reverse()) {
    if (t === "settings") { for (const r of all("SELECT kunci FROM settings")) if (!SETELAN_LOKAL(r.kunci)) run("DELETE FROM settings WHERE kunci = ?", [r.kunci]); }
    else run(`DELETE FROM ${t}`);
  }
  run("DELETE FROM outbox");
}

/** Sisipkan baris apa adanya (id ikut dipakai, supaya relasi antar tabel tetap utuh). */
export function sisipkanBaris(tabel, rows){
  if (!TABEL_DATA.includes(tabel)) throw new Error("Tabel tidak dikenal: " + tabel);
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    if (tabel === "settings" && SETELAN_LOKAL(String(r.kunci))) continue;
    const kol = Object.keys(r).filter(k => NAMA_AMAN.test(k));
    if (!kol.length) continue;
    run(`INSERT OR REPLACE INTO ${tabel}(${kol.join(", ")}) VALUES (${kol.map(() => "?").join(", ")})`, kol.map(k => r[k]));
    n++;
  }
  return n;
}

export function imporData(dump){
  if (!dump || dump.format !== "rich-gallery-data" || !dump.tabel) throw new Error("File bukan cadangan data Rich Gallery (.json)");
  if (dump.versiSkema > versiSkema()) throw new Error("Cadangan berasal dari versi aplikasi yang lebih baru. Perbarui server dulu.");
  hapusData();
  for (const t of TABEL_DATA) sisipkanBaris(t, dump.tabel[t]);
}
