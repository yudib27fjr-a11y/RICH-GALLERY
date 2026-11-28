/* Versi DEMO untuk promosi jasa pembuatan aplikasi (Yudsky Tech).
   Hanya aktif di database yang diisi isiDemo() (pemasangan Cloudflare "demo"): setiap pengunjung mendapat database sendiri
   berisi toko contoh netral ("Toko Bunga Contoh") — data asli Rich Gallery tidak ikut. Database toko asli tidak pernah
   punya setelan demo, jadi alamat /api/demo/* di sana selalu 404. */
import { run, one, all, tx, getSettings, setSetting } from "./db.js";
import { route, jalankan } from "./router.js";
import { buatSesi } from "./auth.js";
import { SEED_PRODUK, SEED_BAHAN } from "./seed-data.js";
import { tebakKategori, barcodeDefault, tambahHari, unitKategori } from "../../public/shared.js";
import { HttpError, hariIni } from "./util.js";

export const MEREK_DEMO = "Yudsky Tech";
/** Nomor WhatsApp Yudsky Tech untuk tombol "Pesan aplikasi seperti ini" (format 62…). */
export const WA_DEMO = "";
const KASIR = ["SARI", "DEWI", "RINA"];
const PELANGGAN = ["ANISA", "BUDI", "CITRA", "DIMAS", "EKA", "FAJAR", "GITA", "HANA", "INDRA", "JIHAN", "KARIN", "LUKMAN", "MAYA", "NADIA", "OKTA", "PUTRI", "RIZKY", "SALSA", "TIARA", "WAHYU"];

