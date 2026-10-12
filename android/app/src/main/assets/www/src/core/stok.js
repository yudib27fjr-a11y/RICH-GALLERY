import { one, run } from "./db.js";
import { notFound, sekarang, bulat2 } from "./util.js";

const TABEL = { produk: "products", bahan: "materials" };

export function ambilItem(jenis, id){
  const r = one(`SELECT * FROM ${TABEL[jenis]} WHERE id = ? AND dihapus IS NULL`, [id]);
  if (!r) throw notFound(`${jenis === "produk" ? "Produk" : "Bahan"} tidak ditemukan (mungkin sudah dihapus)`);
  return r;
}

/**
 * Satu-satunya jalan untuk mengubah stok. Mengubah angka stok dan mencatat buku stok (stock_moves).
 * Pakai `delta` untuk tambah/kurang, atau `jadi` untuk menetapkan angka (opname/koreksi).
 * Harus dipanggil di dalam tx().
 */
export function ubahStok({ jenis, item, delta, jadi, tipe, tgl, ref = "", ket = "", user }){
  const sebelum = item.stok;
  const sesudah = bulat2(jadi != null ? jadi : sebelum + delta);
  const { jam, tgl: hari } = sekarang();
  run(`UPDATE ${TABEL[jenis]} SET stok = ?, diubah = datetime('now') WHERE id = ?`, [sesudah, item.id]);
  run(`INSERT INTO stock_moves(tgl, jam, jenis, item_id, kode, nama, tipe, qty, stok_sebelum, stok_sesudah, ref, ket, user_id, oleh)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [tgl || hari, jam, jenis, item.id, item.kode, item.nama, tipe, bulat2(sesudah - sebelum), sebelum, sesudah, ref, ket, user?.id, user?.nama || ""]);
  item.stok = sesudah;
  return sesudah;
}

/** Antrean baris untuk dikirim ke Google Sheet (tab APP …). */
export function antre(tipe, baris){ for (const b of baris) run("INSERT INTO outbox(tipe, baris) VALUES (?, ?)", [tipe, JSON.stringify(b)]); }
