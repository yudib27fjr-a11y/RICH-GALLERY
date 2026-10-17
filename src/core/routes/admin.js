import { route } from "../router.js";
import { one, all, run, tx, getSettings, setSetting, migrasi } from "../db.js";
import { HttpError } from "../util.js";
import { cekPassword, hashPassword, cekBatasLogin, catatGagal, resetGagal } from "../auth.js";
import { platform } from "../platform.js";
import { bad, teks, angka } from "../util.js";
import { kirimOutbox, statusSync, tarikSheet } from "../sync.js";
import { cabangAktif, mintaPusat } from "../cabang-perangkat.js";
import { KATEGORI, KAT_BAHAN, KAT_PENGELUARAN, barcodeDefault, tebakKategori } from "../../../public/shared.js";

/* ---- Pengaturan toko ---- */
route("GET", "/api/pengaturan", "admin", () => { const { cabang_token, kartu_latar, kartu_font, ...s } = getSettings(); return { ...s, sync: statusSync() }; });

/* Gambar latar kartu ucapan (desain Canva yang diunduh). Disimpan terpisah supaya data lain tetap ringan. */
route("GET", "/api/kartu/latar", "semua", async () => { if (cabangAktif()) return mintaPusat("/api/cabang/kartu-latar", {}); const s = getSettings(); return { latar: s.kartu_latar || "", font: s.kartu_font || "" }; });

