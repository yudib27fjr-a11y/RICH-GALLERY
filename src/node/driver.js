import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, renameSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { pasangDriver } from "../core/db.js";
import { versiSkema } from "../core/db.js";
import { buatDriver, pecah } from "../../public/lokal/driver.js";

let db = null;
export function bukaDb(){
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  // Mode uji: jalankan semua query lewat driver aplikasi Android (teks SQL + JSON), untuk menguji jalur Android dengan tes server.
  if (process.env.RG_DRIVER_UJI === "android") pasangDriver(buatDriver(jembatanTiruan(db)));
  else pasangDriver(db);
  return db;
}

/** Meniru jembatan RGDB Android di atas node:sqlite: hanya teks SQL, satu pernyataan per exec, hasil berupa JSON. */
function jembatanTiruan(d){
  const aman = f => { try { return JSON.stringify(f() ?? {}); } catch (e) { return JSON.stringify({ error: e.message }); } };
  return {
    exec: sql => aman(() => { if (pecah(sql).length !== 1) throw new Error("Satu pernyataan per exec"); d.exec(sql); }),
    query: sql => aman(() => ({ rows: d.prepare(sql).all() })),
    run: sql => aman(() => { const r = d.prepare(sql).run(); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }),
    begin: () => aman(() => d.exec("BEGIN IMMEDIATE")),
    commit: () => aman(() => d.exec("COMMIT")),
    rollback: () => aman(() => d.exec("ROLLBACK")),
  };
}
export const dbAktif = () => db;
export function tutupDb(){ try { db?.close(); } catch {} db = null; }

/** Salinan utuh database saat ini (aman walau server sedang dipakai). */
export function salinDb(){
  mkdirSync(config.backupDir, { recursive: true });
  const f = path.join(config.backupDir, `unduh-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  const isi = readFileSync(f); rmSync(f, { force: true });
  return isi;
}

/** Ganti seluruh database dengan isi file cadangan. Database lama disimpan dulu di folder backup. */
export function gantiDb(buf){
  if (buf.subarray(0, 16).toString("latin1") !== "SQLite format 3\0") throw new Error("Bukan file database SQLite");
  mkdirSync(config.backupDir, { recursive: true });
  const calon = path.join(config.backupDir, `pulihkan-${Date.now()}.db`);
  writeFileSync(calon, buf);
  // Periksa isi sebelum dipakai.
  const cek = new DatabaseSync(calon, { readOnly: true });
  try {
    if (cek.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("File cadangan rusak");
    const t = cek.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('users','products','materials','sales','settings')").get().n;
    if (t !== 5) throw new Error("File ini bukan database Rich Gallery");
    if (cek.prepare("PRAGMA user_version").get().user_version > versiSkema()) throw new Error("Cadangan berasal dari versi aplikasi yang lebih baru. Perbarui server dulu.");
  } catch (e) { cek.close(); rmSync(calon, { force: true }); throw e; }
  cek.close();
  const lama = path.join(config.backupDir, `sebelum-pulihkan-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${lama.replace(/'/g, "''")}'`);
  tutupDb();
  for (const s of ["-wal", "-shm"]) rmSync(config.dbPath + s, { force: true });
  renameSync(calon, config.dbPath);
  bukaDb();
}
