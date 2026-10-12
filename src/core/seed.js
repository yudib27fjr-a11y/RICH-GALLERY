import { run, one, tx, getSettings } from "./db.js";
import { SEED_PRODUK, SEED_STOK_PRODUK, SEED_BAHAN } from "./seed-data.js";
import { tebakKategori, barcodeDefault } from "../../public/shared.js";

const KARYAWAN_AWAL = ["ALIT", "IZA", "MANU", "YUDI", "EVA", "SAVIRA"];

/** Mengisi data awal dari sheet PEMBUKUAN RG 2026. Hanya berjalan sekali, saat database masih kosong. */
export function seedJikaKosong(){
  if (one("SELECT COUNT(*) n FROM products").n > 0) return false;
  const hppPersen = getSettings().hpp_persen;
  const stok = {};
  SEED_STOK_PRODUK.split(",").forEach(p => { const [c, v] = p.split(":"); stok["RG" + c] = +v; });
  tx(() => {
    for (const l of SEED_PRODUK.trim().split("\n")) {
      const [kode, nama, harga] = l.split("|");
      run(`INSERT INTO products(kode, nama, kategori, harga, hpp, stok, stok_min, barcode) VALUES (?,?,?,?,?,?,1,?)`,
        [kode, nama, tebakKategori(nama), +harga, Math.round(+harga * hppPersen / 100), stok[kode] || 0, barcodeDefault("produk", kode)]);
    }
    for (const l of SEED_BAHAN.trim().split("\n")) {
      const [kode, nama, kategori, harga, s, min] = l.split("|");
      run(`INSERT INTO materials(kode, nama, kategori, harga, stok, stok_min, barcode) VALUES (?,?,?,?,?,?,?)`,
        [kode, nama, kategori, +harga, +s, +min, barcodeDefault("bahan", kode)]);
    }
    for (const n of KARYAWAN_AWAL) run("INSERT OR IGNORE INTO users(nama, nama_key, peran) VALUES (?, ?, 'karyawan')", [n, n.toLowerCase()]);
  });
  return true;
}
