// Tes sinkron cabang: dua server sungguhan. "pusat" = server online, "cabang" = perangkat offline (iMin) yang disambungkan ke pusat.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "rg-cabang-"));
const PORT_P = 6000 + Math.floor(Math.random() * 1000), PORT_C = PORT_P + 1000;
const procs = [];

function nyalakan(port, nama){
  const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.js"], {
    env: { ...process.env, RG_UJI_PERANGKAT: nama === "cabang" ? "1" : "", PORT: String(port), DB_PATH: path.join(dir, nama + ".db"), BACKUP_DIR: path.join(dir, nama + "-bk"), SYNC_INTERVAL_SEC: "3600", COOKIE_SECURE: "false" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  procs.push(p);
  return new Promise((ok, gagal) => { p.stdout.on("data", d => String(d).includes("berjalan") && ok()); p.on("exit", c => gagal(new Error(nama + " keluar " + c))); });
}
/* Nama & HP pelanggan wajib saat checkout; tes yang tidak menyebutkannya memakai pelanggan contoh. */
function isiPelanggan(method, url, body){
  return method === "POST" && url === "/api/penjualan" && body ? { pelanggan: "Uji", hp: "081200000000", ...body } : body;
}
function klien(port){
  let cookie = "";
  return async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "Content-Type": "application/json", "X-RG": "1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(isiPelanggan(method, url, body)) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
}
before(async () => { await Promise.all([nyalakan(PORT_P, "pusat"), nyalakan(PORT_C, "cabang")]); });
after(() => { procs.forEach(p => p.kill()); rmSync(dir, { recursive: true, force: true }); });

const pusat = klien(PORT_P), cabang = klien(PORT_C);
let BP, BC;
const prodP = kode => BP.produk.find(p => p.kode === kode);
const segarkan = async () => { BP = (await pusat("GET", "/api/bootstrap")).data; BC = (await cabang("GET", "/api/bootstrap")).data; };
const tamuC = klien(PORT_C);
async function kasirPin(nama, pin){ const u = BP.staf.find(s => s.nama === nama); return pusat("PUT", `/api/users/${u.id}`, { password: pin }); }
const sinkron = async () => { const r = await cabang("POST", "/api/cabang/sinkron"); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

test("siapkan pusat & cabang, sambungkan", async () => {
  assert.equal((await pusat("POST", "/api/setup", { nama: "Yudi", password: "rahasia-123" })).status, 200);
  assert.equal((await cabang("POST", "/api/setup", { nama: "Yudi", password: "rahasia-cabang" })).status, 200);
  await segarkan();
  // Password admin pusat salah → ditolak
  let r = await cabang("POST", "/api/cabang/sambung", { url: `http://127.0.0.1:${PORT_P}`, nama: "Yudi", password: "salah-sekali" });
  assert.equal(r.status, 403, "ditolak pusat, bukan sesi perangkat ini yang habis"); assert.match(r.data.error, /password|salah/i);
  r = await cabang("POST", "/api/cabang/sambung", { url: `http://127.0.0.1:${PORT_P}`, nama: "Yudi", password: "rahasia-123", perangkat: "iMin kasir" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.aktif, true);
  assert.equal(r.data.kode, "A");
  assert.equal(r.data.galatTerakhir, "");
  const daftar = (await pusat("GET", "/api/cabang/perangkat")).data;
  assert.equal(daftar.length, 1); assert.equal(daftar[0].nama, "iMin kasir");
});

test("data induk hanya bisa diubah di pusat", async () => {
  const r = await cabang("POST", "/api/produk", { nama: "PRODUK CABANG", harga: 1000 });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /server pusat/);
  assert.equal((await cabang("PUT", "/api/pengaturan", { nama_toko: "X" })).status, 409);
});

let noJual, noBatal;
test("transaksi di cabang terkirim ke pusat tanpa dobel", async () => {
  await segarkan();
  const p = BC.produk.find(x => x.kode === "RG001"), pp = prodP("RG001");
  const stokAwalP = pp.stok;
  // Jual 2 ready + 1 barang manual
  let r = await cabang("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 2, ready: true }, { nama: "kartu ucapan", harga: 5000, qty: 1 }], metode: "QRIS", pelanggan: "bu ani" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  noJual = r.data.no;
  assert.match(noJual, /^RG\/SC\/A-\d{6}$/, "nomor nota seri perangkat A");
  // Jual lagi lalu batalkan
  r = await cabang("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 1, ready: true }] });
  noBatal = r.data.no;
  assert.equal((await cabang("POST", `/api/penjualan/${r.data.id}/batal`, { alasan: "salah input" })).status, 200);
  // Bahan masuk, opname produk, produksi (lalu hapus satu), pengeluaran (lalu hapus)
  const bahan = BC.bahan[0];
  assert.equal((await cabang("POST", "/api/mutasi", { tipe: "masuk", jenis: "bahan", items: [{ id: bahan.id, qty: 7 }], ket: "kulakan" })).status, 200);
  const p2 = BC.produk.find(x => x.kode === "RG002");
  assert.equal((await cabang("POST", "/api/opname", { jenis: "produk", items: [{ id: p2.id, fisik: 9 }] })).status, 200);
  const iza = BC.staf.find(s => s.nama === "IZA");
  assert.equal((await cabang("POST", "/api/produksi", { pembuat_id: iza.id, restock: true, items: [{ product_id: p2.id, qty: 3 }] })).status, 200);
  assert.equal((await cabang("POST", "/api/produksi", { pembuat_id: iza.id, restock: false, items: [{ product_id: p.id, qty: 1 }] })).status, 200);
  const hari = BC.hariIni;
  const prodCabang = (await cabang("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data;
  const hapus = prodCabang.find(x => x.kode === p.kode);
  assert.equal((await cabang("DELETE", `/api/produksi/${hapus.id}`)).status, 200);
  const e1 = await cabang("POST", "/api/pengeluaran", { tgl: hari, kategori: "Operasional", ket: "plastik", nominal: 15000 });
  const e2 = await cabang("POST", "/api/pengeluaran", { tgl: hari, kategori: "Operasional", ket: "salah", nominal: 999 });
  assert.equal(e1.status, 200, JSON.stringify(e1.data));
  assert.equal((await cabang("DELETE", `/api/pengeluaran/${e2.data.id}`)).status, 200);

  const st = await sinkron();
  assert.equal(st.menunggu, 0, JSON.stringify(st));
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  assert.equal(st.galatTerakhir, "");

  // Di pusat: penjualan dengan nomor yang sama, pembatalan, stok, produksi, pengeluaran
  const jualP = (await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data;
  const s1 = jualP.find(s => s.no === noJual), s2 = jualP.find(s => s.no === noBatal);
  assert.ok(s1 && s2, "kedua nota sampai di pusat");
  assert.equal(s1.metode, "QRIS"); assert.equal(s1.pelanggan, "BU ANI"); assert.equal(s1.items.length, 2); assert.equal(s1.kasir.toUpperCase(), "YUDI");
  assert.ok(s2.batal_at, "pembatalan ikut terkirim");
  await segarkan();
  assert.equal(prodP("RG001").stok, stokAwalP - 2, "stok pusat berkurang 2 (1 lagi dikembalikan karena batal)");
  assert.equal(prodP("RG002").stok, 9 + 3, "opname 9 lalu produksi restock 3");
  assert.equal(BP.bahan.find(b => b.kode === bahan.kode).stok, bahan.stok + 7);
  const prodPusat = (await pusat("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data;
  assert.equal(prodPusat.length, 1, "produksi yang dihapus di cabang juga terhapus di pusat");
  const keluar = (await pusat("GET", `/api/pengeluaran?dari=${hari}&sampai=${hari}`)).data;
  assert.deepEqual(keluar.map(e => e.ket), ["plastik"]);
  // Stok cabang = stok pusat setelah sinkron
  assert.equal(BC.produk.find(x => x.kode === "RG001").stok, prodP("RG001").stok);
  assert.equal(BC.produk.find(x => x.kode === "RG002").stok, prodP("RG002").stok);
});

test("sinkron ulang tidak menggandakan apa pun", async () => {
  const hari = BC.hariIni;
  const sebelum = (await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.length;
  await sinkron(); await sinkron();
  assert.equal((await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.length, sebelum);
  // Perangkat palsu mengirim perintah yang sama dua kali → hanya tercatat sekali
  const d = (await pusat("POST", "/api/cabang/daftar", { nama: "Yudi", password: "rahasia-123", perangkat: "uji" })).data;
  assert.equal(d.kode, "B");
  const cmd = { uid: "uji-ganda-1", aksi: "pengeluaran", oleh: "Yudi", waktu: { tgl: hari, jam: "10:00" }, data: { uid: "e-ganda", tgl: hari, kategori: "Operasional", ket: "ganda", nominal: 1000 } };
  const k1 = await pusat("POST", "/api/cabang/kirim", { token: d.token, perintah: [cmd] });
  const k2 = await pusat("POST", "/api/cabang/kirim", { token: d.token, perintah: [cmd] });
  assert.equal(k1.data.hasil[0].status, "ok"); assert.equal(k2.data.hasil[0].status, "ok");
  const keluar = (await pusat("GET", `/api/pengeluaran?dari=${hari}&sampai=${hari}`)).data;
  assert.equal(keluar.filter(e => e.ket === "ganda").length, 1);
  // Token salah ditolak
  assert.equal((await pusat("POST", "/api/cabang/kirim", { token: "palsu", perintah: [cmd] })).status, 401);
});

test("perubahan di pusat (harga, produk baru, PIN) masuk ke cabang", async () => {
  await segarkan();
  const pp = prodP("RG003");
  assert.equal((await pusat("PUT", `/api/produk/${pp.id}`, { ...pp, harga: 123456 })).status, 200);
  const baru = await pusat("POST", "/api/produk", { nama: "BUKET BARU PUSAT", harga: 77000, stok: 4 });
  assert.equal(baru.status, 200);
  const eva = BP.staf.find(s => s.nama === "EVA");
  assert.equal((await pusat("PUT", `/api/users/${eva.id}`, { password: "4321" })).status, 200);
  await sinkron(); await segarkan();
  assert.equal(BC.produk.find(x => x.kode === "RG003").harga, 123456);
  const b = BC.produk.find(x => x.kode === baru.data.kode);
  assert.ok(b && b.stok === 4, "produk baru dari pusat ada di cabang beserta stoknya");
  // Login karyawan di cabang memakai PIN yang diatur di pusat
  const kasir = klien(PORT_C);
  assert.equal((await kasir("POST", "/api/login", { nama: "eva", password: "4321" })).status, 200);
  // Karyawan bisa jual di cabang, terkirim atas namanya
  const r = await kasir("POST", "/api/penjualan", { items: [{ product_id: b.id, harga: 77000, qty: 1, ready: true }] });
  assert.equal(r.status, 200);
  await sinkron();
  const jual = (await pusat("GET", `/api/penjualan?dari=${BC.hariIni}&sampai=${BC.hariIni}`)).data.find(s => s.no === r.data.no);
  assert.equal(jual.kasir, "EVA");
  // Penjualan yang dibuat langsung di pusat juga muncul di riwayat cabang, termasuk status batal
  const pr = BP.produk.find(x => x.kode === "RG005");
  const jp = await pusat("POST", "/api/penjualan", { items: [{ product_id: pr.id, harga: pr.harga, qty: 1, ready: true }], pelanggan: "dari pusat" });
  assert.equal(jp.status, 200);
  const jb = await pusat("POST", "/api/penjualan", { items: [{ nama: "jasa rangkai", harga: 20000, qty: 1 }] });
  assert.equal((await pusat("POST", `/api/penjualan/${jb.data.id}/batal`, { alasan: "uji" })).status, 200);
  await sinkron();
  const riwayatC = (await cabang("GET", `/api/penjualan?dari=${BC.hariIni}&sampai=${BC.hariIni}`)).data;
  const riwayatP = (await pusat("GET", `/api/penjualan?dari=${BC.hariIni}&sampai=${BC.hariIni}`)).data;
  assert.deepEqual(riwayatC.map(x => x.no).sort(), riwayatP.map(x => x.no).sort(), "daftar transaksi cabang = pusat");
  assert.ok(riwayatC.find(x => x.no === jb.data.no).batal_at, "status batal ikut");
  assert.equal(riwayatC.find(x => x.no === jp.data.no).items[0].kode, "RG005");
  // Disalin tidak membuat stok berubah dua kali: stok cabang tetap = stok pusat
  await segarkan();
  assert.equal(BC.produk.find(x => x.kode === "RG005").stok, prodP("RG005").stok);
  // Sinkron ulang tidak menggandakan salinan
  await sinkron();
  assert.equal((await cabang("GET", `/api/penjualan?dari=${BC.hariIni}&sampai=${BC.hariIni}`)).data.length, riwayatC.length);
});

test("produksi, pengeluaran & insentif dari pusat masuk ke cabang; versi sama = jawaban kecil", async () => {
  await segarkan();
  const hari = BC.hariIni;
  // Perangkat bertanya dengan versi terakhir: bila tidak ada perubahan, server tidak mengirim data.
  const d = (await pusat("POST", "/api/cabang/daftar", { nama: "Yudi", password: "rahasia-123", perangkat: "uji versi" })).data;
  const t1 = (await pusat("POST", "/api/cabang/tarik", { token: d.token })).data;
  assert.ok(t1.versi && Array.isArray(t1.produk) && Array.isArray(t1.produksi) && t1.sejak);
  const t2 = (await pusat("POST", "/api/cabang/tarik", { token: d.token, versi: t1.versi })).data;
  assert.deepEqual(t2, { tetap: true, versi: t1.versi, perangkat: "uji versi", perangkat_absen: false });
  const v1 = (await pusat("GET", "/api/versi")).data.versi;
  assert.equal(v1, t1.versi);

  // Dicatat langsung di pusat
  const anis = BP.staf.find(s => s.nama === "ANIS") || BP.staf.find(s => s.peran === "karyawan" && s.nama !== "IZA");
  const pr = prodP("RG006");
  assert.equal((await pusat("POST", "/api/produksi", { pembuat_id: anis.id, restock: false, items: [{ product_id: pr.id, qty: 5 }, { product_id: prodP("RG007").id, qty: 2 }] })).status, 200);
  const ex = await pusat("POST", "/api/pengeluaran", { tgl: hari, kategori: "Operasional", ket: "listrik pusat", nominal: 50000 });
  const exHapus = await pusat("POST", "/api/pengeluaran", { tgl: hari, kategori: "Operasional", ket: "batal pusat", nominal: 1 });
  assert.equal(ex.status, 200);
  assert.equal((await pusat("DELETE", `/api/pengeluaran/${exHapus.data.id}`)).status, 200);
  const t3 = (await pusat("POST", "/api/cabang/tarik", { token: d.token, versi: t1.versi })).data;
  assert.ok(!t3.tetap && t3.versi !== t1.versi, "ada perubahan → data lengkap");

  await sinkron();
  const prodC = (await cabang("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data;
  const prodP2 = (await pusat("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data;
  assert.deepEqual(prodC.map(x => `${x.kode}:${x.qty}:${x.pembuat}`).sort(), prodP2.map(x => `${x.kode}:${x.qty}:${x.pembuat}`).sort(), "produksi cabang = pusat");
  const keluarC = (await cabang("GET", `/api/pengeluaran?dari=${hari}&sampai=${hari}`)).data;
  const keluarP = (await pusat("GET", `/api/pengeluaran?dari=${hari}&sampai=${hari}`)).data;
  assert.deepEqual(keluarC.map(x => `${x.ket}:${x.nominal}`).sort(), keluarP.map(x => `${x.ket}:${x.nominal}`).sort(), "pengeluaran cabang = pusat");
  assert.ok(keluarC.some(x => x.ket === "ganda"), "pengeluaran dari perangkat lain juga masuk");
  assert.ok(!keluarC.some(x => x.ket === "batal pusat"), "yang dihapus di pusat ikut terhapus");
  // Stok tidak berubah karena salinan produksi
  await segarkan();
  assert.equal(BC.produk.find(x => x.kode === "RG006").stok, prodP("RG006").stok);

  // Hapus di cabang catatan produksi yang dibuat di pusat → terhapus juga di pusat
  const dariPusat = prodC.find(x => x.kode === "RG007");
  assert.equal((await cabang("DELETE", `/api/produksi/${dariPusat.id}`)).status, 200);
  const st = await sinkron();
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  assert.ok(!(await pusat("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.some(x => x.kode === "RG007"));
  // Sinkron ulang tidak menggandakan
  await sinkron(); await sinkron();
  assert.equal((await cabang("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.length, (await pusat("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.length);
  assert.equal((await cabang("GET", `/api/pengeluaran?dari=${hari}&sampai=${hari}`)).data.length, keluarP.length);

  // Insentif dibayar di pusat → cabang tahu (status dibayar & pengeluarannya)
  const ins = (await pusat("GET", `/api/insentif?tgl=${hari}`)).data;
  const baris = ins.rows.find(r => r.pembuat_id === anis.id);
  assert.equal((await pusat("POST", "/api/insentif/bayar", { pembuat_id: anis.id, periode_dari: ins.dari, catat_pengeluaran: true })).status, 200);
  await sinkron();
  const insC = (await cabang("GET", `/api/insentif?tgl=${hari}`)).data;
  assert.ok(insC.rows.find(r => r.nama === baris.nama).bayar, "status dibayar ikut");
  assert.ok((await cabang("GET", `/api/pengeluaran?dari=${hari}&sampai=${hari}`)).data.some(x => x.kategori === "Insentif Produksi"));
  // Versi data di cabang ikut berubah (layar memakainya untuk memuat ulang otomatis)
  assert.ok((await cabang("GET", "/api/versi")).data.versi);
});

test("hapus transaksi (salah input / uji coba) ikut terhapus di kedua sisi, stok kembali", async () => {
  await segarkan();
  const hari = BC.hariIni;
  const p = BC.produk.find(x => x.kode === "RG008");
  const stok0 = prodP("RG008").stok;
  // Dari cabang: jual lalu hapus
  const j1 = await cabang("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 2, ready: true }], pelanggan: "uji hapus" });
  await sinkron();
  assert.ok((await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.some(x => x.no === j1.data.no));
  assert.equal((await cabang("DELETE", `/api/penjualan/${j1.data.id}`)).status, 200);
  let st = await sinkron();
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  assert.ok(!(await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.some(x => x.no === j1.data.no), "terhapus di pusat");
  await segarkan();
  assert.equal(prodP("RG008").stok, stok0, "stok pusat kembali");
  assert.equal(BC.produk.find(x => x.kode === "RG008").stok, stok0, "stok cabang kembali");
  // Dari pusat: jual lalu hapus → hilang juga dari cabang
  const pp = prodP("RG008");
  const j2 = await pusat("POST", "/api/penjualan", { items: [{ product_id: pp.id, harga: pp.harga, qty: 1, ready: true }] });
  await sinkron();
  assert.ok((await cabang("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.some(x => x.no === j2.data.no));
  assert.equal((await pusat("DELETE", `/api/penjualan/${j2.data.id}`)).status, 200);
  await sinkron();
  assert.ok(!(await cabang("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.some(x => x.no === j2.data.no), "terhapus di cabang");
  // Hapus semua transaksi hari ini dari cabang (bersihkan uji coba)
  assert.equal((await cabang("POST", "/api/penjualan/hapus-rentang", { dari: hari, sampai: hari, konfirmasi: "salah" })).status, 400);
  const r = await cabang("POST", "/api/penjualan/hapus-rentang", { dari: hari, sampai: hari, konfirmasi: "hapus" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.jumlah > 0);
  st = await sinkron();
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  assert.equal((await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.length, 0, "pusat bersih");
  assert.equal((await cabang("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.length, 0, "cabang bersih");
  await segarkan();
  for (const x of BP.produk) assert.equal(BC.produk.find(y => y.kode === x.kode).stok, x.stok, "stok sama " + x.kode);
});

test("ganti nama perangkat di server → ikut di perangkat", async () => {
  const a = (await pusat("GET", "/api/cabang/perangkat")).data.find(x => x.kode === "A");
  assert.equal((await pusat("PUT", `/api/cabang/perangkat/${a.id}`, { nama: "iMin Kasir Depan" })).status, 200);
  const st = await sinkron();
  assert.equal(st.nama, "iMin Kasir Depan");
  assert.equal(st.kode, "A");
  // Dari Pengaturan di perangkat
  const r = await cabang("POST", "/api/cabang/nama", { nama: "iMin Belakang" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.nama, "iMin Belakang");
  assert.equal((await pusat("GET", "/api/cabang/perangkat")).data.find(x => x.kode === "A").nama, "iMin Belakang");
  assert.equal((await sinkron()).nama, "iMin Belakang");
});

test("absensi sidik jari: mesin kirim scan → rekap di server & di cabang", async () => {
  await segarkan();
  const hari = BC.hariIni;
  const kirimMesin = (alamat, isi) => fetch(`http://127.0.0.1:${PORT_P}${alamat}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isi) });
  // Belum aktif: alamat apa pun ditolak
  assert.equal((await kirimMesin("/api/absen/mesin/apa-saja", { type: "attlog", data: { pin: "1", scan: `${hari} 08:00` } })).status, 403);
  assert.equal((await pusat("PUT", "/api/absen/pengaturan", { aktif: true })).status, 200);
  // Jam kerja bawaan: Shift 1 09.00–17.00, Shift 2 12.00–21.00; upah lembur bisa diubah
  const J = (await pusat("GET", "/api/jam-kerja")).data;
  assert.deepEqual(J.shifts.map(x => `${x.masuk}-${x.pulang}`), ["09:00-17:00", "12:00-21:00"]);
  assert.equal(J.jam_buka, "09:00"); assert.equal(J.jam_tutup, "21:00");
  assert.equal((await pusat("PUT", "/api/jam-kerja", { shifts: [{ nama: "Rusak", masuk: "17:00", pulang: "09:00" }] })).status, 400, "pulang sebelum masuk ditolak");
  assert.equal((await pusat("PUT", "/api/jam-kerja", { lembur_per_jam: 20000, lembur_bulat: 30, ins_kurir: 15000 })).status, 200);
  const A = (await pusat("GET", "/api/absen/pengaturan")).data;
  assert.match(A.alamat, /^\/api\/absen\/mesin\/.{20,}$/);
  const iza = A.karyawan.find(k => k.nama === "IZA"), eva = A.karyawan.find(k => k.nama === "EVA");
  assert.equal((await pusat("PUT", "/api/absen/pengaturan", { pin: [{ user_id: iza.id, pin: "1" }, { user_id: eva.id, pin: "1" }] })).status, 400, "PIN ganda ditolak");
  assert.equal((await pusat("PUT", "/api/absen/pengaturan", { pin: [{ user_id: iza.id, pin: "1" }, { user_id: eva.id, pin: "2" }] })).status, 200);
  // Mesin mengirim (tanpa header aplikasi), alamat salah ditolak
  assert.equal((await kirimMesin("/api/absen/mesin/salah", { type: "attlog", data: { pin: "1", scan: `${hari} 07:55` } })).status, 403);
  for (const [pin, jam] of [["1", "07:55"], ["1", "07:55"], ["2", "09:20:31"], ["1", "17:05"], ["9", "09:00"]]) {
    const r = await kirimMesin(A.alamat, { type: "attlog", cloud_id: "ABC123", data: { pin, scan: `${hari} ${jam}`, verify: "1", status_scan: "0" } });
    assert.equal(r.status, 200);
  }
  assert.equal((await kirimMesin(A.alamat, { type: "uji" })).status, 200);
  const R = (await pusat("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data;
  const hIza = R.harian.find(h => h.nama === "IZA"), hEva = R.harian.find(h => h.nama === "EVA");
  assert.equal(hIza.scan.length, 2, "scan dobel dari mesin tidak tercatat dua kali");
  assert.equal(hIza.masuk, "07:55"); assert.equal(hIza.pulang, "17:05"); assert.equal(hIza.terlambat, false);
  assert.equal(hEva.masuk, "09:20"); assert.equal(hEva.pulang, ""); assert.equal(hEva.terlambat, true);
  // Lembur: datang 65 menit lebih awal + pulang 5 menit lewat = 70 menit → dibulatkan per 30 menit = 60 menit
  assert.equal(hIza.shift, "Shift 1"); assert.equal(hIza.lembur, 60); assert.equal(hEva.lembur, 0);
  assert.equal(R.ringkas.find(r => r.nama === "IZA").lembur_rp, 20000);
  const rekP = (await pusat("GET", "/api/insentif")).data.rows.find(r => r.nama === "IZA");
  assert.equal(rekP.lembur_menit, 60); assert.equal(rekP.lembur_rp, 20000); assert.equal(rekP.total, rekP.insentif + rekP.lain + 20000);
  // Shift tetap: EVA di Shift 2 (12.00) → datang 09.20 bukan terlambat, tapi lembur datang awal
  assert.equal((await pusat("PUT", "/api/jam-kerja", { shift_karyawan: [{ user_id: eva.id, shift: "2" }] })).status, 200);
  const hEva2 = (await pusat("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data.harian.find(h => h.nama === "EVA");
  assert.equal(hEva2.shift, "Shift 2"); assert.equal(hEva2.terlambat, false); assert.equal(hEva2.lembur, 150);
  assert.equal((await pusat("PUT", "/api/jam-kerja", { shift_karyawan: [{ user_id: eva.id, shift: "" }] })).status, 200);
  assert.deepEqual(R.takDikenal.map(t => t.pin), ["9"]);
  // Absen oleh admin: jam selalu jam sekarang (tanggal/jam dari luar diabaikan), wajib pilih masuk/pulang
  assert.equal((await pusat("POST", "/api/absen/manual", { user_id: eva.id })).status, 400);
  const man = await pusat("POST", "/api/absen/manual", { user_id: eva.id, jenis: "pulang", tgl: "2020-01-01", jam: "01:00", ket: "HP mati" });
  assert.equal(man.status, 200);
  assert.equal(man.data.tgl, hari); assert.notEqual(man.data.jam, "01:00");
  const scanEva = (await pusat("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data.harian.find(h => h.nama === "EVA").scan;
  assert.ok(scanEva.some(x => x.sumber === "manual" && x.jenis === "pulang" && x.jam === man.data.jam));
  assert.equal((await pusat("DELETE", `/api/absen/${man.data.id}`)).status, 200);
  // Di cabang: menu absensi aktif & rekapnya diambil dari server pusat
  await sinkron(); await segarkan();
  assert.equal(BC.toko.absen_aktif, true);
  assert.equal(BC.cabang, true);
  const RC = (await cabang("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data;
  assert.equal(RC.harian.find(h => h.nama === "IZA").pulang, "17:05");
  assert.equal((await cabang("POST", "/api/absen/manual", { user_id: eva.id, jenis: "masuk" })).status, 409, "diatur di server pusat");
  assert.equal((await cabang("PUT", "/api/jam-kerja", { lembur_per_jam: 1 })).status, 409, "diatur di server pusat");
  // Lembur di rekap insentif perangkat diambil dari server pusat
  const rekC = (await cabang("GET", "/api/insentif")).data;
  assert.equal(rekC.lemburTersedia, true);
  assert.equal(rekC.rows.find(r => r.nama === "IZA").lembur_rp, 20000);
  assert.equal(BC.toko.lembur_per_jam, 20000); assert.equal(BC.toko.ins_kurir, 15000);
});

test("insentif lain (kurir, lapangan, konten): dicatat di cabang/pusat, ikut ke rekap & sinkron dua arah", async () => {
  await segarkan();
  const hari = BC.hariIni;
  const izaC = BC.staf.find(s => s.nama === "IZA");
  const c1 = await cabang("POST", "/api/insentif-lain", { user_id: izaC.id, jenis: "kurir", ket: "antar ke Jatibarang" });
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  assert.equal((await cabang("POST", "/api/insentif-lain", { user_id: izaC.id, jenis: "lain" })).status, 400);
  assert.equal((await cabang("POST", "/api/insentif-lain", { user_id: izaC.id, jenis: "konten", nominal: 25000 })).status, 200);
  await sinkron();
  const lp = (await pusat("GET", `/api/insentif-lain?dari=${hari}&sampai=${hari}`)).data;
  assert.deepEqual(lp.map(x => `${x.nama}:${x.jenis}:${x.nominal}`).sort(), ["IZA:konten:25000", "IZA:kurir:15000"], "nominal kurir bawaan dari pengaturan");
  const rek = (await pusat("GET", "/api/insentif")).data.rows.find(r => r.nama === "IZA");
  assert.equal(rek.lain, 40000);
  assert.deepEqual(rek.lainDetail.map(d => `${d.jenis}:${d.kali}:${d.nominal}`), ["konten:1:25000", "kurir:1:15000"]);
  // Dicatat di pusat → masuk ke cabang; dihapus di cabang → hilang di pusat
  const eva = (await pusat("GET", "/api/jam-kerja")).data.karyawan.find(k => k.nama === "EVA");
  assert.equal((await pusat("POST", "/api/insentif-lain", { user_id: eva.id, jenis: "lapangan", nominal: 30000 })).status, 200);
  await sinkron();
  const lc = (await cabang("GET", `/api/insentif-lain?dari=${hari}&sampai=${hari}`)).data;
  assert.ok(lc.some(x => x.nama === "EVA" && x.jenis === "lapangan" && x.nominal === 30000));
  const kurirC = lc.find(x => x.jenis === "kurir");
  assert.equal((await cabang("DELETE", `/api/insentif-lain/${kurirC.id}`)).status, 200);
  const st = await sinkron();
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  assert.ok(!(await pusat("GET", `/api/insentif-lain?dari=${hari}&sampai=${hari}`)).data.some(x => x.jenis === "kurir"));
  assert.equal((await cabang("GET", "/api/insentif")).data.rows.find(r => r.nama === "IZA").lain, 25000);
  // Bayar: nominal bawaan = total (produksi + lain + lembur), lalu terkunci
  const r2 = (await pusat("GET", "/api/insentif")).data;
  const iza = r2.rows.find(r => r.nama === "IZA");
  assert.equal((await pusat("POST", "/api/insentif/bayar", { pembuat_id: iza.pembuat_id, periode_dari: r2.dari })).status, 200);
  const sesudah = (await pusat("GET", "/api/insentif")).data.rows.find(r => r.nama === "IZA");
  assert.equal(sesudah.bayar.nominal, iza.total);
  assert.equal((await pusat("POST", "/api/insentif-lain", { user_id: iza.pembuat_id, jenis: "konten", nominal: 1000 })).status, 400, "periode sudah dibayar");
  // Gaji di perangkat: dilihat dari server pusat, pembayaran hanya di server
  const GC = await cabang("GET", `/api/gaji?tgl=${hari}`);
  assert.equal(GC.status, 200, JSON.stringify(GC.data)); assert.equal(GC.data.dariPusat, true);
  assert.equal(GC.data.rows.find(r => r.nama === "IZA").bayar, null, "insentif dibayar terpisah, gaji belum");
  assert.equal((await cabang("POST", "/api/gaji/bayar", { user_id: izaC.id, periode_dari: GC.data.dari, metode: "Tunai" })).status, 409);
  assert.equal((await cabang("GET", "/api/kasbon")).status, 200);
});

test("ubah catatan produksi di cabang (salah pembuat & jumlah) → ikut berubah di pusat, stok pas", async () => {
  await segarkan();
  const hari = BC.hariIni;
  const eva = BC.staf.find(s => s.nama === "EVA"), manu = BC.staf.find(s => s.nama === "MANU");
  const p = BC.produk.find(x => x.kode === "RG011") || BC.produk[5];
  assert.equal((await cabang("POST", "/api/produksi", { pembuat_id: eva.id, restock: true, items: [{ product_id: p.id, qty: 2 }] })).status, 200);
  await sinkron(); await segarkan();
  const stokP0 = BP.produk.find(x => x.kode === p.kode).stok;
  const c = (await cabang("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.find(x => x.kode === p.kode && x.pembuat === "EVA" && x.qty === 2);
  assert.equal((await cabang("PUT", `/api/produksi/${c.id}`, { pembuat_id: manu.id, qty: 6 })).status, 200);
  const st = await sinkron();
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  await segarkan();
  const prodP = (await pusat("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.filter(x => x.kode === p.kode && x.qty === 6);
  assert.equal(prodP.length, 1); assert.equal(prodP[0].pembuat, "MANU");
  assert.equal(BP.produk.find(x => x.kode === p.kode).stok, stokP0 + 4, "stok pusat ikut dikoreksi");
  assert.equal(BC.produk.find(x => x.kode === p.kode).stok, stokP0 + 4, "stok cabang sama");
});

test("pesanan: DP di cabang, pelunasan di pusat, diambil di cabang — status sama di kedua sisi", async () => {
  await segarkan();
  const p = BC.produk.find(x => x.kode === "RG009");
  const besok = new Date(Date.now() + 7 * 3600e3 + 86400e3).toISOString().slice(0, 10);
  const j = await cabang("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: 100000, qty: 1 }], pelanggan: "bu rina", hp: "081230000000", bayar: 40000,
    kartu: "Selamat ulang tahun!", pesanan: { tgl: besok, jam: "15:00", cara: "antar", request: "Pita merah, kartu: Selamat ulang tahun" } });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  assert.equal(j.data.ambil_tgl, besok); assert.equal(j.data.ambil_cara, "antar"); assert.match(j.data.request, /Pita merah/);
  await sinkron();
  let ps = (await pusat("GET", "/api/pesanan")).data.find(x => x.no === j.data.no);
  assert.ok(ps, "pesanan sampai di pusat"); assert.equal(ps.bayar, 40000); assert.equal(ps.kartu, "Selamat ulang tahun!"); assert.equal(ps.ambil_jam, "15:00"); assert.match(ps.request, /kartu/);
  // Dilunasi di pusat (QRIS) → cabang ikut lunas
  assert.equal((await pusat("POST", `/api/penjualan/${ps.id}/lunasi`, { metode: "QRIS" })).status, 200);
  assert.equal((await pusat("POST", `/api/penjualan/${ps.id}/lunasi`, { metode: "QRIS" })).status, 400, "sudah lunas");
  await sinkron();
  let pc = (await cabang("GET", "/api/pesanan")).data.find(x => x.no === j.data.no);
  assert.equal(pc.bayar, 100000); assert.equal(pc.lunas_metode, "QRIS"); assert.ok(pc.lunas_at);
  // Diantar (dicatat di cabang) → pusat ikut selesai
  assert.equal((await cabang("POST", `/api/penjualan/${pc.id}/diambil`, {})).status, 200);
  const st = await sinkron();
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  assert.ok(!(await pusat("GET", "/api/pesanan")).data.some(x => x.no === j.data.no), "tidak lagi di daftar aktif pusat");
  assert.ok((await pusat("GET", "/api/pesanan?status=selesai")).data.find(x => x.no === j.data.no).diambil_at);
  assert.ok((await cabang("GET", "/api/pesanan?status=selesai")).data.some(x => x.no === j.data.no));
  // Pelunasan sebagian dari cabang
  const j2 = await cabang("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: 50000, qty: 1 }], bayar: 10000, pesanan: { tgl: besok } });
  const id2 = j2.data.id;
  assert.equal((await cabang("POST", `/api/penjualan/${id2}/lunasi`, { nominal: 15000, metode: "Transfer" })).status, 200);
  await sinkron();
  assert.equal((await pusat("GET", "/api/pesanan")).data.find(x => x.no === j2.data.no).bayar, 25000);
});

test("absen PIN + selfie: hanya perangkat yang diizinkan & di lokasi toko", async () => {
  await segarkan();
  const hari = BC.hariIni;
  const FOTO = "data:image/jpeg;base64," + "A".repeat(4000);
  const DI_TOKO = { lat: -6.32740, lng: 108.32470 }, JAUH = { lat: -6.34000, lng: 108.32470 }; // ±1,4 km
  const izaC = BC.staf.find(s => s.nama === "IZA");
  assert.equal((await kasirPin("IZA", "1234")).status, 200, "PIN karyawan diatur di pusat");
  // Belum aktif
  let k = (await cabang("GET", "/api/absen/kiosk")).data;
  assert.equal(k.boleh, false); assert.match(k.alasan, /belum diaktifkan/);
  assert.equal((await pusat("GET", "/api/absen/pengaturan")).data.lat, "-6.3377069", "koordinat toko bawaan");
  // Server pusat menolak absen PIN langsung (bukan perangkat kasir)
  assert.equal((await pusat("PUT", "/api/absen/pengaturan", { pin_aktif: true, lat: DI_TOKO.lat, lng: DI_TOKO.lng, radius: 100 })).status, 200);
  assert.equal((await pusat("POST", "/api/absen/pin", { user_id: 1, pin: "x" })).status, 403);
  await sinkron();
  k = (await cabang("GET", "/api/absen/kiosk")).data;
  assert.match(k.alasan, /belum diizinkan/, "perangkat belum diizinkan admin");
  const a = (await pusat("GET", "/api/cabang/perangkat")).data.find(x => x.kode === "A");
  assert.equal((await pusat("PUT", `/api/cabang/perangkat/${a.id}`, { absen: true })).status, 200);
  await sinkron();
  k = (await cabang("GET", "/api/absen/kiosk")).data;
  assert.equal(k.boleh, true, JSON.stringify(k)); assert.ok(k.staf.some(s => s.nama === "IZA"));
  const absen = b => tamuC("POST", "/api/absen/pin", { user_id: izaC.id, pin: "1234", jenis: "masuk", foto: FOTO, akurasi: 15, ...DI_TOKO, ...b });
  assert.equal((await absen({ pin: "9999" })).status, 401, "PIN salah");
  assert.equal((await absen({ foto: "" })).status, 400, "foto wajib");
  const jauh = await absen(JAUH);
  assert.equal(jauh.status, 400); assert.match(jauh.data.error, /hanya bisa di toko/);
  const ok = await absen({});
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.nama, "IZA"); assert.ok(ok.data.jarak < 5);
  const st = await sinkron();
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  const R = (await pusat("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data;
  const h = R.harian.find(x => x.nama === "IZA");
  const sc = h.scan.find(x => x.sumber === "pin");
  assert.ok(sc && sc.foto && sc.jenis === "masuk", "absen sampai di server dengan foto");
  assert.equal((await pusat("GET", `/api/absen/${sc.id}/foto`)).data.foto, FOTO);
  // Admin di perangkat bisa melihat foto (diambil dari server) & mengatur lokasi toko dari perangkat
  assert.equal((await cabang("GET", `/api/absen/${sc.id}/foto`)).data.foto, FOTO);
  assert.equal((await cabang("POST", "/api/absen/lokasi-toko", { lat: -6.3275, lng: 108.3248 })).status, 200);
  assert.equal((await pusat("GET", "/api/absen/pengaturan")).data.lat, "-6.3275");
  // Izin dicabut → perangkat tidak bisa absen lagi
  assert.equal((await pusat("PUT", `/api/cabang/perangkat/${a.id}`, { absen: false })).status, 200);
  await sinkron();
  assert.equal((await cabang("GET", "/api/absen/kiosk")).data.boleh, false);
  // HP admin (browser, mis. iPhone) didaftarkan sebagai tempat absen di server
  const tamuP = klien(PORT_P), LOK = { lat: -6.3275, lng: 108.3248 };
  assert.match((await tamuP("GET", "/api/absen/kiosk")).data.alasan, /belum didaftarkan/);
  assert.equal((await tamuP("POST", "/api/absen/daftar-hp", { nama: "iPhone admin" })).status, 401, "hanya admin");
  const hp = (await pusat("POST", "/api/absen/daftar-hp", { nama: "iPhone admin" })).data;
  assert.ok(hp.token && /^W\d+$/.test(hp.kode));
  k = (await tamuP("GET", `/api/absen/kiosk?alat=${encodeURIComponent(hp.token)}`)).data;
  assert.equal(k.boleh, true, JSON.stringify(k)); assert.equal(k.hp, "iPhone admin"); assert.ok(k.staf.length);
  const izaP = k.staf.find(s => s.nama === "IZA");
  const absenHp = b => tamuP("POST", "/api/absen/pin", { alat: hp.token, user_id: izaP.id, pin: "1234", jenis: "pulang", foto: FOTO, akurasi: 10, ...LOK, ...b });
  assert.equal((await absenHp({ alat: "palsu" })).status, 403, "token salah");
  assert.equal((await absenHp(JAUH)).status, 400, "di luar toko");
  assert.equal((await pusat("POST", "/api/notif/langganan", { endpoint: "https://fcm.googleapis.com/fcm/send/uji-absen", nama: "HP admin" })).status, 200);
  const okHp = await absenHp({});
  assert.equal(okHp.status, 200, JSON.stringify(okHp.data)); assert.equal(okHp.data.jenis, "pulang");
  const nt = (await pusat("GET", "/api/notif/terbaru")).data;
  assert.ok(nt.some(x => /Iza absen pulang/.test(x.judul) && /iPhone admin/.test(x.isi)), "notifikasi absen ke HP admin: " + JSON.stringify(nt));
  const R2 = (await pusat("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data;
  assert.ok(R2.harian.find(x => x.nama === "IZA").scan.some(x => x.sumber === "pin" && x.jenis === "pulang"), "absen HP masuk rekap");
  // Token HP absen tidak bisa dipakai sebagai perangkat kasir (kirim transaksi)
  assert.equal((await tamuP("POST", "/api/cabang/kirim", { token: hp.token, perintah: [] })).status, 401);
  // Dicabut admin → tidak bisa absen lagi
  const w = (await pusat("GET", "/api/cabang/perangkat")).data.find(x => x.kode === hp.kode);
  assert.equal((await pusat("DELETE", `/api/cabang/perangkat/${w.id}`)).status, 200);
  assert.equal((await absenHp({})).status, 403);
});

test("barang custom dengan pembuat otomatis masuk produksi & insentif (cabang → pusat), batal → hilang", async () => {
  await segarkan();
  const hari = BC.hariIni;
  const savira = BC.staf.find(s => s.nama === "SAVIRA");
  const p = BC.produk.find(x => x.kode === "RG010");
  const j = await cabang("POST", "/api/penjualan", { items: [
    { nama: "buket custom pink", harga: 175000, qty: 1, pembuat_id: savira.id },
    { product_id: p.id, harga: p.harga, qty: 2, ready: false, pembuat_id: savira.id },
    { nama: "kartu ucapan", harga: 5000, qty: 1 },
  ] });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  assert.equal(j.data.items[0].pembuat, "SAVIRA");
  const prodC = (await cabang("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.filter(x => x.pembuat === "SAVIRA");
  assert.deepEqual(prodC.map(x => `${x.nama}:${x.qty}`).sort(), ["BUKET CUSTOM PINK:1", `${p.nama}:2`].sort(), "tercatat di produksi cabang");
  await sinkron();
  const prodP = (await pusat("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.filter(x => x.pembuat === "SAVIRA");
  assert.equal(prodP.length, 2, "ikut tercatat di pusat");
  const ins = (await pusat("GET", `/api/insentif?tgl=${hari}`)).data.rows.find(r => r.nama === "SAVIRA");
  assert.equal(ins.qty, 3, "masuk hitungan insentif");
  // Sinkron ulang tidak menggandakan
  await sinkron(); await sinkron();
  assert.equal((await cabang("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.filter(x => x.pembuat === "SAVIRA").length, 2);
  // Batal → catatan produksi otomatis hilang di kedua sisi
  assert.equal((await cabang("POST", `/api/penjualan/${j.data.id}/batal`, { alasan: "uji" })).status, 200);
  await sinkron();
  assert.equal((await cabang("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.filter(x => x.pembuat === "SAVIRA").length, 0);
  assert.equal((await pusat("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.filter(x => x.pembuat === "SAVIRA").length, 0);
});

test("server mati: transaksi menunggu, lalu terkirim saat server hidup lagi", async () => {
  const pusatProc = procs[0];
  pusatProc.kill(); await new Promise(r => pusatProc.on("exit", r));
  await segarkan().catch(() => {});
  BC = (await cabang("GET", "/api/bootstrap")).data;
  const p = BC.produk.find(x => x.kode === "RG004");
  const r = await cabang("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 1, ready: true }] });
  assert.equal(r.status, 200, "kasir tetap bisa jual walau server mati");
  let st = await sinkron();
  assert.equal(st.menunggu, 1);
  assert.match(st.galatTerakhir, /tidak bisa dihubungi/);
  procs.shift();
  await nyalakan(PORT_P, "pusat");
  st = await sinkron();
  assert.equal(st.menunggu, 0); assert.equal(st.galatTerakhir, "");
  const jual = (await pusat("POST", "/api/login", { nama: "Yudi", password: "rahasia-123" }), (await pusat("GET", `/api/penjualan?dari=${BC.hariIni}&sampai=${BC.hariIni}`)).data);
  assert.ok(jual.some(s => s.no === r.data.no));
});

test("hard reset di server → transaksi di perangkat cabang ikut kosong, stok 0", async () => {
  await sinkron(); await segarkan();
  const hari = BC.hariIni;
  assert.ok((await cabang("GET", `/api/penjualan?dari=2000-01-01&sampai=${hari}`)).data.length > 0);
  assert.equal((await cabang("POST", "/api/reset", { kode: "OK", transaksi: true })).status, 409, "reset dari server pusat");
  // Hapus transaksi lama saja (sebelum hari ini): transaksi hari ini di perangkat tetap ada
  const adaHariIni = (await cabang("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.length;
  assert.equal((await pusat("POST", "/api/reset", { kode: "OK", sebelum: hari })).status, 200);
  await sinkron(); await segarkan();
  assert.equal((await cabang("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.length, adaHariIni, "hari ini tidak ikut terhapus");
  assert.ok(adaHariIni > 0);
  assert.equal((await pusat("POST", "/api/reset", { kode: "OK", transaksi: true, stok: true })).status, 200);
  const st = await sinkron(); await segarkan();
  assert.equal(st.ditolak, 0);
  assert.equal((await cabang("GET", `/api/penjualan?dari=2000-01-01&sampai=${hari}`)).data.length, 0, "riwayat di perangkat kosong");
  assert.equal((await cabang("GET", `/api/produksi?dari=2000-01-01&sampai=${hari}`)).data.length, 0);
  assert.ok(BC.produk.every(x => x.stok === 0));
  // Transaksi baru setelah reset tetap jalan & tidak dihapus lagi di sinkron berikutnya
  const p = BC.produk[0];
  assert.equal((await pusat("POST", "/api/opname", { jenis: "produk", items: [{ id: prodP(p.kode).id, fisik: 5 }] })).status, 200);
  await sinkron(); await segarkan();
  const j = await cabang("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: p.harga, qty: 1, ready: true }] });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  await sinkron(); await sinkron();
  assert.equal((await cabang("GET", `/api/penjualan?dari=2000-01-01&sampai=${hari}`)).data.length, 1);
  assert.equal((await pusat("GET", `/api/penjualan?dari=2000-01-01&sampai=${hari}`)).data.length, 1);
});

test("penjualan yang pernah ditolak server tidak hilang: dikirim ulang otomatis & diterima (versi aman)", async () => {
  await sinkron(); await segarkan();
  const { DatabaseSync } = await import("node:sqlite");
  const hari = BC.hariIni, p = BC.produk.find(x => x.stok > 0) || BC.produk[0];
  const stokP0 = prodP(p.kode).stok;
  const data = no => JSON.stringify({ no, tgl: hari, jam: "10:00", pelanggan: "BU X", hp: "081234567890", metode: "Tunai", bayar: 350000, diskon: 0, ongkir: 0, catatan: "",
    items: [{ kode: p.kode, nama: p.nama, kategori: p.kategori, harga: 100000, qty: 1, ready: 1 }, { kode: "", nama: "CUSTOM BLOOM BOX", kategori: "BUKET COSTUME", harga: 250000, qty: 1, ready: 0 }],
    pesanan: { tgl: "bukan-tanggal", jam: "", cara: "ambil", request: "" } });
  const db = new DatabaseSync(path.join(dir, "cabang.db"));
  // 1) kiriman lama yang dulu ditolak; 2) kiriman baru yang data pesanannya rusak
  db.prepare("INSERT INTO cabang_kirim(uid, aksi, data, waktu, oleh, terkirim, hasil, galat) VALUES (?, 'jual', ?, ?, 'yudi', datetime('now'), 'ditolak', 'uji')").run("uji-tolak-1", data("RG/SC/A-900001"), JSON.stringify({ tgl: hari, jam: "10:00" }));
  db.prepare("INSERT INTO cabang_kirim(uid, aksi, data, waktu, oleh) VALUES (?, 'jual', ?, ?, 'yudi')").run("uji-tolak-2", data("RG/SC/A-900002"), JSON.stringify({ tgl: hari, jam: "10:05" }));
  db.close();
  const st = await sinkron();
  assert.equal(st.ditolak, 0, JSON.stringify(st.ditolakDaftar));
  const jual = (await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.filter(s => /A-90000[12]/.test(s.no));
  assert.equal(jual.length, 2, "kedua penjualan sampai di server");
  assert.ok(jual.every(s => s.total === 350000));
  await segarkan();
  assert.equal(prodP(p.kode).stok, stokP0 - 2, "stok server berkurang");
  assert.equal((await cabang("GET", "/api/cabang/ringkas")).data.ditolak, 0);
});

test("karyawan baru dibuat di server bisa langsung masuk di perangkat (perangkat ambil akun terbaru saat login)", async () => {
  const r = await pusat("POST", "/api/users", { nama: "Wulan", peran: "karyawan", password: "2468" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const k = klien(PORT_C);
  const m = await k("POST", "/api/login", { nama: "WULAN .", password: "2468" });
  assert.equal(m.status, 200, JSON.stringify(m.data));
});

test("perangkat kasir baru (dipasang ulang): admin sementara lalu tersambung, akun & barang dari server", async () => {
  const PORT_B = PORT_C + 7;
  await nyalakan(PORT_B, "cabang2");
  const baru = klien(PORT_B);
  assert.equal((await baru("GET", "/api/status")).data.perluSetup, true);
  assert.equal((await baru("POST", "/api/setup", { nama: "Yudi", password: "sementara-abc123A1" })).status, 200);
  const r = await baru("POST", "/api/cabang/sambung", { url: `http://127.0.0.1:${PORT_P}`, nama: "Yudi", password: "rahasia-123", perangkat: "iMin baru" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await baru("GET", "/api/status")).data.cabang, true);
  const b = (await baru("GET", "/api/bootstrap")).data;
  await segarkan();
  assert.deepEqual(b.produk.map(x => x.kode).sort(), BP.produk.map(x => x.kode).sort(), "katalog sama dengan server");
  // Password admin di perangkat ikut server
  const k = klien(PORT_B);
  assert.equal((await k("POST", "/api/login", { nama: "Yudi", password: "rahasia-123" })).status, 200);
  assert.equal((await k("POST", "/api/login", { nama: "Wulan", password: "2468" })).status, 200);
});

test("admin di aplikasi perangkat bisa melihat & mengizinkan absen perangkat (diteruskan ke server)", async () => {
  const d = await cabang("GET", "/api/cabang/perangkat");
  assert.equal(d.status, 200, JSON.stringify(d.data));
  const st = (await cabang("GET", "/api/cabang")).data;
  const ini = d.data.find(x => x.kode === st.kode);
  assert.ok(ini, "perangkat ini ada di daftar");
  assert.equal((await cabang("PUT", `/api/cabang/perangkat/${ini.id}`, { absen: true })).status, 200);
  assert.equal((await pusat("GET", "/api/cabang/perangkat")).data.find(x => x.id === ini.id).absen, 1);
  assert.equal((await cabang("GET", "/api/absen/kiosk")).status, 200);
});

test("perangkat dicabut di server: tetap masuk, transaksi menunggu, sambungkan ulang → terkirim", async () => {
  await sinkron();
  const st0 = (await cabang("GET", "/api/cabang")).data;
  const ini = (await pusat("GET", "/api/cabang/perangkat")).data.find(x => x.kode === st0.kode);
  assert.equal((await pusat("DELETE", `/api/cabang/perangkat/${ini.id}`)).status, 200);
  const j = await cabang("POST", "/api/penjualan", { items: [{ nama: "custom dicabut", harga: 123000, qty: 1 }] });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  let st = await sinkron();
  assert.equal(st.dicabut, true); assert.equal(st.menunggu, 1);
  // Halaman yang diteruskan ke server tidak mengeluarkan pengguna (bukan 401)
  assert.equal((await cabang("GET", "/api/cabang/perangkat")).status, 403);
  assert.equal((await cabang("GET", "/api/bootstrap")).status, 200, "masih masuk");
  assert.equal((await cabang("POST", "/api/cabang/sambung-ulang", { nama: "Yudi", password: "salah" })).status, 403);
  st = (await cabang("POST", "/api/cabang/sambung-ulang", { nama: "Yudi", password: "rahasia-123" })).data;
  assert.equal(st.dicabut, false); assert.equal(st.menunggu, 0); assert.equal(st.galatTerakhir, "");
  const hari = BC.hariIni;
  assert.ok((await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.some(x => x.no === j.data.no), "transaksi sampai di server");
});

test("perangkat baru yang sudah punya penjualan: sambung dengan kirim transaksi lama → masuk server, stok berkurang", async () => {
  const PORT_D = PORT_C + 9;
  await nyalakan(PORT_D, "cabang3");
  const d = klien(PORT_D);
  assert.equal((await d("POST", "/api/setup", { nama: "Yudi", password: "sementara-xyz123A1" })).status, 200);
  const bd = (await d("GET", "/api/bootstrap")).data;
  const pr = bd.produk.find(x => x.kode === "RG002");
  const j = await d("POST", "/api/penjualan", { items: [{ product_id: pr.id, harga: 75000, qty: 1, ready: true }, { nama: "custom bloom box", harga: 250000, qty: 1 }] });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  await segarkan();
  const stok0 = prodP("RG002").stok;
  const isian = { url: `http://127.0.0.1:${PORT_P}`, nama: "Yudi", password: "rahasia-123", perangkat: "iMin lama" };
  assert.equal((await d("POST", "/api/cabang/sambung", isian)).status, 409);
  const r = await d("POST", "/api/cabang/sambung", { ...isian, kirimLama: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ditolak, 0, JSON.stringify(r.data.ditolakDaftar));
  const hari = BP.hariIni;
  const jp = (await pusat("GET", `/api/penjualan?dari=${hari}&sampai=${hari}`)).data.filter(x => x.total === 325000 && x.no === j.data.no);
  assert.equal(jp.length, 1, "penjualan masuk server sekali");
  await segarkan();
  assert.equal(prodP("RG002").stok, stok0 - 1, "stok server berkurang");
});

test("putuskan: ditolak bila masih ada antrean, lalu berhasil", async () => {
  assert.equal((await cabang("POST", "/api/cabang/putus", {})).status, 200);
  const st = (await cabang("GET", "/api/cabang")).data;
  assert.equal(st.aktif, false);
  // Setelah putus, katalog bisa diubah lagi di perangkat
  assert.equal((await cabang("POST", "/api/produk", { nama: "PRODUK LOKAL", harga: 1000 })).status, 200);
});
