import { MIGRASI, DEFAULT_SETTINGS } from "./skema.js";

/* Driver database dipasang oleh platform: node:sqlite DatabaseSync di server, jembatan SQLite Android di aplikasi.
   Bentuknya: { exec(sql), prepare(sql) → { get(...p), all(...p), run(...p) → { changes, lastInsertRowid } } } */
let drv = null;
const cache = new Map();
export function pasangDriver(d){ drv = d; cache.clear(); }
export const driver = () => drv;

const bersih = v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
const siapkan = p => {
  if (p == null) return [];
  if (Array.isArray(p)) return p.map(bersih);
  if (typeof p === "object") { const o = {}; for (const k in p) o[k] = bersih(p[k]); return [o]; }
  return [bersih(p)];
};
function stmt(sql){ let s = cache.get(sql); if (!s) { s = drv.prepare(sql); cache.set(sql, s); } return s; }
export const one = (sql, p) => stmt(sql).get(...siapkan(p)) ?? null;
export const all = (sql, p) => stmt(sql).all(...siapkan(p));
export const run = (sql, p) => stmt(sql).run(...siapkan(p));
export const exec = sql => drv.exec(sql);

let kedalaman = 0;
/** Jalankan fn dalam satu transaksi. Semua perubahan stok/uang wajib lewat sini. fn harus sinkron.
 *  Driver boleh menyediakan transaksi(fn) sendiri (Cloudflare: BEGIN/COMMIT tidak boleh lewat SQL). */
export function tx(fn){
  if (kedalaman > 0) return fn();
  if (drv.transaksi) { kedalaman++; try { return drv.transaksi(fn); } finally { kedalaman--; } }
  drv.exec("BEGIN IMMEDIATE"); kedalaman++;
  try { const r = fn(); kedalaman--; drv.exec("COMMIT"); return r; }
  catch (e) { kedalaman--; drv.exec("ROLLBACK"); throw e; }
}

/** Menjalankan langkah skema yang belum dijalankan. Mengembalikan true bila database baru dibuat. */
export function migrasi(){
  const versi = Number(one("PRAGMA user_version").user_version);
  for (let v = versi; v < MIGRASI.length; v++) {
    if (drv.transaksi) { drv.transaksi(() => { drv.exec(MIGRASI[v]); drv.exec(`PRAGMA user_version = ${v + 1}`); }); continue; }
    drv.exec("BEGIN");
    try { drv.exec(MIGRASI[v]); drv.exec(`PRAGMA user_version = ${v + 1}`); drv.exec("COMMIT"); }
    catch (e) { drv.exec("ROLLBACK"); throw e; }
  }
  cache.clear();
  return versi === 0;
}
export const versiSkema = () => MIGRASI.length;

export { DEFAULT_SETTINGS };
export function getSettings(){
  const s = { ...DEFAULT_SETTINGS };
  for (const r of all("SELECT kunci, nilai FROM settings")) { try { s[r.kunci] = JSON.parse(r.nilai); } catch { /* abaikan nilai rusak */ } }
  return s;
}
export function setSetting(k, v){ run("INSERT OR REPLACE INTO settings(kunci, nilai) VALUES (?, ?)", [k, JSON.stringify(v)]); }