route("PUT", "/api/pengaturan", "admin", ({ body }) => tx(() => {
  const s = getSettings(), b = body;
  const v = {
    nama_toko: b.nama_toko != null ? teks(b.nama_toko, { wajib: true, max: 60, nama: "Nama toko" }) : undefined,
    alamat: b.alamat != null ? teks(b.alamat, { max: 200, nama: "Alamat" }) : undefined,
    telp: b.telp != null ? teks(b.telp, { max: 30, nama: "Telepon" }) : undefined,
    footer: b.footer != null ? teks(b.footer, { max: 600, nama: "Teks bawah struk" }) : undefined,
    prefix: b.prefix != null ? teks(b.prefix, { max: 20, nama: "Awalan invoice" }) : undefined,
    no_berikutnya: b.no_berikutnya != null ? angka(b.no_berikutnya, { min: 1, max: 999999999, bulat: true, nama: "Nomor invoice" }) : undefined,
    hpp_persen: b.hpp_persen != null ? angka(b.hpp_persen, { min: 0, max: 100, nama: "HPP %" }) : undefined,
    insentif: b.insentif != null ? angka(b.insentif, { min: 0, max: 1e7, bulat: true, nama: "Insentif" }) : undefined,
    periode_mulai: b.periode_mulai != null ? angka(b.periode_mulai, { min: 1, max: 28, bulat: true, nama: "Tanggal mulai periode" }) : undefined,
    sync_url: b.sync_url != null ? teks(b.sync_url, { max: 300, nama: "URL Apps Script" }) : undefined,
    sheet_id: b.sheet_id != null ? teks(b.sheet_id, { max: 120, nama: "ID sheet" }) : undefined,
    wa_template: b.wa_template != null ? teks(b.wa_template, { max: 2000, nama: "Pesan WhatsApp" }) : undefined,
    wa_otomatis: b.wa_otomatis != null ? !!b.wa_otomatis : undefined,
    canva_url: b.canva_url != null ? teks(b.canva_url, { max: 500, nama: "Link Canva" }) : undefined,
    canva_email: b.canva_email != null ? teks(b.canva_email, { max: 120, nama: "Email Canva" }) : undefined,
    kartu_lebar: b.kartu_lebar != null ? angka(b.kartu_lebar, { min: 30, max: 300, nama: "Lebar kartu" }) : undefined,
    kartu_tinggi: b.kartu_tinggi != null ? angka(b.kartu_tinggi, { min: 30, max: 300, nama: "Tinggi kartu" }) : undefined,
    kartu_huruf: b.kartu_huruf != null ? (["grown", "kustom", "script", "serif", "sans"].includes(b.kartu_huruf) ? b.kartu_huruf : "grown") : undefined,
    kartu_font: b.kartu_font != null ? String(b.kartu_font) : undefined,
    kartu_warna: b.kartu_warna != null ? (/^#[0-9a-fA-F]{6}$/.test(b.kartu_warna) ? b.kartu_warna : "#3a2a2a") : undefined,
    kartu_area: b.kartu_area != null ? (["desain", "tengah", "atas", "bawah", "kiri", "kanan"].includes(b.kartu_area) ? b.kartu_area : "tengah") : undefined,
    kartu_latar: b.kartu_latar != null ? String(b.kartu_latar) : undefined,
    inv_tagline: b.inv_tagline != null ? teks(b.inv_tagline, { max: 120, nama: "Keterangan toko di nota" }) : undefined,
    inv_bank: b.inv_bank != null ? teks(b.inv_bank, { max: 300, nama: "Info rekening di nota" }) : undefined,
    inv_ttd_nama: b.inv_ttd_nama != null ? teks(b.inv_ttd_nama, { max: 60, nama: "Nama penanda tangan" }) : undefined,
    inv_ttd_jabatan: b.inv_ttd_jabatan != null ? teks(b.inv_ttd_jabatan, { max: 60, nama: "Jabatan penanda tangan" }) : undefined,
    inv_ttd: b.inv_ttd != null ? String(b.inv_ttd) : undefined,
    wa_nomor: b.wa_nomor != null ? teks(b.wa_nomor, { max: 30, nama: "Nomor WA toko" }) : undefined,
  };
  // Desain kartu bawaan aplikasi (mis. "bawaan:pita"): tidak perlu menyimpan gambarnya di server.
  let latarBawaan = null;
  if (typeof v.kartu_latar === "string" && /^bawaan:[a-z0-9-]{1,30}$/.test(v.kartu_latar)) { latarBawaan = v.kartu_latar; v.kartu_latar = ""; }
  if (v.kartu_latar && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v.kartu_latar) || v.kartu_latar.length > 1_400_000)) throw bad("Gambar latar kartu tidak valid atau terlalu besar (maks ± 1 MB)");
  if (v.kartu_font && (!/^data:[a-z\/+.-]*;base64,[A-Za-z0-9+/=]+$/.test(v.kartu_font) || v.kartu_font.length > 2_000_000)) throw bad("File font tidak valid atau terlalu besar (maks ± 1,4 MB)");
  if (v.kartu_font !== undefined) setSetting("kartu_font_kode", v.kartu_font ? platform.sha256(v.kartu_font).slice(0, 12) : "");
  if (v.kartu_latar !== undefined) setSetting("kartu_latar_kode", latarBawaan || (v.kartu_latar ? platform.sha256(v.kartu_latar).slice(0, 12) : ""));
  if (v.inv_ttd && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v.inv_ttd) || v.inv_ttd.length > 150_000)) throw bad("Tanda tangan tidak valid atau terlalu besar");
  if (v.wa_nomor && String(v.wa_nomor).replace(/\D/g, "").length < 9) throw bad("Nomor WA toko tidak valid");
  if (v.canva_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.canva_email)) throw bad("Email Canva tidak valid");
  if (v.canva_url && !/^https:\/\/(www\.)?canva\.(com|link)\//.test(v.canva_url)) throw bad("Link Canva harus diawali https://www.canva.com/ atau https://canva.link/");
  if (v.sync_url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(v.sync_url)) throw bad("URL Apps Script harus diawali https://script.google.com/");
  const prefix = v.prefix ?? s.prefix, no = v.no_berikutnya ?? s.no_berikutnya;
  if ((v.prefix !== undefined || v.no_berikutnya !== undefined) && one("SELECT 1 x FROM sales WHERE no = ?", [prefix + String(no).padStart(9, "0")])) throw bad("Nomor invoice itu sudah pernah dipakai. Isi nomor yang lebih besar.");
  for (const [k, val] of Object.entries(v)) if (val !== undefined) setSetting(k, val);
  return { ok: true };
}), { batas: 4_000_000 });

/* ---- Sinkron Google Sheet ---- */
route("GET", "/api/sync", "admin", () => statusSync());
route("POST", "/api/sync/kirim", "admin", async () => ({ ...(await kirimOutbox({ paksa: true })), ...statusSync() }));

