import { one, run } from "./db.js";
import { platform } from "./platform.js";
import { HttpError } from "./util.js";

const HARI = 86400_000;
export const hashPassword = pw => platform.hashPassword(pw);
export const cekPassword = (pw, simpan) => !!simpan && platform.cekPassword(pw, simpan);

/** Admin: minimal 8 karakter. Karyawan: boleh PIN angka minimal 4 digit supaya cepat masuk di kasir. */
export function validasiPassword(pw, peran){
  pw = String(pw ?? "");
  const min = peran === "admin" ? 8 : 4;
  if (pw.length < min) throw new HttpError(400, `Password ${peran === "admin" ? "admin" : "karyawan"} minimal ${min} karakter`);
  if (pw.length > 200) throw new HttpError(400, "Password terlalu panjang");
  return pw;
}

/* Sesi: token acak disimpan sebagai hash di tabel sessions. ctx.setSesi menaruh token di cookie (web) atau penyimpanan aplikasi (Android). */
export function buatSesi(ctx, userId){
  const token = platform.token();
  run("INSERT INTO sessions(token_hash, user_id, kadaluarsa, dibuat) VALUES (?,?,?,?)", [platform.sha256(token), userId, Date.now() + platform.sesiHari * HARI, Date.now()]);
  ctx.setSesi(token, platform.sesiHari * 86400);
}
export function hapusSesi(ctx){
  if (ctx.token) run("DELETE FROM sessions WHERE token_hash = ?", [platform.sha256(ctx.token)]);
  ctx.setSesi("", 0);
}
export function hapusSemuaSesiUser(userId){ run("DELETE FROM sessions WHERE user_id = ?", [userId]); }

/** User dari token sesi. Sesi diperpanjang otomatis bila tinggal kurang dari separuh umur. */
export function userDariCtx(ctx){
  if (!ctx.token) return null;
  const h = platform.sha256(ctx.token);
  const r = one(`SELECT s.kadaluarsa, u.id, u.nama, u.peran, u.aktif FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, [h]);
  if (!r || r.kadaluarsa < Date.now() || !r.aktif) { if (r) run("DELETE FROM sessions WHERE token_hash = ?", [h]); return null; }
  if (r.kadaluarsa - Date.now() < platform.sesiHari * HARI / 2) {
    run("UPDATE sessions SET kadaluarsa = ? WHERE token_hash = ?", [Date.now() + platform.sesiHari * HARI, h]);
    ctx.setSesi(ctx.token, platform.sesiHari * 86400);
  }
  return { id: r.id, nama: r.nama, peran: r.peran };
}
export function bersihkanSesiKadaluarsa(){ run("DELETE FROM sessions WHERE kadaluarsa < ?", [Date.now()]); }

/* Pembatas percobaan login: 5 kali salah per IP+nama → dikunci 5 menit. */
const gagal = new Map();
export function cekBatasLogin(kunci){
  const g = gagal.get(kunci);
  if (g && g.sampai > Date.now()) throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((g.sampai - Date.now()) / 60000)} menit.`);
}
export function catatGagal(kunci){
  const g = gagal.get(kunci) || { n: 0, sampai: 0 };
  g.n++; if (g.n >= 5) { g.sampai = Date.now() + 5 * 60_000; g.n = 0; }
  gagal.set(kunci, g);
}
export const resetGagal = kunci => gagal.delete(kunci);
