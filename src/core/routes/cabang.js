/* Sinkron perangkat cabang ↔ server pusat.
   Di perangkat (iMin, mode offline): /api/cabang (status), /sambung, /putus, /sinkron.
   Di server pusat: /api/cabang/daftar, /kirim, /tarik (diakses perangkat dengan token perangkat), dan daftar perangkat untuk admin. */
import { route, cariRoute } from "../router.js";
import { one, all, run, tx, getSettings, setSetting } from "../db.js";
import { hapusData, sisipkanBaris, TABEL_DATA } from "../ekspor.js";
import { platform } from "../platform.js";
import { HttpError, bad, notFound, teks, denganWaktu } from "../util.js";
import { cekPassword, cekBatasLogin, catatGagal, resetGagal } from "../auth.js";
import { statusCabang, sinkronCabang, sambungCabang, putusCabang } from "../cabang-perangkat.js";

/* ================= di perangkat ================= */
route("GET", "/api/cabang", "admin", () => statusCabang());
route("POST", "/api/cabang/sambung", "admin", async ({ body }) => sambungCabang({
  url: teks(body.url, { wajib: true, max: 300, nama: "Alamat server" }),
  nama: teks(body.nama, { wajib: true, max: 40, nama: "Nama admin server" }),
  password: String(body.password ?? ""),
  perangkat: teks(body.perangkat, { max: 40, nama: "Nama perangkat" }),
  paksa: !!body.paksa,
  unggahAwal: !!body.unggahAwal,
}), { batas: 100_000 });
route("POST", "/api/cabang/putus", "admin", ({ body }) => putusCabang({ paksa: !!body.paksa }));
route("POST", "/api/cabang/sinkron", "semua", () => sinkronCabang());

/* Di mode cabang, data induk hanya diubah di server pusat (perangkat menerimanya saat sinkron). */
for (const [m, p] of [
  ["POST", "/api/produk"], ["PUT", "/api/produk/1"], ["DELETE", "/api/produk/1"],
  ["POST", "/api/bahan"], ["PUT", "/api/bahan/1"], ["DELETE", "/api/bahan/1"],
  ["POST", "/api/users"], ["PUT", "/api/users/1"], ["POST", "/api/akun/password"],
  ["PUT", "/api/pengaturan"], ["POST", "/api/insentif/bayar"],
  ["POST", "/api/pulihkan"], ["POST", "/api/impor-lama"], ["POST", "/api/sync/tarik"],
]) { const r = cariRoute(m, p); if (r) r.opsi.pusatSaja = true; }

/* ================= di server pusat ================= */
function perangkatDariToken(token){
  const d = token ? one("SELECT * FROM perangkat WHERE token_hash = ? AND dicabut IS NULL", [platform.sha256(String(token))]) : null;
  if (!d) throw new HttpError(401, "Perangkat tidak dikenal atau sudah dicabut. Sambungkan ulang dari Pengaturan di perangkat.");
  run("UPDATE perangkat SET terakhir = datetime('now') WHERE id = ?", [d.id]);
  return d;
}
const serverKosong = () => one("SELECT (SELECT COUNT(*) FROM sales) + (SELECT COUNT(*) FROM produksi) + (SELECT COUNT(*) FROM expenses) n").n === 0;
function kodeBerikutnya(){
  const dipakai = new Set(all("SELECT kode FROM perangkat").map(r => r.kode));
  for (const c of "ABCDEFGHJKLMNPQRSTUVWXYZ") if (!dipakai.has(c)) return c;
  for (let i = 1; ; i++) if (!dipakai.has("P" + i)) return "P" + i;
}