route("POST", "/api/sync/tarik", "admin", async ({ body }) => {
  const s = getSettings(), timpa = !!body.timpa_stok, jenis = body.jenis === "bahan" ? "bahan" : "produk";
  const rows = jenis === "produk"
    ? await tarikSheet(s.sheet_id, "READY STOK", "select B,C,D,E where B is not null")
    : await tarikSheet(s.sheet_id, "STOK OPNAME", "select B,C,D,E,F,I,K where C is not null and B is not null");
  let baru = 0, ubah = 0;
  tx(() => {
    for (const r of rows) {
      if (jenis === "produk") {
        const kode = String(r[0] || "").trim().toUpperCase(), nama = String(r[1] || "").trim().toUpperCase(), harga = Math.round(Number(r[2]) || 0), stok = Number(r[3]) || 0;
        if (!/^RG\d+$/.test(kode) || !nama) continue;
        const x = one("SELECT id, nama, harga FROM products WHERE kode = ? AND dihapus IS NULL", [kode]);
        if (x) { if (x.nama !== nama || x.harga !== harga) ubah++; run(`UPDATE products SET nama=?, harga=?, hpp=?, ${timpa ? "stok=?," : ""} diubah=datetime('now') WHERE id=?`, timpa ? [nama, harga, Math.round(harga * s.hpp_persen / 100), stok, x.id] : [nama, harga, Math.round(harga * s.hpp_persen / 100), x.id]); }
        else { run("INSERT INTO products(kode, nama, kategori, harga, hpp, stok, stok_min, barcode) VALUES (?,?,?,?,?,?,1,?)", [kode, nama, tebakKategori(nama), harga, Math.round(harga * s.hpp_persen / 100), timpa ? stok : 0, barcodeDefault("produk", kode)]); baru++; }
      } else {
        const nama = String(r[0] || "").trim().toUpperCase(), kode = String(r[1] || "").trim().toUpperCase();
        if (!/^RG\d+$/.test(kode) || !nama) continue;
        const kat = KAT_BAHAN.includes(String(r[2] || "").trim().toUpperCase()) ? String(r[2]).trim().toUpperCase() : "LAIN-LAIN";
        const harga = Math.round(Number(r[3]) || 0), satuan = String(r[4] || "PCS").trim().toUpperCase().slice(0, 12), stok = Number(r[5]) || 0, min = Number(r[6]) || 0;
        const x = one("SELECT id FROM materials WHERE kode = ? AND dihapus IS NULL", [kode]);
        if (x) { ubah++; run(`UPDATE materials SET nama=?, kategori=?, harga=?, satuan=?, stok_min=?, ${timpa ? "stok=?," : ""} diubah=datetime('now') WHERE id=?`, timpa ? [nama, kat, harga, satuan, min, stok, x.id] : [nama, kat, harga, satuan, min, x.id]); }
        else { run("INSERT INTO materials(kode, nama, kategori, harga, satuan, stok, stok_min, barcode) VALUES (?,?,?,?,?,?,?,?)", [kode, nama, kat, harga, satuan, timpa ? stok : 0, min, barcodeDefault("bahan", kode)]); baru++; }
      }
    }
  });
  return { baru, diperbarui: ubah };
});

/* ---- Cadangan: salinan utuh database (bisa langsung dipakai untuk memulihkan, di server maupun di aplikasi Android) ---- */
route("GET", "/api/cadangan", "admin", () => platform.cadangan());

/* ---- Hard reset: mulai input dari awal. Butuh kode reset (bawaan "OK", bisa diganti admin). ----
   Pengguna, PIN, dan pengaturan tetap. Pilihan: hapus semua transaksi & catatan, nolkan stok, hapus katalog barang. */
