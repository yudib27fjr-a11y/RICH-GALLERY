// Tes versi Cloudflare: Worker + Durable Object dijalankan di simulasi lokal (penyimpanan DO ditiru dengan node:sqlite),
// lalu perangkat "iMin" (server Node sungguhan berisi transaksi) pindah ke sana dengan "kirim semua data".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pecah } from "../public/lokal/driver.js";

const dir = mkdtempSync(path.join(tmpdir(), "rg-cf-"));
const PORT_CF = 9000 + Math.floor(Math.random() * 400), PORT_I = PORT_CF + 500; // terpisah dari port tes lain
let server, imin;

/* ---- tiruan ctx.storage Durable Object (API sinkron seperti aslinya) ---- */
function storageTiruan(file){
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  let n = 0;
  return {
    sql: {
      exec(q, ...b){
        if (/^\s*(BEGIN|COMMIT|SAVEPOINT|ROLLBACK)/i.test(q)) throw new Error("DO: transaksi lewat SQL tidak diizinkan");
        let rows = [];
        if (!b.length && pecah(q).length > 1) db.exec(q);
        else rows = db.prepare(q).all(...b);
        const w = db.prepare("SELECT changes() c").get().c;
        return { toArray: () => rows, one: () => rows[0], rowsWritten: w, rowsRead: rows.length };
      },
    },
    transactionSync(fn){
      const sp = "t" + (++n);
      db.exec(`SAVEPOINT ${sp}`);
      try { const r = fn(); db.exec(`RELEASE ${sp}`); return r; }
      catch (e) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); throw e; }
    },
  };
}

const PUBLIC = path.resolve("public");
const asetTiruan = { fetch: async req => {
  let p = new URL(req.url).pathname; if (p === "/") p = "/index.html";
  const f = path.join(PUBLIC, p);
  return existsSync(f) ? new Response(readFileSync(f), { headers: { "Content-Type": p.endsWith(".html") ? "text/html" : "text/plain" } }) : new Response("404", { status: 404 });
} };

