import { route } from "../router.js";
import { one, all, run, tx, getSettings, setSetting } from "../db.js";
import { HttpError, bad, notFound, teks, angka, tanggal, pilihan, daftar, sekarang } from "../util.js";
import { ambilItem, ubahStok, antre } from "../stok.js";
import { cabangAktif } from "../cabang-perangkat.js";
import { antreNotifPenjualan } from "../notif.js";
import { KATEGORI, METODE, tebakKategori, periodeDari } from "../../../public/shared.js";

/** Pembuat barang (karyawan aktif): dari id (perangkat ini) atau nama (kiriman perangkat lain). */
function cariPembuat(x){
  if (x.pembuat_id) return one("SELECT id, nama FROM users WHERE id = ? AND aktif = 1", [+x.pembuat_id]);
  if (x.pembuat) return one("SELECT id, nama FROM users WHERE nama_key = ? AND aktif = 1", [String(x.pembuat).trim().toLowerCase()]);
  return null;
}
/** Hapus catatan produksi otomatis dari transaksi ini (dibatalkan / dihapus). */
const hapusProduksiJual = no => run("DELETE FROM produksi WHERE uid LIKE ?", [`jual:${no}:%`]);

function muatPenjualan(where, params, limit = 500){
  const sales = all(`SELECT * FROM sales WHERE ${where} ORDER BY id DESC LIMIT ${limit}`, params);
  if (!sales.length) return [];
  const items = all(`SELECT * FROM sale_items WHERE sale_id IN (${sales.map(s => s.id).join(",")}) ORDER BY id`);
  const per = new Map(sales.map(s => [s.id, (s.items = [], s)]));
  for (const it of items) per.get(it.sale_id).items.push(it);
  return sales;
}
const sembunyikanHpp = (s, user) => { if (user.peran !== "admin") s.items.forEach(i => delete i.hpp); return s; };

/** Simpan transaksi. Total dihitung ulang di server; stok produk READY dikurangi dalam satu transaksi. */
/* Nomor nota: server memakai prefix + 9 digit. Perangkat cabang memakai seri sendiri (prefix + kode perangkat + 6 digit),
   supaya nota dari beberapa perangkat tidak pernah bentrok di server pusat. */
function nomorBerikutnya(s){
  const kode = cabangAktif() ? s.cabang_kode : "";
  for (let n = s.no_berikutnya; ; n++) {
    const no = s.prefix + (kode ? `${kode}-${String(n).padStart(6, "0")}` : String(n).padStart(9, "0"));
    if (!one("SELECT 1 x FROM sales WHERE no = ?", [no])) { setSetting("no_berikutnya", n + 1); return no; }
  }
}
/** Nomor dari perangkat cabang dipakai apa adanya; bila kebetulan sudah ada, diberi akhiran. */
function nomorKiriman(no){
  if (!one("SELECT 1 x FROM sales WHERE no = ?", [no])) return no;
  for (let i = 2; ; i++) if (!one("SELECT 1 x FROM sales WHERE no = ?", [`${no}-${i}`])) return `${no}-${i}`;
}

/** Nomor HP Indonesia: 9–15 digit, boleh diawali +62 / 62 / 0, boleh pakai spasi atau strip. */
export const hpValid = hp => /^\+?[\d\s-]+$/.test(String(hp || "").trim()) && (n => n >= 9 && n <= 15)(String(hp).replace(/\D/g, "").length);

