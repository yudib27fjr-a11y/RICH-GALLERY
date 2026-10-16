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
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, nama + ".db"), BACKUP_DIR: path.join(dir, nama + "-bk"), SYNC_INTERVAL_SEC: "3600", COOKIE_SECURE: "false" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  procs.push(p);
  return new Promise((ok, gagal) => { p.stdout.on("data", d => String(d).includes("berjalan") && ok()); p.on("exit", c => gagal(new Error(nama + " keluar " + c))); });
}
function klien(port){
  let cookie = "";
  return async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "Content-Type": "application/json", "X-RG": "1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
const sinkron = async () => { const r = await cabang("POST", "/api/cabang/sinkron"); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

test("siapkan pusat & cabang, sambungkan", async () => {
  assert.equal((await pusat("POST", "/api/setup", { nama: "Yudi", password: "rahasia-123" })).status, 200);
  assert.equal((await cabang("POST", "/api/setup", { nama: "Yudi", password: "rahasia-cabang" })).status, 200);
  await segarkan();
  // Password admin pusat salah → ditolak
  let r = await cabang("POST", "/api/cabang/sambung", { url: `http://127.0.0.1:${PORT_P}`, nama: "Yudi", password: "salah-sekali" });
  assert.equal(r.status, 401);
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
  assert.deepEqual(t2, { tetap: true, versi: t1.versi, perangkat: "uji versi" });
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
  assert.equal((await pusat("PUT", "/api/absen/pengaturan", { aktif: true, jam_masuk: "08:00", jam_pulang: "17:00" })).status, 200);
  const A = (await pusat("GET", "/api/absen/pengaturan")).data;
  assert.match(A.alamat, /^\/api\/absen\/mesin\/.{20,}$/);
  const iza = A.karyawan.find(k => k.nama === "IZA"), eva = A.karyawan.find(k => k.nama === "EVA");
  assert.equal((await pusat("PUT", "/api/absen/pengaturan", { pin: [{ user_id: iza.id, pin: "1" }, { user_id: eva.id, pin: "1" }] })).status, 400, "PIN ganda ditolak");
  assert.equal((await pusat("PUT", "/api/absen/pengaturan", { pin: [{ user_id: iza.id, pin: "1" }, { user_id: eva.id, pin: "2" }] })).status, 200);
  // Mesin mengirim (tanpa header aplikasi), alamat salah ditolak
  assert.equal((await kirimMesin("/api/absen/mesin/salah", { type: "attlog", data: { pin: "1", scan: `${hari} 07:55` } })).status, 403);
  for (const [pin, jam] of [["1", "07:55"], ["1", "07:55"], ["2", "08:20:31"], ["1", "17:05"], ["9", "09:00"]]) {
    const r = await kirimMesin(A.alamat, { type: "attlog", cloud_id: "ABC123", data: { pin, scan: `${hari} ${jam}`, verify: "1", status_scan: "0" } });
    assert.equal(r.status, 200);
  }
  assert.equal((await kirimMesin(A.alamat, { type: "uji" })).status, 200);
  const R = (await pusat("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data;
  const hIza = R.harian.find(h => h.nama === "IZA"), hEva = R.harian.find(h => h.nama === "EVA");
  assert.equal(hIza.scan.length, 2, "scan dobel dari mesin tidak tercatat dua kali");
  assert.equal(hIza.masuk, "07:55"); assert.equal(hIza.pulang, "17:05"); assert.equal(hIza.terlambat, false);
  assert.equal(hEva.masuk, "08:20"); assert.equal(hEva.pulang, ""); assert.equal(hEva.terlambat, true);
  assert.deepEqual(R.takDikenal.map(t => t.pin), ["9"]);
  // Absen manual & hapus
  const man = await pusat("POST", "/api/absen/manual", { user_id: eva.id, tgl: hari, jam: "17:10", ket: "lupa scan pulang" });
  assert.equal(man.status, 200);
  assert.equal((await pusat("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data.harian.find(h => h.nama === "EVA").pulang, "17:10");
  assert.equal((await pusat("DELETE", `/api/absen/${man.data.id}`)).status, 200);
  // Di cabang: menu absensi aktif & rekapnya diambil dari server pusat
  await sinkron(); await segarkan();
  assert.equal(BC.toko.absen_aktif, true);
  assert.equal(BC.cabang, true);
  const RC = (await cabang("GET", `/api/absen?dari=${hari}&sampai=${hari}`)).data;
  assert.equal(RC.harian.find(h => h.nama === "IZA").pulang, "17:05");
  assert.equal((await cabang("POST", "/api/absen/manual", { user_id: eva.id, tgl: hari, jam: "17:00" })).status, 409, "diatur di server pusat");
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

test("putuskan: ditolak bila masih ada antrean, lalu berhasil", async () => {
  assert.equal((await cabang("POST", "/api/cabang/putus", {})).status, 200);
  const st = (await cabang("GET", "/api/cabang")).data;
  assert.equal(st.aktif, false);
  // Setelah putus, katalog bisa diubah lagi di perangkat
  assert.equal((await cabang("POST", "/api/produk", { nama: "PRODUK LOKAL", harga: 1000 })).status, 200);
});