export const TABEL_TRANSAKSI = ["sale_items", "sales", "stock_moves", "produksi", "insentif_bayar", "insentif_lain", "kasbon", "gaji_bayar", "expenses", "absen", "outbox"];
const KODE_RESET_BAWAAN = "OK";
function cekKodeReset(kode, ctx){
  const kunci = (ctx && ctx.ip || "") + "|reset";
  cekBatasLogin(kunci);
  const simpan = getSettings().reset_kode;
  const cocok = simpan ? cekPassword(String(kode ?? ""), simpan) : String(kode ?? "") === KODE_RESET_BAWAAN;
  if (!cocok) { catatGagal(kunci); throw new HttpError(401, "Kode reset salah"); }
  resetGagal(kunci);
}
route("GET", "/api/reset", "admin", () => ({ kodeBawaan: !getSettings().reset_kode }));
route("PUT", "/api/reset/kode", "admin", ({ body, ctx }) => {
  cekKodeReset(body.lama, ctx);
  const baru = String(body.baru ?? "");
  if (baru.length < 2 || baru.length > 60) throw bad("Kode reset baru 2–60 karakter");
  setSetting("reset_kode", hashPassword(baru));
  return { ok: true };
}, { pusatSaja: true });
route("POST", "/api/reset", "admin", ({ body, ctx, user }) => {
  cekKodeReset(body.kode, ctx);
  const transaksi = !!body.transaksi, stok = !!body.stok, katalog = !!body.katalog;
  if (!transaksi && !stok && !katalog) throw bad("Pilih data yang mau direset");
  return tx(() => {
    const n = {};
    if (transaksi) for (const t of TABEL_TRANSAKSI) { n[t] = one(`SELECT COUNT(*) n FROM ${t}`).n; run(`DELETE FROM ${t}`); }
    if (stok || katalog) for (const t of ["products", "materials"]) run(`UPDATE ${t} SET stok = 0, diubah = datetime('now') WHERE dihapus IS NULL`);
    if (katalog) for (const t of ["products", "materials"]) { n[t] = one(`SELECT COUNT(*) n FROM ${t} WHERE dihapus IS NULL`).n; run(`UPDATE ${t} SET dihapus = datetime('now'), barcode = NULL WHERE dihapus IS NULL`); }
    // Perangkat cabang ikut mengosongkan datanya saat sinkron berikutnya.
    setSetting("reset_terakhir", { id: Date.now().toString(36), transaksi, stok, katalog, oleh: user.nama, waktu: new Date().toISOString() });
    return { ok: true, dihapus: n };
  });
}, { pusatSaja: true });

/* ---- Pulihkan: ganti SELURUH database dengan file cadangan .db (dari server atau dari aplikasi Android) ----
   Dipakai juga untuk memindahkan data aplikasi offline ke server online. Setelah ini semua pengguna harus masuk lagi. */
route("POST", "/api/pulihkan", "admin", async ({ body }) => {
  if (body.konfirmasi !== "GANTI SEMUA DATA") throw bad("Ketik GANTI SEMUA DATA untuk mengonfirmasi");
  const data = String(body.data || "");
  if (data.length < 100) throw bad("File cadangan kosong");
  try { await platform.pulihkan(data); }
  catch (e) { throw bad(e.message || "File cadangan tidak bisa dipakai"); }
  migrasi();
  return { ok: true, masukUlang: true };
}, { batas: 200_000_000 });