route("POST", "/api/penjualan", "semua", ({ body, user, ctx }) => tx(() => {
  const s = getSettings(), now = sekarang(), kiriman = ctx && ctx.replay;
  const tgl = kiriman ? tanggal(kiriman.tgl) : user.peran === "admin" && body.tgl ? tanggal(body.tgl) : now.tgl;
  const items = daftar(body.items, { nama: "Keranjang", max: 200 }).map((x, i) => {
    const qty = angka(x.qty, { min: 0.01, max: 100000, wajib: true, nama: `Jumlah baris ${i + 1}` });
    const harga = angka(x.harga, { min: 0, max: 1e10, wajib: true, bulat: true, nama: `Harga baris ${i + 1}` });
    if (x.product_id) {
      const p = ambilItem("produk", +x.product_id);
      return { p, product_id: p.id, kode: p.kode, nama: p.nama, kategori: p.kategori, harga, qty, hpp: p.hpp, ready: x.ready ? 1 : 0, pembuat: x.ready ? null : cariPembuat(x) };
    }
    const nama = teks(x.nama, { wajib: true, max: 120, upper: true, nama: `Nama barang baris ${i + 1}` });
    const kategori = x.kategori && KATEGORI.includes(x.kategori) ? x.kategori : tebakKategori(nama);
    return { p: null, product_id: null, kode: "", nama, kategori, harga, qty, hpp: Math.round(harga * s.hpp_persen / 100), ready: 0, pembuat: cariPembuat(x) };
  });
  const subtotal = Math.round(items.reduce((a, i) => a + i.harga * i.qty, 0));
  const diskon = angka(body.diskon, { min: 0, max: subtotal, bulat: true, nama: "Diskon" }) ?? 0;
  const ongkir = angka(body.ongkir, { min: 0, max: 1e9, bulat: true, nama: "Ongkir" }) ?? 0;
  const total = Math.max(0, subtotal - diskon + ongkir);
  const metode = pilihan(body.metode || "Tunai", METODE, "Metode bayar");
  const bayar = angka(body.bayar, { min: 0, max: 1e11, bulat: true, nama: "Dibayar" }) ?? total;
  const pelanggan = teks(body.pelanggan, { max: 80, upper: true, nama: "Pelanggan" }) || "CUSTOMER";
  const hp = teks(body.hp, { max: 30, nama: "No HP" });
  // Nama pelanggan & no HP wajib (kecuali transaksi lama yang dikirim ulang dari perangkat cabang).
  if (!ctx?.replay) {
    if (!String(body.pelanggan || "").trim() || pelanggan === "CUSTOMER") throw bad("Isi nama pelanggan dulu");
    if (!hpValid(hp)) throw bad("Isi nomor HP pelanggan yang benar (contoh 0812xxxxxxx)");
  }
  const catatan = teks(body.catatan, { max: 500, nama: "Catatan" });
  const kartu = teks(body.kartu, { max: 1000, nama: "Kartu ucapan" }) || null;
  // Pesanan: diambil / diantar nanti, dengan catatan khusus (request)
  const ps = body.pesanan && typeof body.pesanan === "object" && body.pesanan.tgl ? body.pesanan : null;
  const pesanan = ps ? {
    tgl: tanggal(ps.tgl, { nama: "Tanggal ambil" }),
    jam: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(ps.jam || "")) ? ps.jam : "",
    cara: ps.cara === "antar" ? "antar" : "ambil",
    request: teks(ps.request, { max: 1000, nama: "Catatan pesanan" }),
  } : null;

  const no = kiriman && kiriman.no ? nomorKiriman(kiriman.no) : nomorBerikutnya(s);
  const jam = kiriman && kiriman.jam ? kiriman.jam : now.jam;
  const saleId = Number(run(`INSERT INTO sales(no, tgl, jam, user_id, kasir, pelanggan, hp, subtotal, diskon, ongkir, total, metode, bayar, catatan, kartu, ambil_tgl, ambil_jam, ambil_cara, request) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [no, tgl, jam, user.id, user.nama, pelanggan, hp, subtotal, diskon, ongkir, total, metode, bayar, catatan, kartu, pesanan?.tgl ?? null, pesanan?.jam ?? null, pesanan?.cara ?? null, pesanan?.request ?? null]).lastInsertRowid);
  const prodRows = [];
  items.forEach((it, idx) => {
    run(`INSERT INTO sale_items(sale_id, product_id, kode, nama, kategori, harga, qty, hpp, ready, pembuat) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [saleId, it.product_id, it.kode, it.nama, it.kategori, it.harga, it.qty, it.hpp, it.ready, it.pembuat ? it.pembuat.nama : null]);
    if (it.ready) ubahStok({ jenis: "produk", item: it.p, delta: -it.qty, tipe: "jual", tgl, ref: no, user });
    // Barang dibuat (custom / pesanan) dengan pembuat → otomatis tercatat di produksi & insentif.
    if (!it.ready && it.pembuat) {
      const [dari] = periodeDari(tgl, s.periode_mulai);
      if (one("SELECT 1 x FROM insentif_bayar WHERE pembuat_id = ? AND periode_dari = ?", [it.pembuat.id, dari])) return; // periode sudah dibayar
      const tarif = (it.p && it.p.insentif != null) ? it.p.insentif : s.insentif;
      run(`INSERT INTO produksi(tgl, product_id, kode, nama, qty, pembuat_id, tarif, restock, user_id, oleh, uid) VALUES (?,?,?,?,?,?,?,0,?,?,?)`,
        [tgl, it.product_id, it.kode, it.nama, it.qty, it.pembuat.id, tarif, user.id, user.nama, `jual:${no}:${idx}`]);
      prodRows.push([tgl, it.kode, it.nama, it.qty, it.pembuat.nama, tarif, Math.round(it.qty * tarif), "PESANAN " + no, user.nama]);
    }
  });
  if (prodRows.length) antre("produksi", prodRows);
  antre("penjualan", items.map(it => { const bagian = subtotal ? it.harga * it.qty / subtotal : 0;
    return [String(saleId), tgl, jam, no, it.kode, it.nama, it.kategori, it.harga, it.qty, Math.round(it.harga * it.qty), it.ready ? "READY STOK" : "PRODUKSI", pelanggan, hp, user.nama, metode, Math.round(diskon * bagian), Math.round(ongkir * bagian), Math.round(it.hpp * it.qty), catatan]; }));
  // Kabari HP admin (transaksi / pesanan baru). Transaksi lama yang baru dipindahkan dari perangkat tidak dikabarkan.
  if (!(kiriman && kiriman.lama)) antreNotifPenjualan({ id: saleId, total, bayar, metode, pelanggan, items, pesanan, kasir: user.nama });
  return sembunyikanHpp(muatPenjualan("id = ?", [saleId])[0], user);
}), { cabang: ({ hasil: x }) => ({ aksi: "jual", data: {
  no: x.no, tgl: x.tgl, jam: x.jam, pelanggan: x.pelanggan, hp: x.hp, diskon: x.diskon, ongkir: x.ongkir, metode: x.metode, bayar: x.bayar, catatan: x.catatan, kartu: x.kartu,
  pesanan: x.ambil_tgl ? { tgl: x.ambil_tgl, jam: x.ambil_jam, cara: x.ambil_cara, request: x.request } : null,
  items: x.items.map(i => ({ kode: i.kode, nama: i.nama, kategori: i.kategori, harga: i.harga, qty: i.qty, ready: i.ready, pembuat: i.pembuat || "" })),
} }) });

