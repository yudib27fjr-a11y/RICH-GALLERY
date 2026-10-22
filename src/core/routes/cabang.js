/* Sinkron perangkat cabang ↔ server pusat.
   Di perangkat (iMin, mode offline): /api/cabang (status), /sambung, /putus, /sinkron.
   Di server pusat: /api/cabang/daftar, /kirim, /tarik (diakses perangkat dengan token perangkat), dan daftar perangkat untuk admin. */
import { route, cariRoute } from "../router.js";
import { one, all, run, tx, getSettings, setSetting, versiData } from "../db.js";
import { hapusData, sisipkanBaris, TABEL_DATA } from "../ekspor.js";
import { platform } from "../platform.js";
import { HttpError, bad, notFound, teks, denganWaktu, tanggal } from "../util.js";
import { cekPassword, cekBatasLogin, catatGagal, resetGagal } from "../auth.js";
import { muatPenjualan, hapusPenjualan } from "./penjualan.js";
import { rekapAbsen, terimaAbsen, fotoAbsen, cekLokasi, lemburPeriode } from "./absen.js";
import { rekapGaji, daftarKasbon } from "./gaji.js";
import { simpanKurir, simpanMitra, simpanPaket } from "./kurir.js";
import { aksiBelanjaDariPerangkat } from "./belanja.js";
import { aksiPromosiDariPerangkat } from "./promosi.js";
import { statusCabang, sinkronCabang, sambungCabang, sambungUlangCabang, putusCabang, gantiNamaPerangkat, kirimUlangDitolak, cabangAktif, mintaPusat } from "../cabang-perangkat.js";

/* ================= di perangkat ================= */
route("GET", "/api/cabang", "admin", () => statusCabang());
route("POST", "/api/cabang/sambung", "admin", async ({ body }) => sambungCabang({
  url: teks(body.url, { wajib: true, max: 300, nama: "Alamat server" }),
  nama: teks(body.nama, { wajib: true, max: 40, nama: "Nama admin server" }),
  password: String(body.password ?? ""),
  perangkat: teks(body.perangkat, { max: 40, nama: "Nama perangkat" }),
  paksa: !!body.paksa,
  unggahAwal: !!body.unggahAwal,
  kirimLama: !!body.kirimLama,
}), { batas: 100_000 });
route("POST", "/api/cabang/sambung-ulang", "admin", ({ body }) => sambungUlangCabang({
  nama: teks(body.nama, { wajib: true, max: 40, nama: "Nama admin server" }), password: String(body.password ?? "") }));
route("POST", "/api/cabang/putus", "admin", ({ body }) => putusCabang({ paksa: !!body.paksa }));
route("GET", "/api/cabang/ringkas", "semua", () => { const s = statusCabang(); return { aktif: s.aktif, menunggu: s.menunggu, ditolak: s.ditolak, galat: s.galatTerakhir, terakhir: s.terakhir }; });
route("POST", "/api/cabang/sinkron", "semua", () => sinkronCabang({ paksa: true }));
route("POST", "/api/cabang/kirim-ulang", "admin", () => { const n = kirimUlangDitolak({ semua: true }); return sinkronCabang({ paksa: true }).then(st => ({ ...st, dikirimUlang: n })); });
route("POST", "/api/cabang/nama", "admin", ({ body }) => gantiNamaPerangkat(teks(body.nama, { wajib: true, max: 40, nama: "Nama perangkat" })));
/* Penanda versi data (server maupun perangkat): layar memakainya untuk tahu kapan perlu memuat ulang. */
route("GET", "/api/versi", "semua", () => ({ versi: versiData() }));

/* Di mode cabang, data induk hanya diubah di server pusat (perangkat menerimanya saat sinkron). */
for (const [m, p] of [
  ["POST", "/api/produk"], ["PUT", "/api/produk/1"], ["DELETE", "/api/produk/1"],
  ["POST", "/api/bahan"], ["PUT", "/api/bahan/1"], ["DELETE", "/api/bahan/1"],
  ["POST", "/api/users"], ["PUT", "/api/users/1"], ["POST", "/api/akun/password"],
  ["PUT", "/api/pengaturan"], ["POST", "/api/insentif/bayar"],
  ["POST", "/api/pulihkan"], ["POST", "/api/impor-lama"], ["POST", "/api/sync/tarik"],
  ["PUT", "/api/absen/pengaturan"], ["PUT", "/api/jam-kerja"], ["POST", "/api/absen/manual"], ["DELETE", "/api/absen/1"],
]) { const r = cariRoute(m, p); if (r) r.opsi.pusatSaja = true; }