/* ---- Impor data dari aplikasi versi file HTML (Pengaturan → Unduh cadangan .json) ---- */
route("POST", "/api/impor-lama", "admin", ({ body, query }) => {
  const d = body;
  if (!d || !Array.isArray(d.produk) || !d.settings) throw bad("File bukan cadangan aplikasi kasir Rich Gallery versi lama");
  const timpaStok = query.timpa_stok === "1";
  const n = { produk: 0, bahan: 0, penjualan: 0, mutasi: 0, opname: 0, pengeluaran: 0, produksi: 0, insentif: 0, karyawan: 0 };
  tx(() => {
    const s = getSettings(), st = d.settings;
    const map = { nama: "nama_toko", alamat: "alamat", telp: "telp", footer: "footer", prefix: "prefix", hppPersen: "hpp_persen", insentif: "insentif", periodeMulai: "periode_mulai", sheetId: "sheet_id" };
    for (const [a, b] of Object.entries(map)) if (st[a] != null && st[a] !== "") setSetting(b, st[a]);
    if (st.syncUrl && !s.sync_url) setSetting("sync_url", st.syncUrl);
    if (+st.nextNo > s.no_berikutnya) setSetting("no_berikutnya", +st.nextNo);

    const userId = nama => {
      nama = String(nama || "").trim(); if (!nama) return null;
      const u = one("SELECT id FROM users WHERE nama_key = ?", [nama.toLowerCase()]);
      if (u) return u.id;
      n.karyawan++;
      return Number(run("INSERT INTO users(nama, nama_key, peran) VALUES (?, ?, 'karyawan')", [nama.toUpperCase(), nama.toLowerCase()]).lastInsertRowid);
    };
    (d.staff || []).filter(x => x && x !== "Admin").forEach(userId);

    const bcAman = (bc, tabel, id) => {
      if (!bc) return null;
      for (const t of ["products", "materials"]) { const r = one(`SELECT id FROM ${t} WHERE barcode = ? AND dihapus IS NULL`, [bc]); if (r && !(t === tabel && r.id === id)) return null; }
      return bc;
    };
    for (const p of d.produk) {
      const kode = String(p.c || "").toUpperCase(); if (!kode || !p.n) continue;
      const x = one("SELECT id FROM products WHERE kode = ? AND dihapus IS NULL", [kode]);
      const kat = KATEGORI.includes(p.k) ? p.k : tebakKategori(p.n);
      if (x) {
        run(`UPDATE products SET nama=?, kategori=?, harga=?, hpp=?, stok_min=?, insentif=?, aktif=? ${timpaStok ? ", stok=?" : ""} WHERE id=?`,
          [p.n, kat, Math.round(+p.p || 0), Math.round(+p.h || 0), +p.min || 0, p.ins ?? null, p.on === false ? 0 : 1, ...(timpaStok ? [+p.s || 0] : []), x.id]);
        const bc = bcAman(p.bc, "products", x.id); if (bc) run("UPDATE products SET barcode = ? WHERE id = ?", [bc, x.id]);
      } else {
        const id = Number(run("INSERT INTO products(kode, nama, kategori, harga, hpp, stok, stok_min, insentif, aktif) VALUES (?,?,?,?,?,?,?,?,?)",
          [kode, p.n, kat, Math.round(+p.p || 0), Math.round(+p.h || 0), +p.s || 0, +p.min || 0, p.ins ?? null, p.on === false ? 0 : 1]).lastInsertRowid);
        run("UPDATE products SET barcode = ? WHERE id = ?", [bcAman(p.bc, "products", id) || barcodeDefault("produk", kode), id]);
      }
      n.produk++;
    }
    for (const b of d.bahan || []) {
      const kode = String(b.c || "").toUpperCase(); if (!kode || !b.n) continue;
      const x = one("SELECT id FROM materials WHERE kode = ? AND dihapus IS NULL", [kode]);
      const kat = KAT_BAHAN.includes(b.k) ? b.k : "LAIN-LAIN";
      if (x) {
        run(`UPDATE materials SET nama=?, kategori=?, harga=?, satuan=?, stok_min=? ${timpaStok ? ", stok=?" : ""} WHERE id=?`, [b.n, kat, Math.round(+b.p || 0), b.u || "PCS", +b.min || 0, ...(timpaStok ? [+b.s || 0] : []), x.id]);
        const bc = bcAman(b.bc, "materials", x.id); if (bc) run("UPDATE materials SET barcode = ? WHERE id = ?", [bc, x.id]);
      } else {
        const id = Number(run("INSERT INTO materials(kode, nama, kategori, harga, satuan, stok, stok_min) VALUES (?,?,?,?,?,?,?)", [kode, b.n, kat, Math.round(+b.p || 0), b.u || "PCS", +b.s || 0, +b.min || 0]).lastInsertRowid);
        run("UPDATE materials SET barcode = ? WHERE id = ?", [bcAman(b.bc, "materials", id) || barcodeDefault("bahan", kode), id]);
      }
      n.bahan++;
    }
    const pid = kode => kode ? one("SELECT id FROM products WHERE kode = ? AND dihapus IS NULL", [kode])?.id ?? null : null;
    const itemId = (jenis, kode) => one(`SELECT id FROM ${jenis === "produk" ? "products" : "materials"} WHERE kode = ? AND dihapus IS NULL`, [kode])?.id ?? null;

    let maxNo = 0;
    for (const s2 of d.sales || []) {
      if (!s2.no || one("SELECT 1 x FROM sales WHERE no = ? OR legacy_id = ?", [s2.no, String(s2.id)])) continue;
      const sub = (s2.items || []).reduce((a, i) => a + (+i.p || 0) * (+i.q || 0), 0);
      const sid = Number(run(`INSERT INTO sales(no, tgl, jam, kasir, pelanggan, hp, subtotal, diskon, ongkir, total, metode, bayar, catatan, batal_at, batal_oleh, legacy_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s2.no, s2.tgl, s2.jam || "00:00", s2.kasir || "-", s2.cust || "CUSTOMER", s2.hp || "", Math.round(sub), Math.round(+s2.disc || 0), Math.round(+s2.ongkir || 0), Math.round(+s2.total || 0),
          ["Tunai", "Transfer", "QRIS"].includes(s2.metode) ? s2.metode : "Tunai", Math.round(+s2.bayar || 0), s2.note || "", s2.void ? s2.tgl : null, s2.void ? "impor" : null, String(s2.id)]).lastInsertRowid);
      for (const i of s2.items || []) run(`INSERT INTO sale_items(sale_id, product_id, kode, nama, kategori, harga, qty, hpp, ready) VALUES (?,?,?,?,?,?,?,?,?)`,
        [sid, i.manual ? null : pid(i.c), i.manual ? "" : (i.c || ""), i.n, KATEGORI.includes(i.k) ? i.k : tebakKategori(i.n), Math.round(+i.p || 0), +i.q || 0, Math.round(+i.h || 0), i.ready ? 1 : 0]);
      const m = String(s2.no).match(/(\d+)$/); if (m) maxNo = Math.max(maxNo, +m[1]);
      n.penjualan++;
    }
    if (maxNo >= getSettings().no_berikutnya) setSetting("no_berikutnya", maxNo + 1);

    const gerak = (r, tipe, qty, sebelum, sesudah, ket) => {
      if (!r.id || one("SELECT 1 x FROM stock_moves WHERE legacy_id = ?", [tipe + ":" + r.id])) return false;
      run(`INSERT INTO stock_moves(tgl, jam, jenis, item_id, kode, nama, tipe, qty, stok_sebelum, stok_sesudah, ket, oleh, legacy_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.tgl, "00:00", r.jenis === "produk" ? "produk" : "bahan", itemId(r.jenis === "produk" ? "produk" : "bahan", r.c), r.c || "", r.n || "", tipe, qty, sebelum, sesudah, ket || "", r.kasir || "", tipe + ":" + r.id]);
      return true;
    };
    for (const r of d.masuk || []) if (gerak(r, "masuk", +r.q || 0, null, null, r.ket)) n.mutasi++;
    for (const r of d.keluar || []) if (gerak(r, "keluar", -(+r.q || 0), null, null, r.ket)) n.mutasi++;
    for (const r of d.opname || []) if (gerak(r, r.ket === "Koreksi manual" ? "koreksi" : "opname", +r.selisih || 0, +r.sistem, +r.fisik, r.ket)) n.opname++;

    for (const e of d.expenses || []) {
      if (!e.id || one("SELECT 1 x FROM expenses WHERE legacy_id = ?", [String(e.id)])) continue;
      run("INSERT INTO expenses(tgl, kategori, ket, nominal, oleh, legacy_id) VALUES (?,?,?,?,?,?)", [e.tgl, KAT_PENGELUARAN.includes(e.k) ? e.k : "Lain-lain", e.d || "", Math.round(+e.nom || 0), e.kasir || "", String(e.id)]);
      n.pengeluaran++;
    }
    for (const p of d.produksi || []) {
      if (!p.id || one("SELECT 1 x FROM produksi WHERE legacy_id = ?", [String(p.id)])) continue;
      run(`INSERT INTO produksi(tgl, product_id, kode, nama, qty, pembuat_id, tarif, restock, oleh, legacy_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [p.tgl, pid(p.c), p.c || "", p.n || "", +p.q || 0, userId(p.oleh), Math.round(+p.tarif || 0), p.stok ? 1 : 0, p.kasir || "", String(p.id)]);
      n.produksi++;
    }
    for (const b of d.bayarIns || []) {
      const uid = userId(b.nama);
      if (!uid || one("SELECT 1 x FROM insentif_bayar WHERE pembuat_id = ? AND periode_dari = ?", [uid, b.periode])) continue;
      run(`INSERT INTO insentif_bayar(pembuat_id, periode_dari, periode_sampai, qty, hitung, nominal, tgl, ket, oleh) VALUES (?,?,?,?,?,?,?,?,?)`,
        [uid, b.periode, b.sampai, +b.q || 0, Math.round(+b.hitung || 0), Math.round(+b.nominal || 0), b.tgl, b.ket || "", b.kasir || ""]);
      n.insentif++;
    }
  });
  return n;
}, { batas: 50_000_000 });