route("POST", "/api/cabang/daftar", false, ({ body, ctx }) => {
  const nama = teks(body.nama, { wajib: true, max: 40, nama: "Nama admin" });
  const kunci = (ctx.ip || "") + "|cabang|" + nama.toLowerCase();
  cekBatasLogin(kunci);
  const u = one("SELECT id, nama, peran, pass_hash, aktif FROM users WHERE nama_key = ?", [nama.toLowerCase()]);
  if (!u || !u.aktif || u.peran !== "admin" || !cekPassword(String(body.password ?? ""), u.pass_hash)) {
    catatGagal(kunci);
    throw new HttpError(401, "Nama atau password admin server salah");
  }
  resetGagal(kunci);
  // Pastikan data server sudah memuat transaksi terakhir perangkat (dipindah lewat cadangan → pulihkan).
  const noTerakhir = teks(body.noTerakhir, { max: 60 });
  if (noTerakhir && !body.paksa && !one("SELECT 1 x FROM sales WHERE no = ?", [noTerakhir])) {
    throw new HttpError(409, `Transaksi terakhir perangkat ini (${noTerakhir}) belum ada di server. Pindahkan dulu datanya: simpan cadangan di perangkat, lalu pulihkan di server. Atau sambungkan paksa bila transaksi lama memang tidak perlu dipindah.`);
  }
  if (body.unggahAwal && !serverKosong()) throw new HttpError(409, "Server sudah berisi transaksi, jadi data awal tidak bisa dikirim ke sini. Sambungkan tanpa memindah data, atau pakai server yang masih baru.");
  const token = platform.token();
  const kode = kodeBerikutnya();
  const namaPerangkat = teks(body.perangkat, { max: 40 }) || "Perangkat kasir";
  run("INSERT INTO perangkat(kode, nama, token_hash, admin_id) VALUES (?,?,?,?)", [kode, namaPerangkat, platform.sha256(token), u.id]);
  return { token, kode, nama: namaPerangkat };
});

/* Unggah awal: perangkat mengirim SELURUH datanya ke server yang masih kosong (pindah ke server baru, mis. Cloudflare).
   Dikirim bertahap per tabel; bagian pertama (mulai) mengosongkan server, bagian terakhir (selesai) menutup. */
route("POST", "/api/cabang/unggah-awal", false, ({ body }) => {
  const alat = perangkatDariToken(body.token);
  return tx(() => {
    if (body.mulai) {
      if (!serverKosong() && String(getSettings().impor_oleh) !== String(alat.id)) throw new HttpError(409, "Server sudah berisi transaksi, jadi data awal tidak bisa dikirim ke sini. Sambungkan tanpa memindah data, atau pakai server yang masih baru.");
      hapusData();
      setSetting("impor_oleh", String(alat.id));
    } else if (String(getSettings().impor_oleh) !== String(alat.id)) {
      throw new HttpError(409, "Pengiriman data awal belum dimulai. Ulangi dari awal.");
    }
    const tabel = String(body.tabel || "");
    const n = tabel ? sisipkanBaris(tabel, body.rows) : 0;
    if (body.selesai) {
      setSetting("impor_oleh", "");
      const admin = one("SELECT id FROM users WHERE peran = 'admin' AND aktif = 1 ORDER BY id LIMIT 1");
      if (admin) run("UPDATE perangkat SET admin_id = ? WHERE admin_id NOT IN (SELECT id FROM users)", [admin.id]);
    }
    return { ok: true, n };
  });
}, { batas: 8_000_000 });

const TABEL = { produk: "products", bahan: "materials" };
const idBarang = (jenis, kode) => kode ? one(`SELECT id FROM ${TABEL[jenis]} WHERE kode = ? AND dihapus IS NULL`, [kode]) : null;
const userNama = nama => nama ? one("SELECT id, nama, peran FROM users WHERE nama_key = ? AND aktif = 1", [String(nama).toLowerCase()]) : null;

/** Jalankan handler endpoint biasa di server, sebagai user pembuat dan pada waktu asli transaksinya. */
function panggil(method, path, body, user, waktu, replay = {}){
  const r = cariRoute(method, path);
  const m = path.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  return denganWaktu(waktu, () => r.handler({ user, params, query: {}, body, ctx: { replay } }));
}

