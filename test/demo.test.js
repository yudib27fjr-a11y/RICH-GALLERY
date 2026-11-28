// Versi demo (promosi Yudsky Tech) di simulasi Cloudflare: toko contoh netral, tiap pengunjung database sendiri, masuk tanpa password.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pecah } from "../public/lokal/driver.js";

const dir = mkdtempSync(path.join(tmpdir(), "rg-demo-"));
const PORT = 9600 + Math.floor(Math.random() * 300);
let server, alarm = {};

function storageTiruan(file){
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  let n = 0;
  return {
    sql: { exec(q, ...b){
      let rows = [];
      if (!b.length && pecah(q).length > 1) db.exec(q); else rows = db.prepare(q).all(...b);
      const w = db.prepare("SELECT changes() c").get().c;
      return { toArray: () => rows, one: () => rows[0], rowsWritten: w, rowsRead: rows.length };
    } },
    transactionSync(fn){ const sp = "t" + (++n); db.exec(`SAVEPOINT ${sp}`); try { const r = fn(); db.exec(`RELEASE ${sp}`); return r; } catch (e) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); throw e; } },
    async setAlarm(t){ alarm[file] = t; },
    async deleteAll(){ for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) db.exec(`DROP TABLE IF EXISTS "${name}"`); },
  };
}

before(async () => {
  const { default: worker, Toko } = await import("../src/cloudflare/worker.js");
  const env = { DEMO: "1", DEMO_WA: "6281234567890", ASSETS: { fetch: async () => new Response("aset", { headers: { "Content-Type": "text/plain" } }) } };
  const objek = new Map();
  env.TOKO = { idFromName: n => n, get: id => {
    if (!objek.has(id)) objek.set(id, new Toko({ storage: storageTiruan(path.join(dir, id.replace(/\W/g, "_") + ".sqlite")), waitUntil: p => p }, env));
    const t = objek.get(id); return { fetch: r => t.fetch(r instanceof Request ? r : new Request(r)) };
  } };
  server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(`http://127.0.0.1:${PORT}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(ok => server.listen(PORT, "127.0.0.1", ok));
});
after(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });

function pengunjung(){
  const cookie = {};
  return async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { "Content-Type": "application/json", "X-RG": "1", Cookie: Object.entries(cookie).map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie?.() || []) { const [kv] = sc.split(";"); const i = kv.indexOf("="); cookie[kv.slice(0, i)] = kv.slice(i + 1); }
    const teks = await r.text();
    let data = teks; try { data = JSON.parse(teks); } catch {}
    return { status: r.status, data, teks };
  };
}

test("demo: toko contoh netral, masuk tanpa password, tiap pengunjung terpisah", async () => {
  const a = pengunjung();
  const info = await a("GET", "/api/demo/info");
  assert.equal(info.status, 200); assert.equal(info.data.demo, true); assert.equal(info.data.wa, "6281234567890"); assert.equal(info.data.merek, "Yudsky Tech");
  assert.equal((await a("GET", "/api/bootstrap")).status, 401, "belum masuk");
  const ms = await a("POST", "/api/demo/masuk", { peran: "admin" }); assert.equal(ms.status, 200, ms.teks);
  const b = await a("GET", "/api/bootstrap");
  assert.equal(b.status, 200); assert.equal(b.data.toko.nama_toko, "TOKO BUNGA CONTOH"); assert.equal(b.data.me.peran, "admin");
  assert.ok(b.data.produk.length > 100 && b.data.produk.every(p => p.kode.startsWith("TB")));
  const hari = b.data.hariIni;
  const jual = await a("GET", `/api/penjualan?dari=2000-01-01&sampai=${hari}`);
  assert.ok(jual.data.length >= 30, "ada transaksi contoh 2 minggu");
  // Tidak ada data / merek toko asli yang bocor
  const atur = await a("GET", "/api/pengaturan");
  for (const t of [b.teks, atur.teks, jual.teks]) assert.doesNotMatch(t, /Rich Gallery|RICH GALLERY|RG\/SC|1340021896906|421201022815539|Khodijah|Indramayu|nyenengin/i);
  assert.equal(atur.data.sheet_id, ""); assert.equal(atur.data.sync_url, "");
  // Kasir: menu karyawan
  const k = pengunjung(); await k("GET", "/api/demo/info");
  assert.equal((await k("POST", "/api/demo/masuk", { peran: "kasir" })).status, 200);
  assert.equal((await k("GET", "/api/bootstrap")).data.me.peran, "karyawan");
  // Pengunjung lain tidak terpengaruh transaksi pengunjung A
  const p = b.data.produk.find(x => x.harga > 0);
  assert.equal((await a("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 1 }], pelanggan: "Coba", hp: "081211112222", metode: "Tunai" })).status, 200);
  const nA = (await a("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.length, nK = (await k("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.length;
  assert.equal(nA, nK + 1);
  assert.ok(Object.values(alarm).every(t => t > Date.now() + 2 * 86400_000), "database pengunjung dihapus otomatis ±3 hari");
});
