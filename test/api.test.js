// Tes ujung-ke-ujung: menjalankan server sungguhan dengan database sementara.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "rg-test-"));
const PORT = 4000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.js"], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, "t.db"), BACKUP_DIR: path.join(dir, "bk"), SYNC_INTERVAL_SEC: "3600" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((ok, gagal) => { proc.stdout.on("data", d => String(d).includes("berjalan") && ok()); proc.on("exit", c => gagal(new Error("server keluar " + c))); });
});
after(() => { proc.kill(); rmSync(dir, { recursive: true, force: true }); });

/* Nama & HP pelanggan wajib saat checkout; tes yang tidak menyebutkannya memakai pelanggan contoh. */
function isiPelanggan(method, url, body){
  return method === "POST" && url === "/api/penjualan" && body ? { pelanggan: "Uji", hp: "081200000000", ...body } : body;
}
function klien(){
  let cookie = "";
  return async (method, url, body, { header = true } = {}) => {
    const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", ...(header ? { "X-RG": "1" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(isiPelanggan(method, url, body)) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const tipe = r.headers.get("content-type") || "";
    return { status: r.status, data: tipe.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}
const admin = klien(), kasir = klien(), tamu = klien();
let B; // bootstrap admin

test("setup admin pertama, lalu tidak bisa diulang", async () => {
  assert.equal((await tamu("GET", "/api/status")).data.perluSetup, true);
  assert.equal((await admin("POST", "/api/setup", { nama: "Yudi Admin", password: "pendek" })).status, 400);
  assert.equal((await admin("POST", "/api/setup", { nama: "Yudi Admin", password: "rahasia-123" })).status, 200);
  assert.equal((await tamu("POST", "/api/setup", { nama: "Penyusup", password: "rahasia-123" })).status, 409);
  B = (await admin("GET", "/api/bootstrap")).data;
  assert.equal(B.me.peran, "admin");
  assert.ok(B.produk.length > 400 && B.bahan.length > 150);
  assert.ok(B.staf.some(s => s.nama === "IZA"));
});

test("tanpa header aplikasi ditolak (perlindungan CSRF), tanpa login ditolak", async () => {
  assert.equal((await admin("POST", "/api/produk", { nama: "X", harga: 1 }, { header: false })).status, 403);
  assert.equal((await tamu("GET", "/api/bootstrap")).status, 401);
});

test("karyawan: beri PIN, login, akses dibatasi", async () => {
  const iza = B.staf.find(s => s.nama === "IZA");
  assert.equal((await admin("PUT", `/api/users/${iza.id}`, { password: "1234" })).status, 200);
  assert.equal((await kasir("POST", "/api/login", { nama: "iza", password: "salah" })).status, 401);
  assert.equal((await kasir("POST", "/api/login", { nama: "iza", password: "1234" })).status, 200);
  assert.equal((await kasir("POST", "/api/login", { nama: "  ízá ", password: "1234" })).status, 200, "aksen & spasi dari keyboard HP diabaikan");
  const kb = (await kasir("GET", "/api/bootstrap")).data;
  assert.equal(kb.me.peran, "karyawan");
  assert.equal(kb.produk[0].hpp, undefined, "karyawan tidak boleh melihat HPP");
  for (const u of ["/api/laporan?dari=2026-01-01&sampai=2026-12-31", "/api/pengaturan", "/api/users", "/api/cadangan"]) assert.equal((await kasir("GET", u)).status, 403, u);
  assert.equal((await kasir("POST", "/api/produk", { nama: "X", harga: 1 })).status, 403);
});

test("produk baru: kode & barcode otomatis, barcode ganda ditolak", async () => {
  const r = await admin("POST", "/api/produk", { nama: "buket tes", harga: 90000 });
  assert.equal(r.status, 200);
  assert.match(r.data.kode, /^RG\d{3}$/);
  assert.match(r.data.barcode, /^201\d{10}$/);
  assert.equal(r.data.hpp, 40500);
  const dup = await admin("POST", "/api/bahan", { nama: "BAHAN TES", barcode: r.data.barcode });
  assert.equal(dup.status, 400);
  const pabrik = await admin("POST", "/api/produk", { nama: "COKLAT", harga: 25000, barcode: "8992753000005", stok: 10 });
  assert.equal(pabrik.data.barcode, "8992753000005");
  assert.equal(pabrik.data.stok, 10);
});

let saleId, noPertama;
test("penjualan: total dihitung server, stok ready berkurang, nomor invoice berurutan", async () => {
  const p = B.produk.find(x => x.kode === "RG003");
  const r = await kasir("POST", "/api/penjualan", {
    tgl: "2020-01-01", pelanggan: "bu rina", hp: "081230000000", metode: "Tunai", bayar: 400000, diskon: 5000, ongkir: 10000,
    items: [{ product_id: p.id, harga: 100000, qty: 2, ready: true }, { nama: "buket custom pink", harga: 125000, qty: 1 }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.subtotal, 325000);
  assert.equal(r.data.total, 330000);
  assert.equal(r.data.pelanggan, "BU RINA");
  assert.notEqual(r.data.tgl, "2020-01-01", "karyawan tidak boleh memundurkan tanggal");
  assert.equal(r.data.no, "RG/SC/000001180");
  saleId = r.data.id; noPertama = r.data.no;
  const b2 = (await admin("GET", "/api/bootstrap")).data;
  assert.equal(b2.produk.find(x => x.kode === "RG003").stok, p.stok - 2);
  const r2 = await kasir("POST", "/api/penjualan", { items: [{ nama: "x", harga: 1000, qty: 1 }] });
  assert.equal(r2.data.no, "RG/SC/000001181");
  assert.equal((await kasir("POST", "/api/penjualan", { items: [] })).status, 400);
  assert.equal((await kasir("POST", "/api/penjualan", { items: [{ nama: "x", harga: -5, qty: 1 }] })).status, 400);
});

test("pembatalan hanya admin, stok kembali, tidak bisa dua kali", async () => {
  assert.equal((await kasir("POST", `/api/penjualan/${saleId}/batal`, {})).status, 403);
  const sebelum = (await admin("GET", "/api/bootstrap")).data.produk.find(x => x.kode === "RG003").stok;
  assert.equal((await admin("POST", `/api/penjualan/${saleId}/batal`, { alasan: "salah input" })).status, 200);
  assert.equal((await admin("POST", `/api/penjualan/${saleId}/batal`, {})).status, 400);
  const sesudah = (await admin("GET", "/api/bootstrap")).data.produk.find(x => x.kode === "RG003").stok;
  assert.equal(sesudah, sebelum + 2);
});

test("barang masuk/keluar dan opname tercatat di buku stok", async () => {
  const m = B.bahan.find(x => x.kode === "RG035");
  assert.equal((await kasir("POST", "/api/mutasi", { tipe: "masuk", jenis: "bahan", items: [{ id: m.id, qty: 48 }], ket: "supplier" })).status, 200);
  assert.equal((await kasir("POST", "/api/mutasi", { tipe: "keluar", jenis: "bahan", items: [{ id: m.id, qty: 8 }] })).status, 200);
  assert.equal((await kasir("POST", "/api/mutasi", { tipe: "keluar", jenis: "bahan", items: [{ id: m.id, qty: 0 }] })).status, 400);
  let st = (await admin("GET", "/api/bootstrap")).data.bahan.find(x => x.id === m.id).stok;
  assert.equal(st, m.stok + 40);
  assert.equal((await kasir("POST", "/api/opname", { jenis: "bahan", items: [{ id: m.id, fisik: 12 }] })).status, 200);
  st = (await admin("GET", "/api/bootstrap")).data.bahan.find(x => x.id === m.id).stok;
  assert.equal(st, 12);
  const riw = (await admin("GET", `/api/riwayat-stok?tipe=masuk,keluar,opname&item_id=${m.id}&jenis=bahan`)).data;
  assert.deepEqual(riw.map(r => r.tipe), ["opname", "keluar", "masuk"]);
  assert.equal(riw[0].stok_sebelum, m.stok + 40);
});

test("produksi & insentif: rekap, karyawan hanya lihat miliknya, bayar mengunci periode", async () => {
  const iza = B.staf.find(s => s.nama === "IZA"), eva = B.staf.find(s => s.nama === "EVA");
  const p = B.produk.find(x => x.kode === "RG001"), stok0 = (await admin("GET", "/api/bootstrap")).data.produk.find(x => x.id === p.id).stok;
  assert.equal((await kasir("POST", "/api/produksi", { pembuat_id: iza.id, restock: true, items: [{ product_id: p.id, qty: 3 }] })).status, 200);
  assert.equal((await admin("POST", "/api/produksi", { pembuat_id: eva.id, restock: false, items: [{ product_id: p.id, qty: 4 }] })).status, 200);
  assert.equal((await kasir("POST", "/api/produksi", { tgl: "2020-01-01", pembuat_id: iza.id, items: [{ product_id: p.id, qty: 1 }] })).status, 400);
  assert.equal((await admin("GET", "/api/bootstrap")).data.produk.find(x => x.id === p.id).stok, stok0 + 3);
  const rek = (await admin("GET", "/api/insentif")).data;
  assert.equal(rek.rows.find(r => r.nama === "IZA").insentif, 7500);
  assert.equal(rek.rows.find(r => r.nama === "EVA").insentif, 10000);
  assert.equal((await kasir("GET", "/api/insentif")).status, 403, "rekap insentif (bagian gaji) hanya admin");
  assert.equal((await kasir("POST", "/api/insentif/bayar", { pembuat_id: iza.id, periode_dari: rek.dari })).status, 403);
  assert.equal((await admin("POST", "/api/insentif/bayar", { pembuat_id: iza.id, periode_dari: rek.dari, catat_pengeluaran: true })).status, 200);
  assert.equal((await admin("POST", "/api/insentif/bayar", { pembuat_id: iza.id, periode_dari: rek.dari })).status, 400);
  assert.equal((await kasir("POST", "/api/produksi", { pembuat_id: iza.id, items: [{ product_id: p.id, qty: 1 }] })).status, 400);
  const daftarProd = (await admin("GET", `/api/produksi?dari=${rek.dari}&sampai=${rek.sampai}`)).data;
  const milikIza = daftarProd.find(r => r.pembuat === "IZA");
  assert.equal((await admin("DELETE", `/api/produksi/${milikIza.id}`)).status, 400);
  const peng = (await admin("GET", `/api/pengeluaran?dari=${rek.dari}&sampai=${rek.sampai}`)).data;
  assert.equal(peng[0].kategori, "Insentif Produksi");
  assert.equal(peng[0].nominal, 7500);
});

test("laporan: omzet tanpa transaksi batal, laba dikurangi HPP & pengeluaran", async () => {
  const today = B.hariIni;
  assert.equal((await admin("POST", "/api/pengeluaran", { tgl: today, kategori: "Operasional", ket: "listrik", nominal: 20000 })).status, 200);
  const L = (await admin("GET", `/api/laporan?dari=${today}&sampai=${today}`)).data;
  // Hari ini ada 2 transaksi: 1180 (dibatalkan) dan 1181 (Rp1.000). Hanya 1181 yang dihitung.
  assert.equal(L.transaksi, 1, "transaksi yang dibatalkan tidak dihitung");
  assert.equal(L.omzet, 1000);
  assert.equal(L.hpp, 450);
  assert.equal(L.biaya, 27500);
  assert.equal(L.labaBersih, L.labaKotor - 27500);
  assert.equal(L.grafik.length, 1);
});

test("antrean sinkron sheet terisi, cadangan berupa file SQLite", async () => {
  const s = (await admin("GET", "/api/sync")).data;
  assert.ok(s.menunggu > 5);
  const c = await admin("GET", "/api/cadangan");
  assert.equal(c.status, 200);
  assert.equal(c.data.subarray(0, 15).toString(), "SQLite format 3");
});

test("pengaturan: nomor invoice yang sudah dipakai ditolak", async () => {
  assert.equal((await admin("PUT", "/api/pengaturan", { no_berikutnya: 1180 })).status, 400);
  assert.equal((await admin("PUT", "/api/pengaturan", { sync_url: "https://contoh.com/x" })).status, 400);
  assert.equal((await admin("PUT", "/api/pengaturan", { insentif: 3000 })).status, 200);
});

test("impor cadangan aplikasi versi lama", async () => {
  const lama = {
    v: 2, settings: { nama: "RICH GALLERY", nextNo: 1300, insentif: 2500, periodeMulai: 15 }, staff: ["Admin", "IZA", "RINA"],
    produk: [{ c: "RG003", n: "BUKET BUNGA 100K", k: "BUKET BUNGA", p: 100000, h: 45000, s: 7, min: 1, on: true, bc: "2010000000038" }, { c: "RG900", n: "PRODUK DARI LAMA", k: "BUKET BUNGA", p: 50000, h: 22500, s: 2, min: 1, on: true }],
    bahan: [], sales: [{ id: "abc1", no: "RG/SC/000001250", tgl: "2026-10-01", jam: "10:00", kasir: "Admin", cust: "LAMA", hp: "", items: [{ c: "RG003", n: "BUKET BUNGA 100K", k: "BUKET BUNGA", p: 100000, h: 45000, q: 1, ready: true }], disc: 0, ongkir: 0, total: 100000, metode: "Tunai", bayar: 100000, note: "" }],
    masuk: [{ id: "m1", tgl: "2026-10-01", jenis: "bahan", c: "RG035", n: "BUNGA MAWAR MERAH", q: 10, ket: "", kasir: "Admin" }], keluar: [], opname: [],
    expenses: [{ id: "e1", tgl: "2026-10-01", k: "Operasional", d: "lama", nom: 5000, kasir: "Admin" }],
    produksi: [{ id: "p1", tgl: "2026-10-01", c: "RG001", n: "BUKET BUNGA 50K", q: 2, oleh: "RINA", tarif: 2500, stok: true, kasir: "Admin" }], bayarIns: [],
  };
  const r = await admin("POST", "/api/impor-lama", lama);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.penjualan, 1);
  assert.equal(r.data.karyawan, 1);
  const r2 = await admin("POST", "/api/impor-lama", lama);
  assert.equal(r2.data.penjualan, 0, "impor ulang tidak menggandakan data");
  assert.equal(r2.data.pengeluaran, 0);
  const s = await kasir("POST", "/api/penjualan", { items: [{ nama: "x", harga: 1000, qty: 1 }] });
  assert.equal(s.data.no, "RG/SC/000001300");
});

test("data pelanggan dari riwayat transaksi & pesan WhatsApp", async () => {
  B = (await admin("GET", "/api/bootstrap")).data;
  const p = B.produk[0];
  for (const [pelanggan, hp] of [["bu sinta", "0812-3456-7890"], ["Bu Sinta", "+62 812 3456 7890"], ["pak budi", "0857 1111 2222"]]) {
    assert.equal((await admin("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: 10000, qty: 1 }], pelanggan, hp })).status, 200);
  }
  // Nama & nomor HP pelanggan wajib diisi saat checkout
  for (const [pelanggan, hp] of [["", "081234567890"], ["pak joko", ""], ["pak joko", "12345"], ["customer", "081234567890"]]) {
    assert.equal((await admin("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: 10000, qty: 1 }], pelanggan, hp })).status, 400, `${pelanggan}/${hp} ditolak`);
  }
  const semua = (await admin("GET", "/api/pelanggan?semua=1")).data;
  const sinta = semua.find(x => x.nama === "BU SINTA");
  assert.equal(sinta.transaksi, 2, "nomor HP sama (0812… dan +62812…) = satu pelanggan");
  assert.equal(sinta.total, 20000);
  assert.ok(semua.find(x => x.nama === "PAK BUDI"));
  assert.ok(!semua.find(x => x.nama === "CUSTOMER"), "pelanggan umum tidak masuk daftar");
  assert.equal((await admin("GET", "/api/pelanggan?q=3456")).data[0].nama, "BU SINTA", "cari dengan no HP");
  assert.equal((await kasir("GET", "/api/pelanggan?q=sinta")).data[0].total, undefined, "karyawan tidak melihat total belanja");
  const s0 = (await admin("GET", "/api/pengaturan")).data;
  assert.equal((await admin("PUT", "/api/pengaturan", { wa_otomatis: true, wa_template: "Halo {nama}, makasih! {no}", no_berikutnya: s0.no_berikutnya + 100 })).status, 200);
  // Simpan sambungan saja (tanpa nomor invoice) & link Canva
  assert.equal((await admin("PUT", "/api/pengaturan", { canva_url: "https://example.com/x" })).status, 400);
  assert.equal((await admin("PUT", "/api/pengaturan", { canva_url: "https://www.canva.com/design/ABC/edit" })).status, 200);
  assert.equal((await admin("PUT", "/api/pengaturan", { wa_nomor: "12" })).status, 400);
  assert.equal((await admin("PUT", "/api/pengaturan", { wa_nomor: "0812-9999-1111", canva_email: "toko@gmail.com" })).status, 200);
  assert.equal((await admin("PUT", "/api/pengaturan", { canva_email: "bukan email" })).status, 400);
  assert.equal((await admin("PUT", "/api/pengaturan", { inv_ttd: "bukan gambar" })).status, 400);
  assert.equal((await admin("PUT", "/api/pengaturan", { kartu_lebar: 10 })).status, 400, "kartu terlalu kecil");
  assert.equal((await admin("PUT", "/api/pengaturan", { kartu_lebar: 148, kartu_tinggi: 105, kartu_area: "bawah", kartu_latar: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" })).status, 200);
  assert.equal((await admin("GET", "/api/kartu/latar")).data.latar, "data:image/jpeg;base64,/9j/4AAQSkZJRg==");
  assert.equal((await admin("GET", "/api/pengaturan")).data.kartu_latar, undefined, "latar tidak ikut data pengaturan biasa");
  assert.equal((await admin("PUT", "/api/pengaturan", { inv_ttd: "data:image/png;base64,iVBORw0KGgo=", inv_ttd_nama: "Siti Nur Khodijah", inv_bank: "Bank BRI 421201022815539" })).status, 200);
  // Kartu ucapan tersimpan di transaksi
  const k = await admin("POST", "/api/penjualan", { items: [{ product_id: p.id, harga: 10000, qty: 1 }], kartu: "Happy Birthday!\nDari: Rina" });
  assert.equal(k.data.kartu, "Happy Birthday!\nDari: Rina");
  const b = (await admin("GET", "/api/bootstrap")).data;
  assert.equal(b.toko.canva_url, "https://www.canva.com/design/ABC/edit");
  assert.equal(b.toko.kartu_huruf, "grown", "kartu memakai huruf Grown");
  assert.equal(b.toko.kartu_lebar, 148); assert.ok(b.toko.kartu_latar_kode); assert.equal(b.toko.kartu_latar, undefined);
  assert.equal(b.toko.inv_ttd_nama, "Siti Nur Khodijah"); assert.match(b.toko.inv_ttd, /^data:image\/png/);
  assert.equal(b.toko.wa_nomor, "0812-9999-1111"); assert.equal(b.toko.canva_email, "toko@gmail.com");
  assert.equal(b.toko.wa_otomatis, true); assert.equal(b.toko.wa_template, "Halo {nama}, makasih! {no}");
});

test("batas percobaan login", async () => {
  const k = klien();
  for (let i = 0; i < 5; i++) await k("POST", "/api/login", { nama: "eva", password: "salah" });
  assert.equal((await k("POST", "/api/login", { nama: "eva", password: "salah" })).status, 429);
});

test("gaji: ubah produksi (stok ikut), kasbon, gaji kotor/bersih, pengeluaran otomatis, batal", async () => {
  const boot = (await admin("GET", "/api/bootstrap")).data;
  const rina = boot.staf.find(s => s.nama === "RINA");
  const pA = boot.produk.find(x => x.kode === "RG003"), pB = boot.produk.find(x => x.kode === "RG900");
  const stok = async kode => (await admin("GET", "/api/bootstrap")).data.produk.find(x => x.kode === kode).stok;
  const a0 = await stok("RG003"), b0 = await stok("RG900");
  assert.equal((await tamu("GET", "/api/gaji")).status, 401);
  assert.equal((await admin("GET", "/api/jam-kerja")).data.lembur_per_jam, 4300, "lembur Rp4.300/jam");
  // Produksi salah input → diubah: jumlah & produk, stok ready mengikuti
  assert.equal((await admin("POST", "/api/produksi", { pembuat_id: rina.id, restock: true, items: [{ product_id: pA.id, qty: 2 }] })).status, 200);
  const hari = boot.hariIni;
  const cat = (await admin("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.find(x => x.kode === "RG003" && x.pembuat === "RINA");
  assert.equal(await stok("RG003"), a0 + 2);
  assert.equal((await admin("PUT", `/api/produksi/${cat.id}`, { qty: 5 })).status, 200);
  assert.equal(await stok("RG003"), a0 + 5);
  assert.equal((await admin("PUT", `/api/produksi/${cat.id}`, { product_id: pB.id, qty: 4 })).status, 200);
  assert.equal(await stok("RG003"), a0); assert.equal(await stok("RG900"), b0 + 4);
  const cat2 = (await admin("GET", `/api/produksi?dari=${hari}&sampai=${hari}`)).data.find(x => x.id === cat.id);
  assert.equal(cat2.kode, "RG900"); assert.equal(cat2.qty, 4);
  // Gaji pokok & kasbon
  assert.equal((await admin("PUT", "/api/gaji/pokok", { pokok: [{ user_id: rina.id, gaji_pokok: 1500000 }] })).status, 200);
  assert.equal((await admin("POST", "/api/kasbon", { user_id: rina.id, jenis: "pinjam", nominal: 300000 })).status, 400, "keterangan wajib");
  assert.equal((await admin("POST", "/api/kasbon", { user_id: rina.id, jenis: "pinjam", nominal: 300000, ket: "keperluan keluarga", metode: "Tunai" })).status, 200);
  assert.equal((await admin("POST", "/api/kasbon", { user_id: rina.id, jenis: "bayar", nominal: 999999, ket: "x" })).status, 400);
  assert.equal((await admin("POST", "/api/kasbon", { user_id: rina.id, jenis: "bayar", nominal: 50000, ket: "cicilan 1" })).data.sisa, 250000);
  let G = (await admin("GET", `/api/gaji?tgl=${hari}`)).data;
  let r = G.rows.find(x => x.nama === "RINA");
  assert.equal(r.pokok, 1500000); assert.equal(r.hutang, 250000); assert.equal(r.ins_produksi, 4 * cat2.tarif);
  assert.equal(r.kotor, r.pokok + r.ins_produksi + r.ins_lain + r.lembur);
  // Bayar: bonus wajib berketerangan, potong kasbon, transfer
  const bayar = b => admin("POST", "/api/gaji/bayar", { user_id: rina.id, periode_dari: G.dari, metode: "Transfer", bonus: 50000, bonus_ket: "bonus target", potong_hutang: 100000, ...b });
  assert.equal((await bayar({ bonus_ket: "" })).status, 400);
  assert.equal((await bayar({ potong_hutang: 300000 })).status, 400, "potongan melebihi hutang");
  assert.equal((await bayar({ metode: "Cek" })).status, 400);
  const g = await bayar({});
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.kotor, r.kotor + 50000); assert.equal(g.data.bersih, r.kotor + 50000 - 100000);
  assert.equal((await bayar({})).status, 400, "tidak bisa dibayar dua kali");
  G = (await admin("GET", `/api/gaji?tgl=${hari}`)).data; r = G.rows.find(x => x.nama === "RINA");
  assert.equal(r.bayar.metode, "Transfer"); assert.equal(r.hutang, 150000); assert.equal(r.bersih, g.data.bersih);
  const peng = (await admin("GET", `/api/pengeluaran?dari=${hari}&sampai=${hari}`)).data;
  const pg = peng.find(e => e.kategori === "Gaji Karyawan"), pk = peng.find(e => e.kategori === "Kasbon Karyawan");
  assert.equal(pg.nominal, g.data.bersih); assert.equal(pg.sumber, "gaji"); assert.match(pg.ket, /Gaji RINA .*Transfer.*pokok Rp1\.500\.000.*bonus Rp50\.000.*kasbon Rp100\.000/);
  assert.equal(pk.nominal, 300000); assert.match(pk.ket, /Kasbon RINA: keperluan keluarga \(Tunai\)/);
  assert.equal((await admin("DELETE", `/api/pengeluaran/${pg.id}`)).status, 400, "dihapus lewat menu Gaji");
  assert.equal((await admin("PUT", `/api/produksi/${cat.id}`, { qty: 1 })).status, 400, "periode sudah digaji → produksi terkunci");
  // Batal: pengeluaran & potongan kasbon kembali, periode terbuka lagi
  assert.equal((await admin("DELETE", `/api/gaji/${r.bayar.id}`)).status, 200);
  G = (await admin("GET", `/api/gaji?tgl=${hari}`)).data; r = G.rows.find(x => x.nama === "RINA");
  assert.equal(r.bayar, null); assert.equal(r.hutang, 250000);
  assert.ok(!(await admin("GET", `/api/pengeluaran?dari=${hari}&sampai=${hari}`)).data.some(e => e.kategori === "Gaji Karyawan"));
  assert.equal((await admin("PUT", `/api/produksi/${cat.id}`, { qty: 3 })).status, 200);
  assert.equal(await stok("RG900"), b0 + 3);
  assert.equal((await admin("POST", "/api/pengeluaran", { tgl: hari, kategori: "Operasional", nominal: 1000 })).status, 400, "keterangan pengeluaran wajib");
  // Baris sheet gaji & kasbon ikut terkirim (jumlah kolom dicek di tes berikutnya)
  assert.equal((await admin("POST", "/api/gaji/bayar", { user_id: rina.id, periode_dari: G.dari, metode: "Tunai" })).status, 200);
});

test("sinkron: antrean terkirim ke Apps Script (lewat redirect 302) dengan jumlah kolom sesuai tab sheet", async () => {
  const { createServer } = await import("node:http");
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  // Jumlah kolom per tab diambil langsung dari skrip Apps Script yang dipasang di sheet.
  const gs = readFileSync(new URL("../deploy/sinkron-sheet-apps-script.gs", import.meta.url), "utf8");
  const kolom = {}; for (const m of gs.matchAll(/^\s*(\w+):\s*\[(.*?)\],?$/gm)) kolom[m[1]] = m[2].split("','").length;
  let diterima = [];
  const mock = createServer((req, res) => {
    if (req.method === "POST") { let b = ""; req.on("data", c => b += c); req.on("end", () => { diterima.push(...JSON.parse(b).items); res.writeHead(302, { Location: "/echo" }); res.end(); }); }
    else { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); }
  });
  await new Promise(r => mock.listen(0, "127.0.0.1", r));
  const db = new DatabaseSync(path.join(dir, "t.db"));
  db.prepare("INSERT INTO settings(kunci, nilai) VALUES ('sync_url', ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai").run(JSON.stringify(`http://127.0.0.1:${mock.address().port}/exec`));
  db.close();
  const r = await admin("POST", "/api/sync/kirim");
  mock.close();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.menunggu, 0);
  assert.ok(diterima.length > 10);
  const tipe = new Set(diterima.map(i => i.type));
  for (const t of ["penjualan", "batal", "masuk", "keluar", "opname", "produksi", "insentif", "pengeluaran", "gaji", "kasbon"]) assert.ok(tipe.has(t), "tidak ada baris " + t);
  for (const i of diterima) assert.equal(i.row.length, kolom[i.type], `kolom ${i.type}: kirim ${i.row.length}, sheet ${kolom[i.type]}`);
});

test("pulihkan: seluruh database diganti dengan file cadangan (jalur pindah HP → server)", async () => {
  const cad = await admin("GET", "/api/cadangan");
  const b64 = cad.data.toString("base64");
  const p = await admin("POST", "/api/produk", { nama: "DIBUAT SETELAH CADANGAN", harga: 1000 });
  assert.equal(p.status, 200);
  assert.equal((await admin("POST", "/api/pulihkan", { data: b64 })).status, 400, "wajib konfirmasi");
  assert.equal((await admin("POST", "/api/pulihkan", { data: Buffer.from("bukan database ".repeat(20)).toString("base64"), konfirmasi: "GANTI SEMUA DATA" })).status, 400);
  assert.equal((await kasir("POST", "/api/pulihkan", { data: b64, konfirmasi: "GANTI SEMUA DATA" })).status, 403);
  const r = await admin("POST", "/api/pulihkan", { data: b64, konfirmasi: "GANTI SEMUA DATA" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const b = (await admin("GET", "/api/bootstrap")).data;
  assert.ok(!b.produk.some(x => x.nama === "DIBUAT SETELAH CADANGAN"), "data setelah cadangan hilang");
  assert.ok(b.produk.some(x => x.nama === "PRODUK DARI LAMA"), "data sebelum cadangan tetap ada");
  const s = await kasir("POST", "/api/penjualan", { items: [{ nama: "x", harga: 1000, qty: 1 }] });
  assert.equal(s.status, 200, "server tetap berjalan normal setelah pulihkan");
});

test("ubah stok manual & hard reset dengan kode (bawaan OK, bisa diganti)", async () => {
  let b = (await admin("GET", "/api/bootstrap")).data;
  const [p1, p2] = b.produk;
  assert.equal((await admin("POST", "/api/opname", { jenis: "produk", ket: "Ubah stok manual", items: [{ id: p1.id, fisik: 12 }, { id: p2.id, fisik: 0 }] })).status, 200);
  b = (await admin("GET", "/api/bootstrap")).data;
  assert.equal(b.produk.find(x => x.id === p1.id).stok, 12); assert.equal(b.produk.find(x => x.id === p2.id).stok, 0);
  // Hard reset: hanya admin, kode wajib benar
  assert.equal((await kasir("POST", "/api/reset", { kode: "OK", transaksi: true })).status, 403);
  assert.equal((await admin("POST", "/api/reset", { kode: "salah", transaksi: true })).status, 401);
  assert.equal((await admin("GET", "/api/reset")).data.kodeBawaan, true);
  assert.equal((await admin("PUT", "/api/reset/kode", { lama: "x", baru: "rahasia7" })).status, 401);
  assert.equal((await admin("PUT", "/api/reset/kode", { lama: "OK", baru: "rahasia7" })).status, 200);
  assert.equal((await admin("POST", "/api/reset", { kode: "OK", transaksi: true })).status, 401, "kode lama tidak berlaku");
  const r = await admin("POST", "/api/reset", { kode: "rahasia7", transaksi: true, stok: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const hari = (await admin("GET", "/api/bootstrap")).data.hariIni;
  assert.equal((await admin("GET", `/api/penjualan?dari=2000-01-01&sampai=${hari}`)).data.length, 0, "transaksi kosong");
  b = (await admin("GET", "/api/bootstrap")).data;
  assert.ok(b.produk.length > 0 && b.produk.every(x => x.stok === 0), "barang tetap, stok 0");
  assert.ok(b.staf.length > 0, "akun tetap ada");
  assert.equal((await admin("POST", "/api/reset", { kode: "rahasia7", katalog: true })).status, 200);
  assert.equal((await admin("GET", "/api/bootstrap")).data.produk.length, 0, "katalog kosong");
});