/** Satu perintah dari perangkat → perubahan yang sama di server. Galat HttpError = ditolak permanen. */
function terapkan(p, d, alat){
  const user = userNama(p.oleh) || one("SELECT id, nama, peran FROM users WHERE id = ?", [alat.admin_id]);
  if (!user) throw bad("Pembuat transaksi tidak dikenal di server");
  const w = p.waktu && p.waktu.tgl ? { tgl: p.waktu.tgl, jam: p.waktu.jam || "00:00" } : null;
  const x = p.data || {};
  const daftarBarang = (jenis, items, isi) => {
    const hasil = [];
    for (const it of Array.isArray(items) ? items : []) { const b = idBarang(jenis, it.kode); if (b) hasil.push({ id: b.id, ...isi(it) }); }
    if (!hasil.length) throw bad("Barang dalam transaksi ini tidak ada di server");
    return hasil;
  };
  switch (p.aksi) {
    case "jual": {
      const items = (Array.isArray(x.items) ? x.items : []).map(i => {
        const b = idBarang("produk", i.kode);
        return b ? { product_id: b.id, harga: i.harga, qty: i.qty, ready: i.ready } : { nama: i.nama, kategori: i.kategori, harga: i.harga, qty: i.qty };
      });
      return panggil("POST", "/api/penjualan", { items, diskon: x.diskon, ongkir: x.ongkir, metode: x.metode, bayar: x.bayar, pelanggan: x.pelanggan, hp: x.hp, catatan: x.catatan },
        user, { tgl: x.tgl || w?.tgl, jam: x.jam || w?.jam }, { no: x.no, tgl: x.tgl, jam: x.jam });
    }
    case "batal": {
      const s = one("SELECT id, batal_at FROM sales WHERE no = ?", [String(x.no || "")]);
      if (!s) throw bad(`Transaksi ${x.no} tidak ada di server`);
      if (s.batal_at) return { ok: true };
      return panggil("POST", `/api/penjualan/${s.id}/batal`, { alasan: x.alasan }, user, w);
    }
    case "mutasi":
      return panggil("POST", "/api/mutasi", { tipe: x.tipe, jenis: x.jenis, tgl: x.tgl, ket: x.ket, items: daftarBarang(x.jenis, x.items, i => ({ qty: i.qty })) }, user, w);
    case "opname":
      return panggil("POST", "/api/opname", { jenis: x.jenis, ket: x.ket, items: daftarBarang(x.jenis, x.items, i => ({ fisik: i.fisik })) }, user, w);
    case "produksi": {
      const pembuat = userNama(x.pembuat);
      if (!pembuat) throw bad(`Pembuat ${x.pembuat || "-"} tidak ada atau tidak aktif di server`);
      const items = daftarBarang("produk", x.items, i => ({ qty: i.qty })).map(i => ({ product_id: i.id, qty: i.qty }));
      return panggil("POST", "/api/produksi", { uid: x.uid, tgl: x.tgl, pembuat_id: pembuat.id, restock: x.restock, items }, user, w);
    }
    case "hapus_produksi": {
      const r = one("SELECT id FROM produksi WHERE uid = ?", [String(x.uid || "")]);
      if (!r) throw bad("Catatan produksi yang dihapus tidak ada di server");
      return panggil("DELETE", `/api/produksi/${r.id}`, {}, user, w);
    }
    case "pengeluaran":
      return panggil("POST", "/api/pengeluaran", { uid: x.uid, tgl: x.tgl, kategori: x.kategori, ket: x.ket, nominal: x.nominal }, user, w);
    case "hapus_pengeluaran": {
      const r = one("SELECT id FROM expenses WHERE uid = ? AND dihapus IS NULL", [String(x.uid || "")]);
      if (!r) return { ok: true };
      return panggil("DELETE", `/api/pengeluaran/${r.id}`, {}, user, w);
    }
    default: throw bad(`Jenis perintah tidak dikenal: ${p.aksi}`);
  }
}

