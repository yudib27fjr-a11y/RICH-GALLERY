/* Driver database untuk Cloudflare: SQLite di dalam Durable Object (ctx.storage.sql).
   API-nya sinkron, sama seperti node:sqlite, jadi aturan bisnis (src/core) dipakai tanpa perubahan.
   Bedanya: BEGIN/COMMIT tidak boleh lewat SQL (pakai transactionSync), dan PRAGMA user_version disimpan di tabel kecil. */
export function buatDriverDO(storage){
  const sql = storage.sql;
  sql.exec("CREATE TABLE IF NOT EXISTS _rg_meta(k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
  const versi = () => { const r = sql.exec("SELECT v FROM _rg_meta WHERE k = 'user_version'").toArray()[0]; return r ? r.v : 0; };
  const ikat = p => p.map(v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? Number(v) : v);

  return {
    exec(teks){
      const t = teks.trim();
      const m = t.match(/^PRAGMA\s+user_version\s*=\s*(\d+)\s*;?$/i);
      if (m) { sql.exec("INSERT OR REPLACE INTO _rg_meta(k, v) VALUES ('user_version', ?)", +m[1]); return; }
      if (/^PRAGMA\b/i.test(t)) return; // pengaturan koneksi diatur Cloudflare
      if (/^(BEGIN|COMMIT|END|ROLLBACK)\b/i.test(t)) throw new Error("Transaksi harus lewat transaksi()");
      sql.exec(t);
    },
    prepare(teks){
      if (/^\s*PRAGMA\s+user_version\s*;?\s*$/i.test(teks)) {
        return { get: () => ({ user_version: versi() }), all: () => [{ user_version: versi() }], run: () => ({ changes: 0, lastInsertRowid: 0 }) };
      }
      return {
        all: (...p) => sql.exec(teks, ...ikat(p)).toArray(),
        get: (...p) => sql.exec(teks, ...ikat(p)).toArray()[0],
        run: (...p) => {
          const c = sql.exec(teks, ...ikat(p));
          c.toArray();
          const id = sql.exec("SELECT last_insert_rowid() AS id").toArray()[0].id;
          return { changes: c.rowsWritten, lastInsertRowid: id };
        },
      };
    },
    transaksi: fn => storage.transactionSync(fn),
  };
}
