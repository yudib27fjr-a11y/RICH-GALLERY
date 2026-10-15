import { route } from "../router.js";
import { one, all, tx } from "../db.js";
import { teks, angka, tanggal, pilihan, daftar, sekarang } from "../util.js";
import { ambilItem, ubahStok, antre } from "../stok.js";

const TABEL = { produk: "products", bahan: "materials" };
/** Untuk perintah ke server pusat: id lokal diganti kode barang (id di server bisa berbeda). */
const kodeDari = (jenis, id) => { const r = one(`SELECT kode FROM ${TABEL[jenis]} WHERE id = ?`, [+id]); return r ? r.kode : ""; };

/* Barang masuk & keluar, untuk produk jadi maupun bahan baku. */
route("POST", "/api/mutasi", "semua", ({ body, user }) => tx(() => {
  const tipe = pilihan(body.tipe, ["masuk", "keluar"], "Jenis mutasi");
  const jenis = pilihan(body.jenis, ["produk", "bahan"], "Jenis barang");
  const tgl = tanggal(body.tgl || sekarang().tgl);
  const ket = teks(body.ket, { max: 200, nama: "Keterangan" });
  const rows = daftar(body.items, { nama: "Daftar barang" }).map((x, i) => {
    const item = ambilItem(jenis, +x.id);
    const qty = angka(x.qty, { min: 0.01, max: 1e7, wajib: true, nama: `Jumlah ${item.nama}` });
    ubahStok({ jenis, item, delta: tipe === "masuk" ? qty : -qty, tipe, tgl, ket, user });
    return [tgl, sekarang().jam, jenis.toUpperCase(), item.kode, item.nama, qty, item.stok, ket, user.nama];
  });
  antre(tipe, rows);
  return { ok: true, jumlah: rows.length };
}), { cabang: ({ body }) => ({ aksi: "mutasi", data: {
  tipe: body.tipe, jenis: body.jenis, tgl: body.tgl || sekarang().tgl, ket: body.ket || "",
  items: body.items.map(x => ({ kode: kodeDari(body.jenis, x.id), qty: x.qty })),
} }) });

/* Riwayat buku stok. tipe bisa beberapa, dipisah koma: masuk,keluar,opname,koreksi,jual,batal,produksi */
route("GET", "/api/riwayat-stok", "semua", ({ query }) => {
  const tipe = String(query.tipe || "masuk").split(",").filter(t => ["masuk","keluar","opname","koreksi","jual","batal","produksi","hapus_produksi"].includes(t));
  if (!tipe.length) return [];
  const p = [...tipe]; let where = `tipe IN (${tipe.map(() => "?").join(",")})`;
  if (query.jenis) { where += " AND jenis = ?"; p.push(pilihan(query.jenis, ["produk", "bahan"], "Jenis")); }
  if (query.item_id) { where += " AND item_id = ?"; p.push(+query.item_id); }
  if (query.dari) { where += " AND tgl >= ?"; p.push(tanggal(query.dari)); }
  if (query.sampai) { where += " AND tgl <= ?"; p.push(tanggal(query.sampai)); }
  const limit = Math.min(1000, Math.max(1, +query.limit || 200));
  return all(`SELECT id, tgl, jam, jenis, item_id, kode, nama, tipe, qty, stok_sebelum, stok_sesudah, ref, ket, oleh FROM stock_moves WHERE ${where} ORDER BY id DESC LIMIT ${limit}`, p);
});

/* Stok opname: isi jumlah fisik, selisih dicatat dan stok disesuaikan. */
route("POST", "/api/opname", "semua", ({ body, user }) => tx(() => {
  const jenis = pilihan(body.jenis, ["produk", "bahan"], "Jenis barang");
  const ket = teks(body.ket, { max: 200, nama: "Keterangan" });
  const { tgl, jam } = sekarang();
  const rows = daftar(body.items, { nama: "Hasil hitung", max: 2000 }).map(x => {
    const item = ambilItem(jenis, +x.id);
    const fisik = angka(x.fisik, { min: -1e9, max: 1e9, wajib: true, nama: `Jumlah fisik ${item.nama}` });
    const sebelum = item.stok;
    ubahStok({ jenis, item, jadi: fisik, tipe: "opname", ket, user });
    return [tgl, jam, jenis.toUpperCase(), item.kode, item.nama, sebelum, fisik, Math.round((fisik - sebelum) * 100) / 100, user.nama, ket];
  });
  antre("opname", rows);
  return { ok: true, jumlah: rows.length };
}), { cabang: ({ body }) => ({ aksi: "opname", data: {
  jenis: body.jenis, ket: body.ket || "", items: body.items.map(x => ({ kode: kodeDari(body.jenis, x.id), fisik: x.fisik })),
} }) });
