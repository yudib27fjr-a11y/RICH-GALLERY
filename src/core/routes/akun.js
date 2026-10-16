import { route } from "../router.js";
import { one, all, run, tx, getSettings , versiData } from "../db.js";
import { HttpError, bad, notFound, teks, pilihan, hariIni } from "../util.js";
import { hashPassword, cekPassword, validasiPassword, buatSesi, hapusSesi, hapusSemuaSesiUser, cekBatasLogin, catatGagal, resetGagal } from "../auth.js";
import { KATEGORI, KAT_BAHAN, KAT_PENGELUARAN, METODE } from "../../../public/shared.js";

const adaAdmin = () => !!one("SELECT 1 x FROM users WHERE peran = 'admin' AND pass_hash IS NOT NULL AND aktif = 1");

route("GET", "/api/health", false, () => ({ ok: true }));

route("GET", "/api/status", false, ({ user }) => ({ perluSetup: !adaAdmin(), masuk: !!user }));

/* Akun admin pertama dibuat lewat layar setup, bukan password bawaan. Hanya bisa sekali. */
route("POST", "/api/setup", false, ({ body, ctx }) => {
  const u = tx(() => {
    if (adaAdmin()) throw new HttpError(409, "Admin sudah dibuat. Silakan masuk.");
    const nama = teks(body.nama, { wajib: true, max: 40, nama: "Nama" });
    const pw = validasiPassword(body.password, "admin");
    const ada = one("SELECT id FROM users WHERE nama_key = ?", [nama.toLowerCase()]);
    if (ada) { run("UPDATE users SET peran = 'admin', pass_hash = ?, aktif = 1 WHERE id = ?", [hashPassword(pw), ada.id]); return { id: ada.id, nama }; }
    const r = run("INSERT INTO users(nama, nama_key, peran, pass_hash) VALUES (?,?, 'admin', ?)", [nama, nama.toLowerCase(), hashPassword(pw)]);
    return { id: Number(r.lastInsertRowid), nama };
  });
  buatSesi(ctx, u.id);
  return { ok: true };
});

route("POST", "/api/login", false, ({ body, ctx }) => {
  const nama = teks(body.nama, { wajib: true, max: 40, nama: "Nama" });
  const kunci = (ctx.ip || "") + "|" + nama.toLowerCase();
  cekBatasLogin(kunci);
  const u = one("SELECT id, pass_hash, aktif FROM users WHERE nama_key = ?", [nama.toLowerCase()]);
  if (!u || !u.aktif || !cekPassword(String(body.password ?? ""), u.pass_hash)) { catatGagal(kunci); throw new HttpError(401, "Nama atau password salah"); }
  resetGagal(kunci);
  buatSesi(ctx, u.id);
  return { ok: true };
});

route("POST", "/api/logout", false, ({ ctx }) => { hapusSesi(ctx); return { ok: true }; });

route("POST", "/api/akun/password", "semua", ({ body, user }) => {
  const u = one("SELECT pass_hash, peran FROM users WHERE id = ?", [user.id]);
  if (!cekPassword(String(body.lama ?? ""), u.pass_hash)) throw bad("Password lama salah");
  run("UPDATE users SET pass_hash = ? WHERE id = ?", [hashPassword(validasiPassword(body.baru, u.peran)), user.id]);
  return { ok: true };
});

/** Semua data awal yang dibutuhkan layar setelah login. Karyawan tidak menerima HPP & pengaturan sinkron. */
route("GET", "/api/bootstrap", "semua", ({ user }) => {
  const s = getSettings(), admin = user.peran === "admin";
  const produkKolom = `id, kode, nama, kategori, harga, ${admin ? "hpp," : ""} stok, stok_min, barcode, insentif, aktif`;
  return {
    me: user, hariIni: hariIni(),
    toko: { nama_toko: s.nama_toko, alamat: s.alamat, telp: s.telp, footer: s.footer, prefix: s.prefix, hpp_persen: s.hpp_persen, insentif: s.insentif, periode_mulai: s.periode_mulai },
    kategori: KATEGORI, katBahan: KAT_BAHAN, katPengeluaran: KAT_PENGELUARAN, metode: METODE,
    produk: all(`SELECT ${produkKolom} FROM products WHERE dihapus IS NULL ORDER BY kode`),
    bahan: all("SELECT id, kode, nama, kategori, harga, satuan, stok, stok_min, barcode FROM materials WHERE dihapus IS NULL ORDER BY kode"),
    staf: all("SELECT id, nama, peran FROM users WHERE aktif = 1 ORDER BY peran, nama"),
    versi: versiData(),
  };
});

/* ---- Kelola pengguna (admin) ---- */
route("GET", "/api/users", "admin", () =>
  all("SELECT id, nama, peran, aktif, pass_hash IS NOT NULL AS bisa_masuk, dibuat FROM users ORDER BY aktif DESC, peran, nama"));

route("POST", "/api/users", "admin", ({ body }) => {
  const nama = teks(body.nama, { wajib: true, max: 40, nama: "Nama" });
  const peran = pilihan(body.peran || "karyawan", ["admin", "karyawan"], "Peran");
  if (one("SELECT 1 x FROM users WHERE nama_key = ?", [nama.toLowerCase()])) throw bad("Nama sudah dipakai");
  const hash = body.password ? hashPassword(validasiPassword(body.password, peran)) : null;
  if (peran === "admin" && !hash) throw bad("Admin wajib punya password");
  const r = run("INSERT INTO users(nama, nama_key, peran, pass_hash) VALUES (?,?,?,?)", [nama, nama.toLowerCase(), peran, hash]);
  return { id: Number(r.lastInsertRowid) };
});

route("PUT", "/api/users/:id", "admin", ({ body, params, user }) => tx(() => {
  const u = one("SELECT * FROM users WHERE id = ?", [+params.id]);
  if (!u) throw notFound("Pengguna tidak ditemukan");
  const nama = body.nama != null ? teks(body.nama, { wajib: true, max: 40, nama: "Nama" }) : u.nama;
  const peran = body.peran != null ? pilihan(body.peran, ["admin", "karyawan"], "Peran") : u.peran;
  const aktif = body.aktif != null ? (body.aktif ? 1 : 0) : u.aktif;
  if (nama.toLowerCase() !== u.nama_key && one("SELECT 1 x FROM users WHERE nama_key = ?", [nama.toLowerCase()])) throw bad("Nama sudah dipakai");
  let hash = u.pass_hash;
  if (body.password) hash = hashPassword(validasiPassword(body.password, peran));
  if (body.hapusPassword) hash = null;
  if (peran === "admin" && !hash) throw bad("Admin wajib punya password");
  const sisaAdmin = one("SELECT COUNT(*) n FROM users WHERE peran = 'admin' AND aktif = 1 AND pass_hash IS NOT NULL AND id <> ?", [u.id]).n;
  if (u.peran === "admin" && (peran !== "admin" || !aktif) && sisaAdmin === 0) throw bad("Minimal harus ada satu admin aktif");
  if (u.id === user.id && !aktif) throw bad("Tidak bisa menonaktifkan akun sendiri");
  run("UPDATE users SET nama = ?, nama_key = ?, peran = ?, aktif = ?, pass_hash = ? WHERE id = ?", [nama, nama.toLowerCase(), peran, aktif, hash, u.id]);
  if (!aktif || body.password || body.hapusPassword || peran !== u.peran) { if (u.id !== user.id) hapusSemuaSesiUser(u.id); }
  return { ok: true };
}));
