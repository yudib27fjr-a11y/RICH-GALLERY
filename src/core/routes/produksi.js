import { route } from "../router.js";
import { one, all, run, tx, getSettings } from "../db.js";
import { HttpError, bad, notFound, teks, angka, tanggal, daftar, sekarang } from "../util.js";
import { ambilItem, ubahStok, antre } from "../stok.js";
import { periodeDari } from "../../../public/shared.js";

const sudahDibayar = (pembuatId, tgl) => {
  const [dari] = periodeDari(tgl, getSettings().periode_mulai);
  return one("SELECT id FROM insentif_bayar WHERE pembuat_id = ? AND periode_dari = ?", [pembuatId, dari]);
};

/** Catat hasil produksi karyawan. Opsional menambah stok ready (restock). */
route("POST", "/api/produksi", "semua", ({ body, user }) => tx(() => {
  const s = getSettings(), today = sekarang().tgl;
  const tgl = tanggal(body.tgl || today);
  if (tgl > today) throw bad("Tanggal produksi tidak boleh di masa depan");
  // Karyawan hanya boleh mencatat untuk periode insentif yang sedang berjalan.
  if (user.peran !== "admin" && tgl < periodeDari(today, s.periode_mulai)[0]) throw bad("Karyawan hanya bisa mencatat produksi periode berjalan. Minta admin untuk tanggal lama.");
  const pembuat = one("SELECT id, nama FROM users WHERE id = ? AND aktif = 1", [+body.pembuat_id]);
  if (!pembuat) throw bad("Pilih pembuat");
  if (sudahDibayar(pembuat.id, tgl)) throw bad(`Insentif ${pembuat.nama} untuk periode ini sudah dibayar. Pilih tanggal di periode berikutnya.`);
  const restock = body.restock ? 1 : 0;
  const rows = daftar(body.items, { nama: "Daftar produk" }).map(x => {
    const p = ambilItem("produk", +x.product_id);
    const qty = angka(x.qty, { min: 0.01, max: 100000, wajib: true, nama: `Jumlah ${p.nama}` });
    const tarif = p.insentif ?? s.insentif;
    run(`INSERT INTO produksi(tgl, product_id, kode, nama, qty, pembuat_id, tarif, restock, user_id, oleh) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [tgl, p.id, p.kode, p.nama, qty, pembuat.id, tarif, restock, user.id, user.nama]);
    if (restock) ubahStok({ jenis: "produk", item: p, delta: qty, tipe: "produksi", tgl, ket: `Produksi ${pembuat.nama}`, user });
    return [tgl, p.kode, p.nama, qty, pembuat.nama, tarif, Math.round(qty * tarif), restock ? "RESTOCK" : "PESANAN", user.nama];
  });
  antre("produksi", rows);
  return { ok: true, jumlah: rows.length };
}));

/** Catatan produksi dalam rentang tanggal. Karyawan hanya melihat miliknya atau yang ia catat. */
route("GET", "/api/produksi", "semua", ({ query, user }) => {
  const dari = tanggal(query.dari), sampai = tanggal(query.sampai);
  let where = "p.tgl BETWEEN ? AND ?", prm = [dari, sampai];
  if (user.peran !== "admin") { where += " AND (p.pembuat_id = ? OR p.user_id = ?)"; prm.push(user.id, user.id); }
  return all(`SELECT p.id, p.tgl, p.kode, p.nama, p.qty, p.tarif, p.restock, p.pembuat_id, u.nama pembuat, p.oleh, p.user_id,
    EXISTS (SELECT 1 FROM insentif_bayar b WHERE b.pembuat_id = p.pembuat_id AND p.tgl BETWEEN b.periode_dari AND b.periode_sampai) dibayar
    FROM produksi p JOIN users u ON u.id = p.pembuat_id WHERE ${where} ORDER BY p.id DESC LIMIT 1000`, prm);
});

route("DELETE", "/api/produksi/:id", "semua", ({ params, user }) => tx(() => {
  const r = one("SELECT * FROM produksi WHERE id = ?", [+params.id]);
  if (!r) throw notFound("Catatan produksi tidak ditemukan");
  if (user.peran !== "admin" && !(r.user_id === user.id && r.tgl === sekarang().tgl)) throw new HttpError(403, "Karyawan hanya bisa menghapus catatan yang ia buat hari ini");
  if (sudahDibayar(r.pembuat_id, r.tgl)) throw bad("Insentif periode ini sudah dibayar, catatan tidak bisa dihapus");
  if (r.restock && r.product_id) {
    const p = one("SELECT * FROM products WHERE id = ?", [r.product_id]);
    if (p) ubahStok({ jenis: "produk", item: p, delta: -r.qty, tipe: "hapus_produksi", ket: "Catatan produksi dihapus", user });
  }
  run("DELETE FROM produksi WHERE id = ?", [r.id]);
  const pembuat = one("SELECT nama FROM users WHERE id = ?", [r.pembuat_id]);
  antre("hapus_produksi", [[r.tgl, r.kode, r.nama, r.qty, pembuat?.nama || "", sekarang().tgl, user.nama]]);
  return { ok: true };
}));

/** Rekap insentif satu periode (tanggal apa pun di dalam periode). */
export function rekapInsentif(tglDalam, hanyaUser = null){
  const [dari, sampai] = periodeDari(tglDalam, getSettings().periode_mulai);
  const pembuat = hanyaUser ? all("SELECT id, nama FROM users WHERE id = ?", [hanyaUser])
    : all(`SELECT id, nama FROM users WHERE (aktif = 1 AND peran = 'karyawan') OR id IN (SELECT pembuat_id FROM produksi WHERE tgl BETWEEN ? AND ?) ORDER BY nama`, [dari, sampai]);
  const rows = pembuat.map(u => {
    const detail = all(`SELECT nama, tarif, SUM(qty) qty FROM produksi WHERE pembuat_id = ? AND tgl BETWEEN ? AND ? GROUP BY nama, tarif ORDER BY SUM(qty) DESC`, [u.id, dari, sampai]);
    const qty = detail.reduce((a, d) => a + d.qty, 0), insentif = Math.round(detail.reduce((a, d) => a + d.qty * d.tarif, 0));
    const bayar = one("SELECT nominal, tgl, ket, oleh FROM insentif_bayar WHERE pembuat_id = ? AND periode_dari = ?", [u.id, dari]);
    return { pembuat_id: u.id, nama: u.nama, qty, insentif, bayar, detail };
  });
  return { dari, sampai, rows };
}

route("GET", "/api/insentif", "semua", ({ query, user }) =>
  rekapInsentif(tanggal(query.tgl || sekarang().tgl), user.peran === "admin" ? null : user.id));

route("POST", "/api/insentif/bayar", "admin", ({ body, user }) => tx(() => {
  const tgl = tanggal(body.tgl || sekarang().tgl, { nama: "Tanggal bayar" });
  const rek = rekapInsentif(tanggal(body.periode_dari, { nama: "Periode" }), +body.pembuat_id);
  const r = rek.rows[0];
  if (!r) throw bad("Karyawan tidak ditemukan");
  if (r.bayar) throw bad("Insentif periode ini sudah dibayar");
  if (!r.qty) throw bad("Belum ada produksi di periode ini");
  const nominal = angka(body.nominal, { min: 0, max: 1e10, bulat: true, nama: "Nominal" }) ?? r.insentif;
  const ket = teks(body.ket, { max: 200, nama: "Catatan" });
  let expenseId = null;
  if (body.catat_pengeluaran && nominal) {
    const desk = `Insentif ${r.nama} ${rek.dari} s/d ${rek.sampai} (${r.qty} pcs)`;
    expenseId = Number(run("INSERT INTO expenses(tgl, kategori, ket, nominal, user_id, oleh) VALUES (?, 'Insentif Produksi', ?, ?, ?, ?)", [tgl, desk, nominal, user.id, user.nama]).lastInsertRowid);
    antre("pengeluaran", [[String(expenseId), tgl, "Insentif Produksi", desk, nominal, user.nama]]);
  }
  run(`INSERT INTO insentif_bayar(pembuat_id, periode_dari, periode_sampai, qty, hitung, nominal, tgl, ket, expense_id, user_id, oleh) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [r.pembuat_id, rek.dari, rek.sampai, r.qty, r.insentif, nominal, tgl, ket, expenseId, user.id, user.nama]);
  antre("insentif", [[tgl, r.nama, rek.dari, rek.sampai, r.qty, r.insentif, nominal, ket, user.nama]]);
  return { ok: true };
}));