route("POST", "/api/cabang/kirim", false, ({ body }) => {
  const alat = perangkatDariToken(body.token);
  const perintah = Array.isArray(body.perintah) ? body.perintah.slice(0, 100) : [];
  const hasil = [];
  for (const p of perintah) {
    const uid = String(p && p.uid || "");
    if (!uid || uid.length > 100) { hasil.push({ uid, status: "ditolak", pesan: "uid tidak valid" }); continue; }
    const sudah = one("SELECT status, pesan FROM cabang_terima WHERE uid = ?", [uid]);
    if (sudah) { hasil.push({ uid, status: sudah.status, pesan: sudah.pesan }); continue; } // kiriman ulang: tidak dicatat dua kali
    try {
      tx(() => {
        terapkan(p, null, alat);
        run("INSERT INTO cabang_terima(uid, perangkat_id, aksi, status) VALUES (?,?,?, 'ok')", [uid, alat.id, String(p.aksi || "")]);
      });
      hasil.push({ uid, status: "ok" });
    } catch (e) {
      const permanen = e instanceof HttpError || String(e.message).includes("UNIQUE constraint failed");
      if (permanen) {
        const pesan = String(e.message).slice(0, 300);
        run("INSERT OR IGNORE INTO cabang_terima(uid, perangkat_id, aksi, status, pesan) VALUES (?,?,?, 'ditolak', ?)", [uid, alat.id, String(p.aksi || ""), pesan]);
        hasil.push({ uid, status: "ditolak", pesan });
      } else {
        console.error(new Date().toISOString(), "cabang/kirim", p.aksi, e);
        hasil.push({ uid, status: "gagal", pesan: "Server sibuk, akan dicoba lagi" });
        break; // jaga urutan: sisanya dikirim ulang nanti
      }
    }
  }
  return { hasil };
}, { batas: 5_000_000 });

route("POST", "/api/cabang/tarik", false, ({ body }) => {
  perangkatDariToken(body.token);
  const s = Object.fromEntries(all("SELECT kunci, nilai FROM settings WHERE kunci IN ('nama_toko','alamat','telp','footer','prefix','hpp_persen','insentif','periode_mulai')").map(r => [r.kunci, JSON.parse(r.nilai)]));
  return {
    produk: all("SELECT kode, nama, kategori, harga, hpp, stok, stok_min, barcode, insentif, aktif FROM products WHERE dihapus IS NULL ORDER BY id"),
    bahan: all("SELECT kode, nama, kategori, harga, satuan, stok, stok_min, barcode FROM materials WHERE dihapus IS NULL ORDER BY id"),
    users: all("SELECT nama, nama_key, peran, pass_hash, aktif FROM users ORDER BY id"),
    toko: s,
  };
});

route("GET", "/api/cabang/perangkat", "admin", () =>
  all(`SELECT p.id, p.kode, p.nama, p.dibuat, p.terakhir, p.dicabut,
    (SELECT COUNT(*) FROM cabang_terima t WHERE t.perangkat_id = p.id AND t.status = 'ok') diterima,
    (SELECT COUNT(*) FROM cabang_terima t WHERE t.perangkat_id = p.id AND t.status = 'ditolak') ditolak
    FROM perangkat p ORDER BY p.dicabut IS NOT NULL, p.id`));

route("DELETE", "/api/cabang/perangkat/:id", "admin", ({ params }) => {
  const d = one("SELECT id FROM perangkat WHERE id = ? AND dicabut IS NULL", [+params.id]);
  if (!d) throw notFound("Perangkat tidak ditemukan");
  run("UPDATE perangkat SET dicabut = datetime('now') WHERE id = ?", [d.id]);
  return { ok: true };
});
