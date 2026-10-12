import { route } from "../router.js";
import { one, run, tx, getSettings } from "../db.js";
import { bad, teks, angka, pilihan, hariIni } from "../util.js";
import { ambilItem, ubahStok, antre } from "../stok.js";
import { KATEGORI, KAT_BAHAN, barcodeDefault, tebakKategori } from "../../../public/shared.js";

const TABEL = { produk: "products", bahan: "materials" };

function kodeBerikutnya(jenis){
  const t = TABEL[jenis];
  const r = one(`SELECT MAX(CAST(SUBSTR(kode, 3) AS INTEGER)) n FROM ${t} WHERE kode GLOB 'RG[0-9]*'`);
  return "RG" + String((r.n || 0) + 1).padStart(3, "0");
}
/** Barcode harus unik di produk dan bahan sekaligus, karena satu alat scan dipakai untuk keduanya. */
function cekBarcode(bc, jenis, id){
  for (const j of ["produk", "bahan"]) {
    const r = one(`SELECT id, nama FROM ${TABEL[j]} WHERE barcode = ? AND dihapus IS NULL`, [bc]);
    if (r && !(j === jenis && r.id === id)) throw bad(`Barcode sudah dipakai ${r.nama}`);
  }
}

function simpan(jenis, body, user, id = null){
  const s = getSettings();
  const lama = id ? ambilItem(jenis, id) : null;
  const kode = lama ? lama.kode : (teks(body.kode, { max: 20, upper: true, nama: "Kode" }) || kodeBerikutnya(jenis));
  if (!lama && one(`SELECT 1 x FROM ${TABEL[jenis]} WHERE kode = ? AND dihapus IS NULL`, [kode])) throw bad("Kode sudah dipakai");
  const nama = teks(body.nama, { wajib: true, max: 120, upper: true, nama: "Nama" });
  const kategori = jenis === "produk"
    ? (body.kategori ? pilihan(body.kategori, KATEGORI, "Kategori") : tebakKategori(nama))
    : pilihan(body.kategori || "LAIN-LAIN", KAT_BAHAN, "Kategori");
  const harga = angka(body.harga, { min: 0, max: 1e10, bulat: true, nama: "Harga" }) ?? 0;
  const stokMin = angka(body.stok_min, { min: 0, max: 1e6, nama: "Stok minimum" }) ?? (jenis === "produk" ? 1 : 5);
  const barcode = teks(body.barcode, { max: 40, nama: "Barcode" }) || barcodeDefault(jenis, kode) || null;
  if (barcode) cekBarcode(barcode, jenis, id);
  const stokBaru = angka(body.stok, { min: -1e9, max: 1e9, nama: "Stok" });

  let itemId = id;
  if (jenis === "produk") {
    const hpp = angka(body.hpp, { min: 0, max: 1e10, bulat: true, nama: "HPP" }) ?? Math.round(harga * s.hpp_persen / 100);
    const insentif = angka(body.insentif, { min: 0, max: 1e8, bulat: true, nama: "Insentif" });
    const aktif = body.aktif == null ? 1 : (body.aktif ? 1 : 0);
    if (lama) run(`UPDATE products SET nama=?, kategori=?, harga=?, hpp=?, stok_min=?, barcode=?, insentif=?, aktif=?, diubah=datetime('now') WHERE id=?`, [nama, kategori, harga, hpp, stokMin, barcode, insentif, aktif, id]);
    else itemId = Number(run(`INSERT INTO products(kode, nama, kategori, harga, hpp, stok_min, barcode, insentif, aktif) VALUES (?,?,?,?,?,?,?,?,?)`, [kode, nama, kategori, harga, hpp, stokMin, barcode, insentif, aktif]).lastInsertRowid);
  } else {
    const satuan = teks(body.satuan, { max: 12, upper: true, nama: "Satuan" }) || "PCS";
    if (lama) run(`UPDATE materials SET nama=?, kategori=?, harga=?, satuan=?, stok_min=?, barcode=?, diubah=datetime('now') WHERE id=?`, [nama, kategori, harga, satuan, stokMin, barcode, id]);
    else itemId = Number(run(`INSERT INTO materials(kode, nama, kategori, harga, satuan, stok_min, barcode) VALUES (?,?,?,?,?,?,?)`, [kode, nama, kategori, harga, satuan, stokMin, barcode]).lastInsertRowid);
  }
  // Perubahan angka stok dari form dicatat sebagai koreksi, supaya tetap terlacak di riwayat opname.
  const item = ambilItem(jenis, itemId);
  if (stokBaru != null && stokBaru !== item.stok) {
    const sebelum = item.stok;
    ubahStok({ jenis, item, jadi: stokBaru, tipe: "koreksi", ket: lama ? "Koreksi dari form barang" : "Stok awal", user });
    antre("opname", [[hariIni(), "", jenis.toUpperCase(), item.kode, item.nama, sebelum, stokBaru, stokBaru - sebelum, user.nama, lama ? "Koreksi dari form barang" : "Stok awal"]]);
  }
  return ambilItem(jenis, itemId);
}

for (const jenis of ["produk", "bahan"]) {
  route("POST", `/api/${jenis}`, "admin", ({ body, user }) => tx(() => simpan(jenis, body, user)));
  route("PUT", `/api/${jenis}/:id`, "admin", ({ body, user, params }) => tx(() => simpan(jenis, body, user, +params.id)));
  route("DELETE", `/api/${jenis}/:id`, "admin", ({ params }) => {
    const item = ambilItem(jenis, +params.id);
    run(`UPDATE ${TABEL[jenis]} SET dihapus = datetime('now') WHERE id = ?`, [item.id]);
    return { ok: true };
  });
}