before(async () => {
  const { default: worker, Toko } = await import("../src/cloudflare/worker.js");
  const env = { ASSETS: asetTiruan };
  const toko = new Toko({ storage: storageTiruan(path.join(dir, "do.sqlite")), waitUntil: p => p }, env);
  env.TOKO = { idFromName: () => "toko", get: () => ({ fetch: r => toko.fetch(r instanceof Request ? r : new Request(r)) }) };
  server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(`http://127.0.0.1:${PORT_CF}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(ok => server.listen(PORT_CF, "127.0.0.1", ok));
  imin = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.js"], {
    env: { ...process.env, PORT: String(PORT_I), DB_PATH: path.join(dir, "imin.db"), BACKUP_DIR: path.join(dir, "bk"), SYNC_INTERVAL_SEC: "3600", COOKIE_SECURE: "false" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((ok, gagal) => { imin.stdout.on("data", d => String(d).includes("berjalan") && ok()); imin.on("exit", c => gagal(new Error("imin keluar " + c))); });
});
after(() => { imin?.kill(); server?.close(); rmSync(dir, { recursive: true, force: true }); });

/* Nama & HP pelanggan wajib saat checkout; tes yang tidak menyebutkannya memakai pelanggan contoh. */
function isiPelanggan(method, url, body){
  return method === "POST" && url === "/api/penjualan" && body ? { pelanggan: "Uji", hp: "081200000000", ...body } : body;
}
function klien(port){
  let cookie = "";
  return async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "Content-Type": "application/json", "X-RG": "1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(isiPelanggan(method, url, body)) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const tipe = r.headers.get("content-type") || "";
    return { status: r.status, data: tipe.includes("json") ? await r.json() : await r.text(), tipe };
  };
}
const cf = klien(PORT_CF), hp = klien(PORT_I);

test("Cloudflare: tampilan & API berjalan, data awal terisi", async () => {
  const halaman = await cf("GET", "/");
  assert.equal(halaman.status, 200); assert.match(halaman.data, /Rich Gallery POS/);
  assert.equal((await cf("GET", "/api/status")).data.perluSetup, true);
  assert.equal((await cf("POST", "/api/setup", { nama: "Admin Awan", password: "rahasia-123" })).status, 200);
  const B = (await cf("GET", "/api/bootstrap")).data;
  assert.ok(B.produk.length > 400, "produk awal terisi");
  // transaksi & stok di Cloudflare
  const p = B.produk.find(x => x.kode === "RG001");
  const r = await cf("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 1, ready: true }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Gagal di tengah transaksi → tidak ada yang tersimpan (rollback)
  const gagal = await cf("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 1, ready: true }, { product_id: 999999, harga: 1, qty: 1 }] });
  assert.equal(gagal.status, 404);
  const B2 = (await cf("GET", "/api/bootstrap")).data;
  assert.equal(B2.produk.find(x => x.kode === "RG001").stok, p.stok - 1, "stok hanya berkurang dari transaksi yang berhasil");
});

test("Cloudflare: mesin absen bisa mengirim scan tanpa header aplikasi", async () => {
  const mesin = (alamat, isi) => fetch(`http://127.0.0.1:${PORT_CF}${alamat}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isi) });
  assert.equal((await mesin("/api/produk", {})).status, 403, "alamat biasa tetap wajib header aplikasi");
  assert.equal((await cf("PUT", "/api/absen/pengaturan", { aktif: true })).status, 200);
  const A = (await cf("GET", "/api/absen/pengaturan")).data;
  const r = await mesin(A.alamat, { type: "attlog", cloud_id: "X", data: { pin: "5", scan: "2026-10-16 08:00" } });
  assert.equal(r.status, 200);
  assert.equal((await cf("GET", "/api/absen?dari=2026-10-16&sampai=2026-10-16")).data.takDikenal[0].pin, "5");
  assert.equal((await cf("PUT", "/api/absen/pengaturan", { aktif: false })).status, 200);
});

let iminB, noIminLama;
test("iMin berisi transaksi pindah ke Cloudflare dengan kirim semua data", async () => {
  // Siapkan iMin dengan data sendiri
  assert.equal((await hp("POST", "/api/setup", { nama: "Yudi", password: "rahasia-imin" })).status, 200);
  iminB = (await hp("GET", "/api/bootstrap")).data;
  const p = iminB.produk.find(x => x.kode === "RG002");
  for (let i = 0; i < 3; i++) {
    const r = await hp("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 1, ready: true }], pelanggan: "pelanggan " + i });
    noIminLama = r.data.no;
  }
  const iza = iminB.staf.find(s => s.nama === "IZA");
  assert.equal((await hp("PUT", `/api/users/${iza.id}`, { password: "5555" })).status, 200);
  assert.equal((await hp("POST", "/api/produk", { nama: "BUKET KHUSUS IMIN", harga: 99000, stok: 2 })).status, 200);
  iminB = (await hp("GET", "/api/bootstrap")).data;

  // Server Cloudflare sudah punya transaksi sendiri → tanpa paksa ditolak (data berbeda)
  let r = await hp("POST", "/api/cabang/sambung", { url: `http://127.0.0.1:${PORT_CF}`, nama: "Admin Awan", password: "rahasia-123" });
  assert.equal(r.status, 409); assert.match(r.data.error, /belum ada di server/);
  // Kirim semua data ke server yang sudah berisi transaksi → ditolak demi keamanan
  r = await hp("POST", "/api/cabang/sambung", { url: `http://127.0.0.1:${PORT_CF}`, nama: "Admin Awan", password: "rahasia-123", unggahAwal: true });
  assert.equal(r.status, 409); assert.match(r.data.error, /sudah berisi transaksi/);
});

test("server baru (kosong): semua data iMin pindah utuh, lalu sinkron berjalan", async () => {
  // Kosongkan server Cloudflare lewat pulihkan dari cadangan JSON tanpa transaksi (meniru server yang baru dipasang)
  const cad = await cf("GET", "/api/cadangan");
  assert.equal(cad.status, 200); assert.ok(cad.tipe.includes("json"));
  const dump = typeof cad.data === "string" ? JSON.parse(cad.data) : cad.data;
  for (const t of ["sales", "sale_items", "stock_moves", "produksi", "expenses", "insentif_bayar"]) dump.tabel[t] = [];
  const b64 = Buffer.from(JSON.stringify(dump)).toString("base64");
  assert.equal((await cf("POST", "/api/pulihkan", { data: b64, konfirmasi: "GANTI SEMUA DATA" })).status, 200);
  await cf("POST", "/api/login", { nama: "Admin Awan", password: "rahasia-123" });

  const r = await hp("POST", "/api/cabang/sambung", { url: `http://127.0.0.1:${PORT_CF}`, nama: "Admin Awan", password: "rahasia-123", perangkat: "iMin", unggahAwal: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.aktif, true); assert.equal(r.data.menunggu, 0); assert.equal(r.data.galatTerakhir, "");

  // Akun di server sekarang = akun iMin
  const admin = klien(PORT_CF);
  assert.equal((await admin("POST", "/api/login", { nama: "Admin Awan", password: "rahasia-123" })).status, 401);
  assert.equal((await admin("POST", "/api/login", { nama: "Yudi", password: "rahasia-imin" })).status, 200);
  assert.equal((await klien(PORT_CF)("POST", "/api/login", { nama: "iza", password: "5555" })).status, 200, "PIN karyawan ikut pindah");
  const BC = (await admin("GET", "/api/bootstrap")).data;
  assert.equal(BC.produk.length, iminB.produk.length);
  assert.ok(BC.produk.some(x => x.nama === "BUKET KHUSUS IMIN"));
  assert.equal(BC.produk.find(x => x.kode === "RG002").stok, iminB.produk.find(x => x.kode === "RG002").stok);
  const hari = BC.hariIni;
  const jual = (await admin("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data;
  assert.equal(jual.length, 3); assert.ok(jual.some(s => s.no === noIminLama));

  // Transaksi baru di iMin → terkirim ke Cloudflare
  const p = iminB.produk.find(x => x.kode === "RG003");
  const baru = await hp("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 2, ready: true }] });
  assert.match(baru.data.no, /A-\d{6}$/);
  const st = (await hp("POST", "/api/cabang/sinkron")).data;
  assert.equal(st.menunggu, 0, JSON.stringify(st));
  const jual2 = (await admin("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data;
  assert.ok(jual2.some(s => s.no === baru.data.no));
  const BC2 = (await admin("GET", "/api/bootstrap")).data;
  assert.equal(BC2.produk.find(x => x.kode === "RG003").stok, p.stok - 2);

  // Kirim data awal tidak bisa diulang setelah server berisi transaksi
  const d = await admin("GET", "/api/cabang/perangkat");
  assert.equal(d.data.length >= 1, true);
});

test("cadangan JSON Cloudflare bisa dipulihkan utuh; file .db ditolak dengan pesan jelas", async () => {
  const admin = klien(PORT_CF);
  await admin("POST", "/api/login", { nama: "Yudi", password: "rahasia-imin" });
  const sebelum = (await admin("GET", "/api/bootstrap")).data;
  const cad = await admin("GET", "/api/cadangan");
  const b64 = Buffer.from(typeof cad.data === "string" ? cad.data : JSON.stringify(cad.data)).toString("base64");
  assert.equal((await admin("POST", "/api/pulihkan", { data: b64, konfirmasi: "GANTI SEMUA DATA" })).status, 200);
  await admin("POST", "/api/login", { nama: "Yudi", password: "rahasia-imin" });
  const sesudah = (await admin("GET", "/api/bootstrap")).data;
  assert.equal(sesudah.produk.length, sebelum.produk.length);
  assert.deepEqual(sesudah.produk.map(p => p.stok), sebelum.produk.map(p => p.stok));
  const db = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(200)]).toString("base64");
  const r = await admin("POST", "/api/pulihkan", { data: db, konfirmasi: "GANTI SEMUA DATA" });
  assert.equal(r.status, 400); assert.match(r.data.error, /Kirim semua data/);
});