/** Daftar transaksi. Karyawan hanya melihat transaksi hari ini (untuk cetak ulang struk). */
route("GET", "/api/penjualan", "semua", ({ query, user }) => {
  const today = sekarang().tgl;
  let dari = query.dari ? tanggal(query.dari) : today, sampai = query.sampai ? tanggal(query.sampai) : dari;
  if (user.peran !== "admin") dari = sampai = today;
  const q = teks(query.q, { max: 60, upper: true });
  let where = "tgl BETWEEN ? AND ?", p = [dari, sampai];
  if (q) { where += " AND (no LIKE ? OR pelanggan LIKE ? OR id IN (SELECT sale_id FROM sale_items WHERE nama LIKE ?))"; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  return muatPenjualan(where, p, 1000).map(s => sembunyikanHpp(s, user));
});

route("GET", "/api/penjualan/:id", "semua", ({ params, user }) => {
  const s = muatPenjualan("id = ?", [+params.id])[0];
  if (!s) throw notFound("Transaksi tidak ditemukan");
  if (user.peran !== "admin" && s.tgl !== sekarang().tgl) throw new HttpError(403, "Karyawan hanya bisa membuka transaksi hari ini");
  return sembunyikanHpp(s, user);
});

route("POST", "/api/penjualan/:id/batal", "admin", ({ params, body, user }) => tx(() => {
  const s = muatPenjualan("id = ?", [+params.id])[0];
  if (!s) throw notFound("Transaksi tidak ditemukan");
  if (s.batal_at) throw bad("Transaksi ini sudah dibatalkan");
  const alasan = teks(body.alasan, { max: 200, nama: "Alasan" });
  const now = sekarang();
  for (const it of s.items) {
    if (!it.ready || !it.product_id) continue;
    const p = one("SELECT * FROM products WHERE id = ?", [it.product_id]);
    if (p) ubahStok({ jenis: "produk", item: p, delta: it.qty, tipe: "batal", ref: s.no, ket: alasan, user });
  }
  run("UPDATE sales SET batal_at = datetime('now'), batal_oleh = ?, batal_alasan = ? WHERE id = ?", [user.nama, alasan, s.id]);
  hapusProduksiJual(s.no); // pesanan batal: tidak dihitung insentif
  antre("batal", [[String(s.id), s.no, now.tgl, now.jam, user.nama, s.total]]);
  return { ok: true };
}), { cabang: ({ params, body }) => ({ aksi: "batal", data: { no: one("SELECT no FROM sales WHERE id = ?", [+params.id]).no, alasan: body.alasan || "" } }) });

/** Hapus transaksi sepenuhnya (salah input / data uji coba): stok READY dikembalikan bila belum dibatalkan,
 *  lalu transaksi hilang dari daftar & laporan. Riwayat stok tetap mencatat pengembaliannya. */
function hapusPenjualan(s, user, alasan){
  if (!s.batal_at) {
    for (const it of s.items) {
      if (!it.ready || !it.product_id) continue;
      const p = one("SELECT * FROM products WHERE id = ?", [it.product_id]);
      if (p) ubahStok({ jenis: "produk", item: p, delta: it.qty, tipe: "batal", ref: s.no, ket: alasan || "Transaksi dihapus", user });
    }
    const now = sekarang();
    antre("batal", [[String(s.id), s.no, now.tgl, now.jam, user.nama, s.total]]); // di sheet tercatat batal
  }
  hapusProduksiJual(s.no);
  run("DELETE FROM sale_items WHERE sale_id = ?", [s.id]);
  run("DELETE FROM sales WHERE id = ?", [s.id]);
}

route("DELETE", "/api/penjualan/:id", "admin", ({ params, body, user }) => tx(() => {
  const s = muatPenjualan("id = ?", [+params.id])[0];
  if (!s) throw notFound("Transaksi tidak ditemukan");
  hapusPenjualan(s, user, teks(body && body.alasan, { max: 200, nama: "Alasan" }));
  return { ok: true, no: s.no };
}), {
  pra: ({ params }) => one("SELECT no FROM sales WHERE id = ?", [+params.id]),
  cabang: ({ pra }) => pra ? { aksi: "hapus_jual", data: { nos: [pra.no] } } : null,
});

/** Hapus semua transaksi dalam rentang tanggal (membersihkan data uji coba). Wajib mengetik HAPUS sebagai konfirmasi. */
route("POST", "/api/penjualan/hapus-rentang", "admin", ({ body, user }) => tx(() => {
  if (String(body.konfirmasi || "").trim().toUpperCase() !== "HAPUS") throw bad("Ketik HAPUS untuk konfirmasi");
  const dari = tanggal(body.dari, { nama: "Tanggal awal" }), sampai = tanggal(body.sampai, { nama: "Tanggal akhir" });
  if (sampai < dari) throw bad("Tanggal akhir sebelum tanggal awal");
  const daftarJual = muatPenjualan("tgl BETWEEN ? AND ?", [dari, sampai], 100000);
  for (const s of daftarJual) hapusPenjualan(s, user, "Hapus data uji coba");
  return { ok: true, jumlah: daftarJual.length, nos: daftarJual.map(s => s.no) };
}), { cabang: ({ hasil }) => hasil.nos.length ? { aksi: "hapus_jual", data: { nos: hasil.nos } } : null });

/* ---- Pesanan: pelunasan sisa DP & tandai sudah diambil/diantar ---- */
route("POST", "/api/penjualan/:id/lunasi", "semua", ({ params, body, user }) => tx(() => {
  const s = one("SELECT * FROM sales WHERE id = ?", [+params.id]);
  if (!s) throw notFound("Transaksi tidak ditemukan");
  if (s.batal_at) throw bad("Transaksi ini sudah dibatalkan");
  const sisa = s.total - s.bayar;
  if (sisa <= 0) throw bad("Transaksi ini sudah lunas");
  const nominal = angka(body.nominal, { min: 1, max: 1e11, bulat: true, nama: "Nominal" }) ?? sisa;
  const metode = pilihan(body.metode || "Tunai", METODE, "Metode bayar");
  const bayar = Math.min(s.total, s.bayar + nominal), lunas = bayar >= s.total;
  run("UPDATE sales SET bayar = ?, lunas_at = ?, lunas_metode = ?, lunas_oleh = ? WHERE id = ?",
    [bayar, lunas ? sekarang().tgl + " " + sekarang().jam : s.lunas_at, metode, user.nama, s.id]);
  return { ok: true, bayar, lunas };
}), { cabang: ({ params, body }) => ({ aksi: "lunasi", data: { no: one("SELECT no FROM sales WHERE id = ?", [+params.id]).no, nominal: body.nominal ?? null, metode: body.metode || "Tunai" } }) });

route("POST", "/api/penjualan/:id/diambil", "semua", ({ params, body, user }) => tx(() => {
  const s = one("SELECT * FROM sales WHERE id = ?", [+params.id]);
  if (!s) throw notFound("Transaksi tidak ditemukan");
  if (s.batal_at) throw bad("Transaksi ini sudah dibatalkan");
  if (body.batal) { run("UPDATE sales SET diambil_at = NULL, diambil_oleh = NULL WHERE id = ?", [s.id]); return { ok: true }; }
  if (s.diambil_at) return { ok: true };
  run("UPDATE sales SET diambil_at = ?, diambil_oleh = ? WHERE id = ?", [sekarang().tgl + " " + sekarang().jam, user.nama, s.id]);
  return { ok: true };
}), { cabang: ({ params, body }) => ({ aksi: "diambil", data: { no: one("SELECT no FROM sales WHERE id = ?", [+params.id]).no, batal: !!body.batal } }) });

/** Daftar pesanan: yang belum diambil (urut tanggal ambil), atau yang sudah selesai (terbaru dulu). */
route("GET", "/api/pesanan", "semua", ({ query, user }) => {
  const selesai = query.status === "selesai";
  const rows = selesai
    ? muatPenjualan("ambil_tgl IS NOT NULL AND batal_at IS NULL AND diambil_at IS NOT NULL", [], 300)
    : muatPenjualan("ambil_tgl IS NOT NULL AND batal_at IS NULL AND diambil_at IS NULL", [], 1000)
        .sort((a, b) => (a.ambil_tgl + (a.ambil_jam || "99")).localeCompare(b.ambil_tgl + (b.ambil_jam || "99")));
  return rows.map(s => sembunyikanHpp(s, user));
});

/** Data pelanggan, dikumpulkan dari riwayat transaksi (tidak perlu didaftarkan terpisah).
 *  Satu pelanggan = satu nomor HP; tanpa nomor HP dikelompokkan menurut nama. */
const hpKunci = hp => { let d = String(hp || "").replace(/\D/g, ""); if (d.startsWith("62")) d = "0" + d.slice(2); return d.length >= 8 ? d : ""; };
route("GET", "/api/pelanggan", "semua", ({ query, user }) => {
  const q = teks(query.q, { max: 60, upper: true });
  const per = new Map();
  for (const s of all("SELECT pelanggan, hp, tgl, total FROM sales WHERE batal_at IS NULL ORDER BY id DESC LIMIT 30000")) {
    const nama = String(s.pelanggan || "").trim().toUpperCase(), hp = hpKunci(s.hp);
    if (!hp && (!nama || nama === "CUSTOMER")) continue;
    const k = hp || "N:" + nama;
    let p = per.get(k);
    if (!p) per.set(k, p = { nama, hp: hp ? s.hp.trim() : "", transaksi: 0, total: 0, terakhir: s.tgl });
    if (p.nama === "CUSTOMER" && nama && nama !== "CUSTOMER") p.nama = nama;
    p.transaksi++; p.total += s.total;
  }
  let hasil = [...per.values()];
  if (q) { const qd = q.replace(/\D/g, ""); hasil = hasil.filter(p => p.nama.includes(q) || (qd.length >= 3 && hpKunci(p.hp).includes(qd.replace(/^62/, "0")))); }
  if (user.peran !== "admin") hasil.forEach(p => delete p.total);
  return hasil.slice(0, Number(query.semua) && user.peran === "admin" ? 5000 : 300);
});

export { muatPenjualan, hapusPenjualan };
