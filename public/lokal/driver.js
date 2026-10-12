/* Driver SQLite untuk aplikasi Android.
   Jembatan native (RGDB) hanya menerima teks SQL, jadi parameter disisipkan di sini sebagai literal SQL yang di-escape.
   Semua SQL berasal dari kode aplikasi; nilai dari pengguna hanya masuk sebagai literal yang sudah di-escape. */

function literal(v){
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("Angka tidak valid untuk database"); return String(v); }
  if (v instanceof Uint8Array) return "X'" + Array.from(v, b => b.toString(16).padStart(2, "0")).join("") + "'";
  return "'" + String(v).replace(/\u0000/g, "").replace(/'/g, "''") + "'";
}

/** Mengganti placeholder ?, ?NNN, :nama, $nama, @nama dengan literal. Melewati isi string, identifier bertanda kutip, dan komentar. */
export function sisipkan(sql, params = []){
  const named = params.length === 1 && params[0] && typeof params[0] === "object" && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array) ? params[0] : null;
  let out = "", i = 0, urut = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "-" && sql[i + 1] === "-") { const j = sql.indexOf("\n", i); const e = j < 0 ? sql.length : j; out += sql.slice(i, e); i = e; continue; }
    if (c === "/" && sql[i + 1] === "*") { const j = sql.indexOf("*/", i + 2); const e = j < 0 ? sql.length : j + 2; out += sql.slice(i, e); i = e; continue; }
    if (c === "?") {
      let j = i + 1; while (/[0-9]/.test(sql[j] || "")) j++;
      const n = j > i + 1 ? +sql.slice(i + 1, j) - 1 : urut++;
      if (named) throw new Error("Campuran parameter tidak didukung");
      if (n >= params.length) throw new Error("Parameter SQL kurang");
      out += literal(params[n]); i = j; continue;
    }
    if ((c === ":" || c === "$" || c === "@") && /[A-Za-z_]/.test(sql[i + 1] || "")) {
      let j = i + 1; while (/[A-Za-z0-9_]/.test(sql[j] || "")) j++;
      const k = sql.slice(i + 1, j);
      if (!named || !(k in named)) throw new Error(`Parameter :${k} tidak ada`);
      out += literal(named[k]); i = j; continue;
    }
    out += c; i++;
  }
  if (!named && urut < params.length && !/\?\d/.test(sql)) throw new Error("Parameter SQL berlebih");
  return out;
}

/** Memecah teks berisi beberapa pernyataan SQL (dipisah ;) menjadi pernyataan tunggal. */
export function pecah(sql){
  const hasil = []; let mulai = 0, i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") { let j = i + 1; while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; } i = j + 1; continue; }
    if (c === "-" && sql[i + 1] === "-") { const j = sql.indexOf("\n", i); i = j < 0 ? sql.length : j; continue; }
    if (c === "/" && sql[i + 1] === "*") { const j = sql.indexOf("*/", i + 2); i = j < 0 ? sql.length : j + 2; continue; }
    if (c === ";") { hasil.push(sql.slice(mulai, i)); mulai = i + 1; }
    i++;
  }
  hasil.push(sql.slice(mulai));
  return hasil.map(s => s.trim()).filter(s => s && !/^(--[^\n]*\n?\s*)+$/.test(s));
}

/**
 * nb: jembatan native dengan metode sinkron yang mengembalikan teks JSON:
 *   exec(sql), query(sql) → {rows:[…]}, run(sql) → {changes, lastInsertRowid}, begin(), commit(), rollback()
 *   Galat dikembalikan sebagai {error:"…"}.
 */
export function buatDriver(nb){
  const cek = s => { const o = JSON.parse(s || "{}"); if (o && o.error) throw new Error(o.error); return o; };
  return {
    exec(sql){
      const t = sql.trim().replace(/;$/, "").trim().toUpperCase();
      if (/^BEGIN\b/.test(t)) return void cek(nb.begin());
      if (t === "COMMIT" || t === "END") return void cek(nb.commit());
      if (t === "ROLLBACK") return void cek(nb.rollback());
      for (const s of pecah(sql)) cek(nb.exec(s));
    },
    prepare(sql){
      return {
        all: (...p) => cek(nb.query(sisipkan(sql, p))).rows,
        get: (...p) => cek(nb.query(sisipkan(sql, p))).rows[0],
        run: (...p) => cek(nb.run(sisipkan(sql, p))),
      };
    },
  };
}
