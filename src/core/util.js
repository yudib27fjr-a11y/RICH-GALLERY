import { platform } from "./platform.js";
import { validTgl } from "../../public/shared.js";

export class HttpError extends Error {
  constructor(status, message){ super(message); this.status = status; }
}
export const bad = msg => new HttpError(400, msg);
export const notFound = (msg = "Data tidak ditemukan") => new HttpError(404, msg);

/** Tanggal & jam sekarang di zona waktu toko. */
export function sekarang(){
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: platform.zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { tgl: `${p.year}-${p.month}-${p.day}`, jam: `${p.hour}:${p.minute}` };
}
export const hariIni = () => sekarang().tgl;

/* ---- Validasi input ---- */
export function teks(v, { max = 200, wajib = false, nama = "Isian", upper = false } = {}){
  let s = v == null ? "" : String(v).trim();
  if (upper) s = s.toUpperCase();
  if (wajib && !s) throw bad(`${nama} wajib diisi`);
  if (s.length > max) throw bad(`${nama} terlalu panjang (maks ${max} karakter)`);
  return s;
}
export function angka(v, { min = -Infinity, max = Infinity, wajib = false, nama = "Angka", bulat = false } = {}){
  if (v === "" || v == null) { if (wajib) throw bad(`${nama} wajib diisi`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${nama} harus berupa angka`);
  if (n < min || n > max) throw bad(`${nama} di luar batas`);
  return bulat ? Math.round(n) : Math.round(n * 100) / 100;
}
export function tanggal(v, { nama = "Tanggal", wajib = true } = {}){
  if (!v) { if (wajib) throw bad(`${nama} wajib diisi`); return null; }
  if (!validTgl(v)) throw bad(`${nama} tidak valid`);
  return v;
}
export function pilihan(v, opsi, nama = "Pilihan"){
  if (!opsi.includes(v)) throw bad(`${nama} tidak valid`);
  return v;
}
export function daftar(v, { nama = "Daftar", min = 1, max = 500 } = {}){
  if (!Array.isArray(v)) throw bad(`${nama} tidak valid`);
  if (v.length < min) throw bad(`${nama} masih kosong`);
  if (v.length > max) throw bad(`${nama} terlalu banyak`);
  return v;
}
export const bulat2 = n => Math.round(n * 100) / 100;