/* ================= di server pusat ================= */
function perangkatDariToken(token){
  const d = token ? one("SELECT * FROM perangkat WHERE token_hash = ? AND dicabut IS NULL AND kode NOT LIKE 'W%'", [platform.sha256(String(token))]) : null;
  if (!d) throw new HttpError(401, "Perangkat tidak dikenal atau sudah dicabut. Sambungkan ulang dari Pengaturan di perangkat.");
  // Dicatat paling sering 2 menit sekali: perangkat bertanya tiap beberapa detik, jangan boros tulis.
  run("UPDATE perangkat SET terakhir = datetime('now') WHERE id = ? AND (terakhir IS NULL OR terakhir < datetime('now', '-2 minutes'))", [d.id]);
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

/** Baris yang dibuat di server tidak punya uid; ke perangkat dikirim sebagai "srv:<id>". */
const kunciBaris = r => r.uid || "srv:" + r.id;
function barisUid(tabel, uid){
  uid = String(uid || "");
  const m = uid.match(/^srv:(\d+)$/);
  return m ? one(`SELECT * FROM ${tabel} WHERE id = ? AND uid IS NULL`, [+m[1]]) : one(`SELECT * FROM ${tabel} WHERE uid = ?`, [uid]);
}

/** Jalankan handler endpoint biasa di server, sebagai user pembuat dan pada waktu asli transaksinya. */
function panggil(method, path, body, user, waktu, replay = {}){
  const r = cariRoute(method, path);
  const m = path.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  return denganWaktu(waktu, () => r.handler({ user, params, query: {}, body, ctx: { replay } }));
}

/** Satu perintah dari perangkat → perubahan yang sama di server. Galat HttpError = ditolak permanen. */
function terapkan(p, d, alat, aman = false){
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
      // Transaksi lama dari perangkat yang baru disambungkan: lewati bila sudah ada di server (no & total sama).
      if (x.lama && one("SELECT 1 x FROM sales WHERE no = ? AND total = ?", [String(x.no || ""), Math.round(Number(x.total ?? NaN))])) return { ok: true, lewat: true };
      if (x.lama && one("SELECT 1 x FROM sales WHERE no = ? AND tgl = ?", [String(x.no || ""), String(x.tgl || "")])) return { ok: true, lewat: true };
      const items = (Array.isArray(x.items) ? x.items : []).map(i => {
        const b = idBarang("produk", i.kode);
        return b ? { product_id: b.id, harga: i.harga, qty: i.qty, ready: i.ready, pembuat: i.pembuat } : { nama: i.nama, kategori: i.kategori, harga: i.harga, qty: i.qty, pembuat: i.pembuat };
      });
      const waktuJual = { tgl: x.tgl || w?.tgl, jam: x.jam || w?.jam }, replay = { no: x.no, tgl: x.tgl, jam: x.jam, lama: !!x.lama };
      const body = { items, diskon: x.diskon, ongkir: x.ongkir, metode: x.metode, bayar: x.bayar, pelanggan: x.pelanggan, hp: x.hp, catatan: x.catatan, kartu: x.kartu, pesanan: x.pesanan || null, jenis: x.jenis || null, detail: x.detail || null };
      if (!aman) return panggil("POST", "/api/penjualan", body, user, waktuJual, replay);
      {
        // Versi aman (dipakai bila versi biasa ditolak): penjualan yang sudah terjadi di toko jangan sampai hilang,
        // jadi data tambahan yang bermasalah (pesanan, kartu, pembuat) disederhanakan.
        const amanBody = { ...body, metode: ["Tunai", "Transfer", "QRIS"].includes(x.metode) ? x.metode : "Tunai", kartu: null, pesanan: null,
          catatan: [String(x.catatan || ""), x.pesanan ? `Pesanan ${x.pesanan.tgl || ""} ${x.pesanan.jam || ""} ${x.pesanan.request || ""}`.trim() : ""].filter(Boolean).join(" · ").slice(0, 500),
          items: items.map(i => ({ ...i, pembuat: undefined, nama: String(i.nama || "BARANG").slice(0, 120) || "BARANG", qty: Math.max(0.01, Math.min(100000, Number(i.qty) || 1)), harga: Math.max(0, Math.round(Number(i.harga) || 0)) })) };
        const sub = amanBody.items.reduce((a, i) => a + i.harga * i.qty, 0);
        amanBody.diskon = Math.min(Math.max(0, Math.round(Number(x.diskon) || 0)), Math.round(sub));
        amanBody.ongkir = Math.max(0, Math.round(Number(x.ongkir) || 0));
        amanBody.bayar = x.bayar == null ? undefined : Math.max(0, Math.round(Number(x.bayar) || 0));
        return panggil("POST", "/api/penjualan", amanBody, user, waktuJual, replay);
      }
    }
    case "batal": {
      const s = one("SELECT id, batal_at FROM sales WHERE no = ?", [String(x.no || "")]);
      if (!s) throw bad(`Transaksi ${x.no} tidak ada di server`);
      if (s.batal_at) return { ok: true };
      return panggil("POST", `/api/penjualan/${s.id}/batal`, { alasan: x.alasan }, user, w);
    }
    case "lunasi": {
      const s = one("SELECT id, total, bayar, batal_at FROM sales WHERE no = ?", [String(x.no || "")]);
      if (!s) throw bad(`Transaksi ${x.no} tidak ada di server`);
      if (s.batal_at || s.bayar >= s.total) return { ok: true }; // sudah lunas (mis. dilunasi di perangkat lain)
      return panggil("POST", `/api/penjualan/${s.id}/lunasi`, { nominal: x.nominal == null ? undefined : Math.min(x.nominal, s.total - s.bayar), metode: x.metode }, user, w);
    }
    case "diambil": {
      const s = one("SELECT id, batal_at FROM sales WHERE no = ?", [String(x.no || "")]);
      if (!s) throw bad(`Transaksi ${x.no} tidak ada di server`);
      if (s.batal_at) return { ok: true };
      return panggil("POST", `/api/penjualan/${s.id}/diambil`, { batal: !!x.batal }, user, w);
    }
    case "detail_jual": {
      const s = one("SELECT id, jenis FROM sales WHERE no = ?", [String(x.no || "")]);
      if (!s) throw bad(`Transaksi ${x.no} tidak ada di server`);
      if (!s.jenis) return { ok: true };
      return panggil("POST", `/api/penjualan/${s.id}/detail`, { detail: x.detail || {} }, user, w);
    }
    case "absen": return terimaAbsen(x, alat);
    case "hapus_jual": {
      const nos = Array.isArray(x.nos) ? x.nos.slice(0, 100000) : [];
      for (const no of nos) {
        const s = muatPenjualan("no = ?", [String(no)])[0];
        if (s) denganWaktu(w, () => hapusPenjualan(s, user, "Dihapus di perangkat"));
      }
      return { ok: true };
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
    case "ubah_produksi": {
      const r = barisUid("produksi", x.uid);
      if (!r) throw bad("Catatan produksi yang diubah tidak ada di server");
      const pembuat = x.pembuat ? userNama(x.pembuat) : null;
      if (x.pembuat && !pembuat) throw bad(`Pembuat ${x.pembuat} tidak ada atau tidak aktif di server`);
      const b = x.kode ? idBarang("produk", x.kode) : null;
      if (x.kode && !b) throw bad(`Produk ${x.kode} tidak ada di server`);
      return panggil("PUT", `/api/produksi/${r.id}`, { pembuat_id: pembuat ? pembuat.id : undefined, product_id: b ? b.id : undefined, qty: x.qty }, user, w);
    }
    case "hapus_produksi": {
      const r = barisUid("produksi", x.uid);
      if (!r) throw bad("Catatan produksi yang dihapus tidak ada di server");
      return panggil("DELETE", `/api/produksi/${r.id}`, {}, user, w);
    }
    case "pengeluaran":
      return panggil("POST", "/api/pengeluaran", { uid: x.uid, tgl: x.tgl, kategori: x.kategori, ket: x.ket || x.kategori, nominal: x.nominal }, user, w);
    case "hapus_pengeluaran": {
      const r = barisUid("expenses", x.uid);
      if (!r || r.dihapus) return { ok: true };
      return panggil("DELETE", `/api/pengeluaran/${r.id}`, {}, user, w);
    }
    case "insentif_lain": {
      const k = userNama(x.karyawan);
      if (!k) throw bad(`Karyawan ${x.karyawan || "-"} tidak ada atau tidak aktif di server`);
      return panggil("POST", "/api/insentif-lain", { uid: x.uid, tgl: x.tgl, user_id: k.id, jenis: x.jenis, nominal: x.nominal, ket: x.ket }, user, w);
    }
    case "hapus_insentif_lain": {
      const r = barisUid("insentif_lain", x.uid);
      if (!r || r.dihapus) return { ok: true };
      return panggil("DELETE", `/api/insentif-lain/${r.id}`, {}, user, w);
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
      const jalankan = aman => tx(() => {
        terapkan(p, null, alat, aman);
        run("INSERT INTO cabang_terima(uid, perangkat_id, aksi, status) VALUES (?,?,?, 'ok')", [uid, alat.id, String(p.aksi || "")]);
      });
      try { jalankan(false); }
      catch (e) {
        const permanen = e instanceof HttpError || String(e.message).includes("UNIQUE constraint failed");
        if (!(permanen && p.aksi === "jual")) throw e;
        console.error(new Date().toISOString(), "jual dari perangkat ditolak, dicoba versi aman:", p.data && p.data.no, e.message);
        jalankan(true);
      }
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

/** Riwayat penjualan 40 hari terakhir (semua perangkat), supaya daftar transaksi & laporan di perangkat sama dengan server. */
const BATAS_JUAL = 5000;
function penjualanTerbaru(sejak){
  // Termasuk pesanan lama yang belum diambil, supaya pengingatnya tetap ada di perangkat.
  const sales = all(`SELECT id, no, tgl, jam, kasir, pelanggan, hp, subtotal, diskon, ongkir, total, metode, bayar, catatan, batal_at, batal_oleh, batal_alasan,
    kartu, ambil_tgl, ambil_jam, ambil_cara, request, diambil_at, diambil_oleh, lunas_at, lunas_metode, lunas_oleh, jenis, detail
    FROM sales WHERE tgl >= ? OR (ambil_tgl IS NOT NULL AND diambil_at IS NULL AND batal_at IS NULL) ORDER BY id DESC LIMIT ${BATAS_JUAL}`, [sejak]);
  if (!sales.length) return [];
  const per = new Map(sales.map(x => [x.id, (x.items = [], x)]));
  for (const it of all(`SELECT sale_id, kode, nama, kategori, harga, qty, hpp, ready, pembuat FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE tgl >= ? OR (ambil_tgl IS NOT NULL AND diambil_at IS NULL AND batal_at IS NULL))`, [sejak])) {
    const x = per.get(it.sale_id); if (x) { delete it.sale_id; x.items.push(it); }
  }
  return sales.map(x => { delete x.id; return x; });
}

/** Produksi, pengeluaran, dan pembayaran insentif 40 hari terakhir (cukup untuk periode insentif berjalan & sebelumnya). */
function keuanganTerbaru(sejak){
  return {
    produksi: all(`SELECT p.id, p.uid, p.tgl, p.kode, p.nama, p.qty, u.nama_key pembuat, p.tarif, p.restock, p.oleh, p.dibuat
      FROM produksi p JOIN users u ON u.id = p.pembuat_id WHERE p.tgl >= ? ORDER BY p.id`, [sejak]).map(r => { r.kunci = kunciBaris(r); delete r.id; delete r.uid; return r; }),
    pengeluaran: all("SELECT id, uid, tgl, kategori, ket, nominal, oleh, dihapus, dibuat FROM expenses WHERE tgl >= ? ORDER BY id", [sejak])
      .map(r => { r.kunci = kunciBaris(r); delete r.id; delete r.uid; return r; }),
    insentif_lain: all(`SELECT l.id, l.uid, l.tgl, u.nama_key karyawan, l.jenis, l.nominal, l.ket, l.oleh, l.dihapus, l.dibuat
      FROM insentif_lain l JOIN users u ON u.id = l.user_id WHERE l.tgl >= ? ORDER BY l.id`, [sejak]).map(r => { r.kunci = kunciBaris(r); delete r.id; delete r.uid; return r; }),
    insentif: all(`SELECT u.nama_key pembuat, b.periode_dari, b.periode_sampai, b.qty, b.hitung, b.nominal, b.tgl, b.ket, b.oleh
      FROM insentif_bayar b JOIN users u ON u.id = b.pembuat_id WHERE b.periode_sampai >= ?`, [sejak]),
  };
}

/* Perangkat bertanya "ada yang baru?" dengan versi terakhir yang ia punya. Bila sama, jawabannya kecil sekali (hemat kuota);
   bila berbeda, dikirim data lengkap terbaru. */
route("POST", "/api/cabang/tarik", false, ({ body }) => {
  const alat = perangkatDariToken(body.token);
  const versi = versiData() || "awal";
  if (body.versi && body.versi === versi) return { tetap: true, versi, perangkat: alat.nama, perangkat_absen: !!alat.absen };
  const sejak = one("SELECT date('now', '+7 hours', '-40 days') d").d;
  const s = Object.fromEntries(all("SELECT kunci, nilai FROM settings WHERE kunci IN ('nama_toko','alamat','telp','footer','prefix','hpp_persen','insentif','periode_mulai','absen_aktif','absen_jam_masuk','absen_jam_pulang','wa_otomatis','wa_template','canva_url','canva_email','wa_nomor','absen_pin_aktif','absen_lat','absen_lng','absen_radius','kartu_lebar','kartu_tinggi','kartu_huruf','kartu_warna','kartu_area','kartu_latar_kode','kartu_font_kode','inv_tagline','inv_bank','inv_ttd','inv_ttd_nama','inv_ttd_jabatan','jam_buka','jam_tutup','shifts','lembur_per_jam','lembur_bulat','ins_kurir','ins_lapangan','ins_konten','kurir_offline','mitra','ins_dekorasi','paket_jasa','jam_hari','tugas')").map(r => [r.kunci, JSON.parse(r.nilai)]));
  return {
    produk: all("SELECT kode, nama, kategori, harga, hpp, stok, stok_min, barcode, insentif, aktif FROM products WHERE dihapus IS NULL ORDER BY id"),
    bahan: all("SELECT kode, nama, kategori, harga, satuan, stok, stok_min, barcode FROM materials WHERE dihapus IS NULL ORDER BY id"),
    users: all("SELECT nama, nama_key, peran, pass_hash, aktif FROM users ORDER BY id"),
    toko: s,
    penjualan: penjualanTerbaru(sejak),
    sejak, ...keuanganTerbaru(sejak),
    versi, perangkat: alat.nama, perangkat_absen: !!alat.absen,
    reset: getSettings().reset_terakhir || null,
  };
});

/* Foto selfie absen & lokasi toko, untuk admin di perangkat cabang. */
route("POST", "/api/cabang/absen-foto", false, ({ body }) => { perangkatDariToken(body.token); return fotoAbsen(body.id); });
route("POST", "/api/cabang/absen-lokasi", false, ({ body }) => {
  perangkatDariToken(body.token);
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!(isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw bad("Lokasi tidak valid");
  setSetting("absen_lat", String(lat)); setSetting("absen_lng", String(lng));
  return { ok: true };
});

route("POST", "/api/cabang/kartu-latar", false, ({ body }) => { perangkatDariToken(body.token); const s = getSettings(); return { latar: s.kartu_latar || "", font: s.kartu_font || "" }; });

/* Rekap absensi untuk perangkat cabang (data mesin absen ada di server pusat). */
route("POST", "/api/cabang/absen", false, ({ body }) => {
  perangkatDariToken(body.token);
  const dari = tanggal(body.dari), sampai = tanggal(body.sampai || body.dari);
  return rekapAbsen(dari, sampai);
});

/* Rekap gaji & kasbon untuk admin di perangkat cabang (data gaji ada di server pusat). */
route("POST", "/api/cabang/gaji", false, ({ body }) => { perangkatDariToken(body.token); return rekapGaji(tanggal(body.tgl)); });
route("POST", "/api/cabang/kasbon", false, ({ body }) => { perangkatDariToken(body.token); return daftarKasbon(); });

/* Lembur per karyawan dalam satu periode (untuk rekap insentif di perangkat cabang). */
route("POST", "/api/cabang/lembur", false, ({ body }) => {
  perangkatDariToken(body.token);
  return { lembur: lemburPeriode(tanggal(body.dari), tanggal(body.sampai || body.dari)) };
});

/* Daftar perangkat kasir & izin absen. Di server langsung; di perangkat (aplikasi) diteruskan ke server pusat,
   jadi admin bisa mengaturnya dari aplikasi juga. */
const daftarPerangkat = () => all(`SELECT p.id, p.kode, p.nama, p.dibuat, p.terakhir, p.dicabut, p.absen,
    (SELECT COUNT(*) FROM cabang_terima t WHERE t.perangkat_id = p.id AND t.status = 'ok') diterima,
    (SELECT COUNT(*) FROM cabang_terima t WHERE t.perangkat_id = p.id AND t.status = 'ditolak') ditolak
    FROM perangkat p ORDER BY p.dicabut IS NOT NULL, p.id`);
function ubahPerangkat(id, body){
  const d = one("SELECT id FROM perangkat WHERE id = ? AND dicabut IS NULL", [+id]);
  if (!d) throw notFound("Perangkat tidak ditemukan");
  if (body.nama != null) run("UPDATE perangkat SET nama = ? WHERE id = ?", [teks(body.nama, { wajib: true, max: 40, nama: "Nama perangkat" }), d.id]);
  if (body.absen != null) run("UPDATE perangkat SET absen = ? WHERE id = ?", [body.absen ? 1 : 0, d.id]);
  return { ok: true };
}
function cabutPerangkat(id){
  const d = one("SELECT id FROM perangkat WHERE id = ? AND dicabut IS NULL", [+id]);
  if (!d) throw notFound("Perangkat tidak ditemukan");
  run("UPDATE perangkat SET dicabut = datetime('now') WHERE id = ?", [d.id]);
  return { ok: true };
}
const kelolaDiPusat = async (aksi, id, data) => {
  const r = await mintaPusat("/api/cabang/kelola-perangkat", { aksi, id, data });
  if (aksi !== "daftar") await sinkronCabang({ paksa: true }).catch(() => {});
  return r;
};
route("GET", "/api/cabang/perangkat", "admin", () => cabangAktif() ? kelolaDiPusat("daftar") : daftarPerangkat());
route("PUT", "/api/cabang/perangkat/:id", "admin", ({ params, body }) => cabangAktif() ? kelolaDiPusat("ubah", +params.id, body) : ubahPerangkat(params.id, body));
route("DELETE", "/api/cabang/perangkat/:id", "admin", ({ params }) => cabangAktif() ? kelolaDiPusat("cabut", +params.id) : cabutPerangkat(params.id));
/* Diteruskan dari aplikasi di perangkat (admin di perangkat itu). */
/* Admin di perangkat kasir mengubah daftar kurir offline (disimpan di server). */
route("POST", "/api/cabang/kurir", false, ({ body }) => { perangkatDariToken(body.token); return simpanKurir(body.daftar); });
route("POST", "/api/cabang/belanja", false, ({ body }) => { perangkatDariToken(body.token); return aksiBelanjaDariPerangkat(body.aksi, body.data, body.user); }, { batas: 300_000 });
route("POST", "/api/cabang/promosi", false, ({ body }) => { perangkatDariToken(body.token); return aksiPromosiDariPerangkat(body.aksi, body.data, body.user); });
route("POST", "/api/cabang/paket-jasa", false, ({ body }) => { perangkatDariToken(body.token); return simpanPaket(body.paket); });
route("POST", "/api/cabang/mitra", false, ({ body }) => { perangkatDariToken(body.token); return simpanMitra(body.daftar); });
route("POST", "/api/cabang/kelola-perangkat", false, ({ body }) => {
  perangkatDariToken(body.token);
  if (body.aksi === "daftar") return daftarPerangkat();
  if (body.aksi === "ubah") return ubahPerangkat(body.id, body.data || {});
  if (body.aksi === "cabut") return cabutPerangkat(body.id);
  throw bad("Aksi tidak dikenal");
});

/* Perangkat mengganti namanya sendiri (dari Pengaturan di perangkat). */
route("POST", "/api/cabang/nama-perangkat", false, ({ body }) => {
  const alat = perangkatDariToken(body.token);
  const nama = teks(body.nama, { wajib: true, max: 40, nama: "Nama perangkat" });
  run("UPDATE perangkat SET nama = ? WHERE id = ?", [nama, alat.id]);
  return { nama };
});