/** Teks merek toko asli → toko contoh (dipakai untuk setiap jawaban API di versi demo). */
export const GANTI_MEREK = [
  [/Rich Gallery/g, "Toko Bunga Contoh"], [/RICH GALLERY/g, "TOKO BUNGA CONTOH"], [/rich gallery/gi, "toko bunga contoh"],
  [/nyenengin\.id/gi, "Buket & Gift"], [/Rich Hampers/g, "Hampers"], [/Rich Party/g, "Dekorasi"], [/Rich Hantaran/g, "Seserahan"],
  [/#richgallery/gi, "#tokobungacontoh"], [/#floristindramayu/gi, "#floristlokal"], [/#buketindramayu/gi, "#buketmurah"],
  [/richgallery\.my\.id/gi, "contoh.id"], [/Indramayu/g, "Kota Contoh"],
];
export const gantiMerek = s => GANTI_MEREK.reduce((t, [a, b]) => t.replace(a, b), s);

// Angka acak yang sama setiap kali (data contoh tetap rapi & masuk akal)
function acak(benih){ let x = benih >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

export const demoAktif = () => !!getSettings().demo;

/** Isi database baru dengan toko contoh + transaksi 2 minggu terakhir. Sekali saja (database kosong). */
export async function isiDemo(){
  if (one("SELECT COUNT(*) n FROM products").n > 0) return false;
  const r = acak(20261128);
  const pilih = a => a[Math.floor(r() * a.length)];
  tx(() => {
    const S = {
      demo: true,
      nama_toko: "TOKO BUNGA CONTOH", alamat: "Jl. Melati No. 1, Kota Contoh", telp: "0812-0000-0000",
      footer: "Ini struk DEMO — aplikasi kasir buatan Yudsky Tech\nTerima kasih telah mencoba 🌸", prefix: "TB/", no_berikutnya: 1,
      sheet_id: "", sync_url: "", canva_url: "", wa_nomor: "",
      inv_tagline: "Buket, Hampers, Dekorasi & Seserahan", inv_bank: "Bank Contoh 1234567890\na.n. Toko Bunga Contoh", inv_ttd_nama: "Pemilik Toko", inv_ttd_jabatan: "Pemilik",
      mitra: [{ kategori: "Toko mitra", nama: "Toko Pita Contoh", hp: "", kota: "", catatan: "" }],
      absen_aktif: false, absen_pin_aktif: false, absen_lat: "", absen_lng: "",
    };
    for (const [k, v] of Object.entries(S)) setSetting(k, v);
    const hpp = getSettings().hpp_persen;
    for (const l of SEED_PRODUK.trim().split("\n")) {
      const [k, nama, harga] = l.split("|"), kode = "TB" + k.replace(/^\D+/, "");
      const stok = r() < 0.45 ? 2 + Math.floor(r() * 10) : 0;
      run(`INSERT INTO products(kode, nama, kategori, harga, hpp, stok, stok_min, barcode) VALUES (?,?,?,?,?,?,1,?)`,
        [kode, nama, tebakKategori(nama), +harga, Math.round(+harga * hpp / 100), stok, barcodeDefault("produk", kode)]);
    }
    for (const l of SEED_BAHAN.trim().split("\n")) {
      const [kode, nama, kategori, harga, s, min] = l.split("|");
      run(`INSERT INTO materials(kode, nama, kategori, harga, stok, stok_min, barcode) VALUES (?,?,?,?,?,?,?)`, [kode, nama, kategori, +harga, +s, +min, barcodeDefault("bahan", kode)]);
    }
    // Akun demo tanpa password (masuk lewat tombol "Coba sebagai …"); hash tiruan ini tidak bisa dipakai login biasa.
    run("INSERT INTO users(nama, nama_key, peran, pass_hash) VALUES ('PEMILIK', 'pemilik', 'admin', 'demo$tanpa-password')");
    for (const n of KASIR) run("INSERT INTO users(nama, nama_key, peran, pass_hash) VALUES (?, ?, 'karyawan', 'demo$tanpa-password')", [n, n.toLowerCase()]);
  });

  // Transaksi contoh lewat aturan kasir yang sama dengan toko sungguhan (stok, insentif, laporan ikut terisi).
  const admin = one("SELECT id FROM users WHERE nama_key = 'pemilik'");
  let token = ""; buatSesi({ setSesi: t => { token = t; } }, admin.id);
  const api = (method, path, body) => jalankan({ method, path, body, query: {}, token, ip: "demo", setSesi: () => {} });
  const staf = all("SELECT id FROM users WHERE peran = 'karyawan'").map(x => x.id);
  // Produk laris per unit usaha, supaya omzet tiap unit terisi (buket paling banyak)
  const prod = all("SELECT id, harga, kategori FROM products WHERE harga BETWEEN 25000 AND 1500000 ORDER BY id");
  const perUnit = {}; for (const p of prod) (perUnit[unitKategori(p.kategori)] ||= []).push(p);
  for (const u of Object.keys(perUnit)) perUnit[u] = perUnit[u].filter((_, i) => i % 3 === 0).slice(0, 25);
  const BOBOT = [["bouquet", 55], ["hampers", 15], ["party", 8], ["hantaran", 12], ["papan", 10]].filter(([u]) => perUnit[u] && perUnit[u].length);
  const total = BOBOT.reduce((a, [, w]) => a + w, 0);
  const pilihProduk = () => { let x = r() * total; for (const [u, w] of BOBOT) { if ((x -= w) < 0) return pilih(perUnit[u]); } return pilih(perUnit.bouquet); };
  const hari = hariIni();
  for (let d = 13; d >= 0; d--) {
    const tgl = tambahHari(hari, -d), n = d === 0 ? 4 : 3 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const items = Array.from({ length: 1 + Math.floor(r() * 2) }, () => { const p = pilihProduk(); return { product_id: p.id, harga: p.harga, qty: 1, ready: 0, pembuat_id: pilih(staf) }; });
      const pesan = d === 0 && i < 2 ? { tgl: tambahHari(hari, 1 + i), jam: i ? "16:00" : "10:00", cara: i ? "antar" : "ambil", request: i ? "Kartu ucapan: Selamat ulang tahun!" : "Warna pink pastel" } : null;
      const x = await api("POST", "/api/penjualan", { tgl, items, pelanggan: pilih(PELANGGAN), hp: "0812" + String(10000000 + Math.floor(r() * 89999999)), metode: pilih(["Tunai", "Transfer", "QRIS", "QRIS"]), pesanan: pesan || undefined });
      if (x.status === 200 && x.data && x.data.id) run("UPDATE sales SET jam = ? WHERE id = ?", [`${String(9 + Math.floor(r() * 11)).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}`, x.data.id]);
    }
    if (d % 4 === 1) await api("POST", "/api/pengeluaran", { tgl, kategori: pilih(["Belanja Bahan", "Operasional", "Transport / Ongkir"]), ket: pilih(["Bunga segar", "Kertas buket & pita", "Bensin antar pesanan"]), nominal: 50000 + Math.floor(r() * 30) * 5000 });
  }
  run("DELETE FROM sessions");
  run("DELETE FROM outbox"); // demo tidak mengirim ke Google Sheet
  return true;
}

/* ---- Alamat API khusus demo (404 di toko asli) ---- */
const wajibDemo = () => { if (!demoAktif()) throw new HttpError(404, "Alamat API tidak dikenal"); };
route("GET", "/api/demo/info", false, () => { wajibDemo(); return { demo: true, merek: MEREK_DEMO, wa: WA_DEMO }; });
/** Masuk tanpa password sebagai pemilik (semua menu) atau kasir (menu karyawan). */
route("POST", "/api/demo/masuk", false, ({ body, ctx }) => {
  wajibDemo();
  const u = one(body.peran === "kasir" ? "SELECT id FROM users WHERE nama_key = 'sari'" : "SELECT id FROM users WHERE nama_key = 'pemilik'");
  if (!u) throw new HttpError(404, "Akun demo tidak ada");
  run("UPDATE users SET aktif = 1 WHERE id = ?", [u.id]);
  buatSesi(ctx, u.id);
  return { ok: true };
});
