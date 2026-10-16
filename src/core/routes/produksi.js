import { route } from "../router.js";
import { one, all, run, tx, getSettings } from "../db.js";
import { HttpError, bad, notFound, teks, angka, tanggal, daftar, sekarang } from "../util.js";
import { ambilItem, ubahStok, antre } from "../stok.js";
import { periodeDari } from "../../../public/shared.js";
import { lemburPeriode } from "./absen.js";
import { cabangAktif, mintaPusat } from "../cabang-perangkat.js";

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
  const uid = body.uid ? teks(body.uid, { max: 80, nama: "uid" }) : null;
  const rows = daftar(body.items, { nama: "Daftar produk" }).map((x, i) => {
    const p = ambilItem("produk", +x.product_id);
    const qty = angka(x.qty, { min: 0.01, max: 100000, wajib: true, nama: `Jumlah ${p.nama}` });
    const tarif = p.insentif ?? s.insentif;
    run(`INSERT INTO produksi(tgl, product_id, kode, nama, qty, pembuat_id, tarif, restock, user_id, oleh, uid) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [tgl, p.id, p.kode, p.nama, qty, pembuat.id, tarif, restock, user.id, user.nama, uid ? `${uid}:${i}` : null]);
    if (restock) ubahStok({ jenis: "produk", item: p, delta: qty, tipe: "produksi", tgl, ket: `Produksi ${pembuat.nama}`, user });
    return [tgl, p.kode, p.nama, qty, pembuat.nama, tarif, Math.round(qty * tarif), restock ? "RESTOCK" : "PESANAN", user.nama];
  });
  antre("produksi", rows);
  return { ok: true, jumlah: rows.length };
}), { uid: true, cabang: ({ body }) => ({ aksi: "produksi", data: {
  uid: body.uid, tgl: body.tgl || sekarang().tgl, restock: body.restock ? 1 : 0,
  pembuat: (one("SELECT nama FROM users WHERE id = ?", [+body.pembuat_id]) || {}).nama || "",
  items: body.items.map(x => ({ kode: (one("SELECT kode FROM products WHERE id = ?", [+x.product_id]) || {}).kode || "", qty: x.qty })),
} }) });

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
}), {
  pra: ({ params }) => one("SELECT uid FROM produksi WHERE id = ?", [+params.id]),
  cabang: ({ pra }) => {
    if (!pra || !pra.uid) throw new HttpError(409, "Catatan ini dibuat sebelum perangkat tersambung ke server pusat. Hapus catatan ini dari server pusat.");
    return { aksi: "hapus_produksi", data: { uid: pra.uid } };
  },
});

/* ================= Insentif lain =================
   Selain insentif produksi: jasa kurir non online, kerja lapangan, dan buat konten.
   Nominal bawaan per kegiatan diatur admin (Pengaturan → Jam kerja, lembur & insentif lain) dan bisa diubah saat dicatat. */
export const JENIS_LAIN = { kurir: "Jasa kurir non online", lapangan: "Kerja lapangan", konten: "Buat konten" };

route("GET", "/api/insentif-lain", "semua", ({ query, user }) => {
  const dari = tanggal(query.dari), sampai = tanggal(query.sampai);
  let where = "l.dihapus IS NULL AND l.tgl BETWEEN ? AND ?", prm = [dari, sampai];
  if (user.peran !== "admin") { where += " AND (l.user_id = ? OR l.oleh_id = ?)"; prm.push(user.id, user.id); }
  return all(`SELECT l.id, l.tgl, l.user_id, u.nama, l.jenis, l.nominal, l.ket, l.oleh, l.oleh_id,
    EXISTS (SELECT 1 FROM insentif_bayar b WHERE b.pembuat_id = l.user_id AND l.tgl BETWEEN b.periode_dari AND b.periode_sampai) dibayar
    FROM insentif_lain l JOIN users u ON u.id = l.user_id WHERE ${where} ORDER BY l.tgl DESC, l.id DESC LIMIT 1000`, prm);
});

route("POST", "/api/insentif-lain", "semua", ({ body, user }) => tx(() => {
  const s = getSettings(), today = sekarang().tgl;
  const tgl = tanggal(body.tgl || today);
  if (tgl > today) throw bad("Tanggal tidak boleh di masa depan");
  if (user.peran !== "admin" && tgl < periodeDari(today, s.periode_mulai)[0]) throw bad("Karyawan hanya bisa mencatat untuk periode berjalan. Minta admin untuk tanggal lama.");
  const k = one("SELECT id, nama FROM users WHERE id = ? AND aktif = 1", [+body.user_id]);
  if (!k) throw bad("Pilih karyawan");
  if (!JENIS_LAIN[body.jenis]) throw bad("Pilih jenis insentif");
  if (sudahDibayar(k.id, tgl)) throw bad(`Insentif ${k.nama} untuk periode ini sudah dibayar. Pilih tanggal di periode berikutnya.`);
  const nominal = angka(body.nominal ?? s["ins_" + body.jenis], { min: 0, max: 1e9, bulat: true, wajib: true, nama: "Nominal" });
  const ket = teks(body.ket, { max: 200, nama: "Keterangan" });
  const uid = body.uid ? teks(body.uid, { max: 80, nama: "uid" }) : null;
  const id = Number(run("INSERT INTO insentif_lain(tgl, user_id, jenis, nominal, ket, uid, oleh, oleh_id) VALUES (?,?,?,?,?,?,?,?)",
    [tgl, k.id, body.jenis, nominal, ket, uid, user.nama, user.id]).lastInsertRowid);
  antre("insentif_lain", [[tgl, k.nama, JENIS_LAIN[body.jenis], nominal, ket, user.nama]]);
  return { id };
}), { uid: true, cabang: ({ body }) => ({ aksi: "insentif_lain", data: {
  uid: body.uid, tgl: body.tgl || sekarang().tgl, jenis: body.jenis, nominal: body.nominal, ket: body.ket || "",
  karyawan: (one("SELECT nama FROM users WHERE id = ?", [+body.user_id]) || {}).nama || "",
} }) });

route("DELETE", "/api/insentif-lain/:id", "semua", ({ params, user }) => tx(() => {
  const r = one("SELECT * FROM insentif_lain WHERE id = ? AND dihapus IS NULL", [+params.id]);
  if (!r) throw notFound("Catatan insentif tidak ditemukan");
  if (user.peran !== "admin" && !(r.oleh_id === user.id && r.tgl === sekarang().tgl)) throw new HttpError(403, "Karyawan hanya bisa menghapus catatan yang ia buat hari ini");
  if (sudahDibayar(r.user_id, r.tgl)) throw bad("Insentif periode ini sudah dibayar, catatan tidak bisa dihapus");
  run("UPDATE insentif_lain SET dihapus = datetime('now') WHERE id = ?", [r.id]);
  return { ok: true };
}), {
  pra: ({ params }) => one("SELECT id, uid FROM insentif_lain WHERE id = ?", [+params.id]),
  cabang: ({ pra }) => {
    if (!pra || !pra.uid) throw new HttpError(409, "Catatan ini dibuat sebelum perangkat tersambung ke server pusat. Hapus dari server pusat.");
    return { aksi: "hapus_insentif_lain", data: { uid: pra.uid } };
  },
});

/** Rekap insentif satu periode (tanggal apa pun di dalam periode): produksi + insentif lain + lembur.
 *  lembur: daftar {nama_key, menit, rp} dari data absen (null = tidak tersedia, mis. perangkat sedang offline). */
export function rekapInsentif(tglDalam, hanyaUser = null, lembur = undefined){
  const [dari, sampai] = periodeDari(tglDalam, getSettings().periode_mulai);
  if (lembur === undefined) lembur = lemburPeriode(dari, sampai);
  const perKunci = new Map((lembur || []).map(l => [l.nama_key, l]));
  const kunciLembur = [...perKunci.keys()];
  const pembuat = hanyaUser ? all("SELECT id, nama, nama_key FROM users WHERE id = ?", [hanyaUser])
    : all(`SELECT id, nama, nama_key FROM users WHERE (aktif = 1 AND peran = 'karyawan') OR id IN (SELECT pembuat_id FROM produksi WHERE tgl BETWEEN ? AND ?)
      OR id IN (SELECT user_id FROM insentif_lain WHERE dihapus IS NULL AND tgl BETWEEN ? AND ?)
      OR nama_key IN (${kunciLembur.map(() => "?").join(",") || "''"}) ORDER BY nama`, [dari, sampai, dari, sampai, ...kunciLembur]);
  const rows = pembuat.map(u => {
    const detail = all(`SELECT nama, tarif, SUM(qty) qty FROM produksi WHERE pembuat_id = ? AND tgl BETWEEN ? AND ? GROUP BY nama, tarif ORDER BY SUM(qty) DESC`, [u.id, dari, sampai]);
    const qty = detail.reduce((a, d) => a + d.qty, 0), insentif = Math.round(detail.reduce((a, d) => a + d.qty * d.tarif, 0));
    const lainDetail = all(`SELECT jenis, COUNT(*) kali, SUM(nominal) nominal FROM insentif_lain WHERE user_id = ? AND dihapus IS NULL AND tgl BETWEEN ? AND ? GROUP BY jenis ORDER BY jenis`, [u.id, dari, sampai])
      .map(d => ({ ...d, label: JENIS_LAIN[d.jenis] || d.jenis }));
    const lain = lainDetail.reduce((a, d) => a + d.nominal, 0);
    const l = perKunci.get(u.nama_key);
    const lembur_menit = l ? l.menit : 0, lembur_rp = l ? l.rp : 0;
    const bayar = one("SELECT nominal, tgl, ket, oleh FROM insentif_bayar WHERE pembuat_id = ? AND periode_dari = ?", [u.id, dari]);
    return { pembuat_id: u.id, nama: u.nama, qty, insentif, lain, lainDetail, lembur_menit, lembur_rp, total: insentif + lain + lembur_rp, bayar, detail };
  });
  return { dari, sampai, rows, lemburTersedia: lembur !== null };
}

route("GET", "/api/insentif", "semua", async ({ query, user }) => {
  const tgl = tanggal(query.tgl || sekarang().tgl);
  let lembur;
  // Perangkat cabang: data absen ada di server pusat, jadi lembur diambil dari sana (bila sedang offline, lembur tidak ditampilkan).
  if (cabangAktif()) {
    const [dari, sampai] = periodeDari(tgl, getSettings().periode_mulai);
    try { lembur = (await mintaPusat("/api/cabang/lembur", { dari, sampai })).lembur; } catch { lembur = null; }
  }
  return rekapInsentif(tgl, user.peran === "admin" ? null : user.id, lembur);
});

route("POST", "/api/insentif/bayar", "admin", ({ body, user }) => tx(() => {
  const tgl = tanggal(body.tgl || sekarang().tgl, { nama: "Tanggal bayar" });
  const rek = rekapInsentif(tanggal(body.periode_dari, { nama: "Periode" }), +body.pembuat_id);
  const r = rek.rows[0];
  if (!r) throw bad("Karyawan tidak ditemukan");
  if (r.bayar) throw bad("Insentif periode ini sudah dibayar");
  if (!r.qty && !r.total) throw bad("Belum ada produksi, insentif lain, atau lembur di periode ini");
  const nominal = angka(body.nominal, { min: 0, max: 1e10, bulat: true, nama: "Nominal" }) ?? r.total;
  const ket = teks(body.ket, { max: 200, nama: "Catatan" });
  let expenseId = null;
  if (body.catat_pengeluaran && nominal) {
    const rinci = [r.qty ? `${r.qty} pcs` : "", r.lain ? "insentif lain" : "", r.lembur_menit ? `lembur ${+(r.lembur_menit / 60).toFixed(2)} jam` : ""].filter(Boolean).join(", ");
    const desk = `Insentif ${r.nama} ${rek.dari} s/d ${rek.sampai} (${rinci})`;
    expenseId = Number(run("INSERT INTO expenses(tgl, kategori, ket, nominal, user_id, oleh) VALUES (?, 'Insentif Produksi', ?, ?, ?, ?)", [tgl, desk, nominal, user.id, user.nama]).lastInsertRowid);
    antre("pengeluaran", [[String(expenseId), tgl, "Insentif Produksi", desk, nominal, user.nama]]);
  }
  run(`INSERT INTO insentif_bayar(pembuat_id, periode_dari, periode_sampai, qty, hitung, nominal, tgl, ket, expense_id, user_id, oleh) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [r.pembuat_id, rek.dari, rek.sampai, r.qty, r.total, nominal, tgl, ket, expenseId, user.id, user.nama]);
  antre("insentif", [[tgl, r.nama, rek.dari, rek.sampai, r.qty, r.insentif, nominal, ket, user.nama]]);
  return { ok: true };
}));
