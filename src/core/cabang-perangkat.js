/* Mode cabang: perangkat (mis. iMin) tetap bekerja offline, lalu transaksi dikirim ke server pusat begitu server bisa dihubungi.
   - Setiap transaksi yang berhasil di perangkat dicatat di tabel cabang_kirim (satu "perintah" dengan uid unik).
   - Perintah dikirim berurutan; server menyimpan uid yang sudah diterima, jadi kiriman ulang tidak pernah tercatat dobel.
   - Setelah antrean kosong, perangkat mengambil data terbaru dari server: produk, bahan, stok, akun, pengaturan toko.
   - Di mode cabang, katalog/akun/pengaturan hanya diubah di server pusat (perangkat menolak dengan pesan jelas). */
import { one, all, run, tx, getSettings, setSetting, tandaiBerubah } from "./db.js";
import { platform } from "./platform.js";
import { HttpError, sekarang } from "./util.js";
import { TABEL_DATA, eksporData } from "./ekspor.js";

export const PESAN_PUSAT = "Perangkat ini tersambung ke server pusat. Ubah data ini di server pusat; hasilnya otomatis masuk ke perangkat ini.";

export function cabangAktif(){
  const s = getSettings();
  return !!(s.cabang_url && s.cabang_token);
}

/** Simpan perintah untuk dikirim ke server. Dipanggil di dalam transaksi yang sama dengan perubahan datanya. */
export function catatPerintah({ aksi, data }, user){
  run("INSERT INTO cabang_kirim(uid, aksi, data, waktu, oleh) VALUES (?,?,?,?,?)",
    [platform.token(), aksi, JSON.stringify(data), JSON.stringify(sekarang()), user?.nama || ""]);
}

let jadwal = null;
/** Kirim sebentar lagi (beberapa transaksi beruntun cukup satu kiriman). */
export function jadwalkanSinkron(ms = 1500){
  if (jadwal) clearTimeout(jadwal);
  jadwal = setTimeout(() => { jadwal = null; sinkronCabang().catch(() => {}); }, ms);
}

const alamat = (url, path) => String(url).replace(/\/+$/, "") + path;

async function panggil(url, path, body){
  let r;
  try {
    r = await platform.http({ method: "POST", url: alamat(url, path), headers: { "Content-Type": "application/json", "X-RG": "1" }, body: JSON.stringify(body) });
  } catch (e) { throw new Error("Server pusat tidak bisa dihubungi: " + (e.message || "tidak tersambung")); }
  let j = null; try { j = JSON.parse(r.text); } catch { /* bukan JSON */ }
  if (r.status < 200 || r.status >= 300) {
    const e = new Error((j && j.error) || `Server pusat menjawab HTTP ${r.status}`);
    e.status = r.status; throw e;
  }
  if (!j) throw new Error("Jawaban server pusat tidak dikenali. Periksa alamat server.");
  return j;
}

/** Ambil data langsung dari server pusat (mis. rekap absensi). Butuh internet. */
export async function mintaPusat(path, body){
  const s = getSettings();
  try { return await panggil(s.cabang_url, path, { token: s.cabang_token, ...body }); }
  catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message); }
}

export function statusCabang(){
  const s = getSettings();
  const n = sql => one(sql).n;
  return {
    aktif: cabangAktif(), url: s.cabang_url || "", kode: s.cabang_kode || "", nama: s.cabang_nama || "",
    menunggu: n("SELECT COUNT(*) n FROM cabang_kirim WHERE terkirim IS NULL"),
    ditolak: n("SELECT COUNT(*) n FROM cabang_kirim WHERE hasil = 'ditolak' AND terkirim > datetime('now', '-7 days')"),
    galatTerakhir: s.cabang_galat || "", terakhir: s.cabang_terakhir || null,
    ditolakDaftar: all("SELECT aksi, galat, dibuat FROM cabang_kirim WHERE hasil = 'ditolak' ORDER BY id DESC LIMIT 5"),
  };
}

let jalan = false, lagi = false, versiServer = "";
/** Kirim antrean lalu ambil data terbaru. Aman dipanggil kapan saja; tidak berjalan dobel
 *  (panggilan yang datang saat sedang berjalan diulang sekali begitu selesai).
 *  Perangkat menyebut versi data terakhir yang ia punya: bila server belum berubah, jawabannya kecil sekali.
 *  paksa: ambil data lengkap sekarang juga (tombol "Sinkron sekarang" / tarik layar ke bawah). */
export async function sinkronCabang({ paksa = false } = {}){
  if (!cabangAktif()) return statusCabang();
  if (jalan) { lagi = true; return statusCabang(); }
  jalan = true;
  const s = getSettings();
  let berubah = false;
  try {
    for (let putaran = 0; putaran < 40; putaran++) {
      const batch = all("SELECT uid, aksi, data, waktu, oleh FROM cabang_kirim WHERE terkirim IS NULL ORDER BY id LIMIT 40");
      if (!batch.length) break;
      const j = await panggil(s.cabang_url, "/api/cabang/kirim", {
        token: s.cabang_token,
        perintah: batch.map(b => ({ uid: b.uid, aksi: b.aksi, data: JSON.parse(b.data), waktu: JSON.parse(b.waktu), oleh: b.oleh })),
      });
      let berhenti = false;
      tx(() => {
        for (const h of j.hasil || []) {
          if (h.status === "ok" || h.status === "ditolak") {
            run("UPDATE cabang_kirim SET terkirim = datetime('now'), hasil = ?, galat = ? WHERE uid = ?", [h.status, h.status === "ditolak" ? String(h.pesan || "").slice(0, 300) : null, h.uid]);
          } else {
            run("UPDATE cabang_kirim SET percobaan = percobaan + 1, galat = ? WHERE uid = ?", [String(h.pesan || "gagal").slice(0, 300), h.uid]);
            berhenti = true;
          }
        }
      });
      if (berhenti || (j.hasil || []).length < batch.length) break; // urutan dijaga: berhenti di perintah yang gagal
    }
    // Ambil data terbaru hanya bila tidak ada yang menunggu, supaya stok lokal tidak tertimpa sebelum transaksinya sampai.
    if (!one("SELECT COUNT(*) n FROM cabang_kirim WHERE terkirim IS NULL").n) {
      const snap = await panggil(s.cabang_url, "/api/cabang/tarik", { token: s.cabang_token, versi: paksa ? "" : versiServer });
      if (snap.perangkat && snap.perangkat !== s.cabang_nama) setSetting("cabang_nama", String(snap.perangkat).slice(0, 40)); // nama diganti di server
      if (!snap.tetap && terapkanSnapshot(snap)) { berubah = true; versiServer = snap.versi || ""; }
    }
    setSetting("cabang_terakhir", new Date().toISOString());
    setSetting("cabang_galat", "");
  } catch (e) {
    if (e.status === 401) setSetting("cabang_galat", "Perangkat ini sudah dicabut dari server pusat. Sambungkan ulang di Pengaturan.");
    else setSetting("cabang_galat", String(e.message || e).slice(0, 300));
  } finally {
    jalan = false;
    if (berubah && pendengar.dataBaru) { try { pendengar.dataBaru(); } catch { /* abaikan */ } }
    if (lagi) { lagi = false; jadwalkanSinkron(200); }
  }
  return { ...statusCabang(), berubah };
}
/** Dipasang mesin lokal: dipanggil setelah data dari server masuk, supaya layar dimuat ulang. */
export const pendengar = { dataBaru: null };

const KOLOM = {
  products: ["nama", "kategori", "harga", "hpp", "stok", "stok_min", "barcode", "insentif", "aktif"],
  materials: ["nama", "kategori", "harga", "satuan", "stok", "stok_min", "barcode"],
};
const SETELAN_TOKO = ["nama_toko", "alamat", "telp", "footer", "prefix", "hpp_persen", "insentif", "periode_mulai", "absen_aktif", "absen_jam_masuk", "absen_jam_pulang", "wa_otomatis", "wa_template"];

/** Samakan katalog, stok, akun, dan pengaturan toko dengan server pusat. */
export function terapkanSnapshot(snap){
  return tx(() => {
    if (one("SELECT COUNT(*) n FROM cabang_kirim WHERE terkirim IS NULL").n) return false; // ada transaksi baru: tunggu kiriman berikutnya
    for (const [tabel, rows] of [["products", snap.produk], ["materials", snap.bahan]]) {
      if (!Array.isArray(rows) || !rows.length) continue; // jangan pernah mengosongkan katalog karena jawaban aneh
      const kol = KOLOM[tabel];
      // Barcode bisa berpindah barang di server: lepas dulu semua, pasang lagi sesuai server.
      run(`UPDATE ${tabel} SET barcode = NULL WHERE dihapus IS NULL`);
      const ada = new Set();
      for (const x of rows) {
        if (!x || !x.kode) continue;
        ada.add(x.kode);
        const lokal = one(`SELECT id FROM ${tabel} WHERE kode = ? AND dihapus IS NULL`, [x.kode]);
        const nilai = kol.map(k => x[k] === undefined ? null : x[k]);
        if (lokal) run(`UPDATE ${tabel} SET ${kol.map(k => `${k} = ?`).join(", ")}, diubah = datetime('now') WHERE id = ?`, [...nilai, lokal.id]);
        else run(`INSERT INTO ${tabel}(kode, ${kol.join(", ")}) VALUES (?, ${kol.map(() => "?").join(", ")})`, [x.kode, ...nilai]);
      }
      for (const r of all(`SELECT id, kode FROM ${tabel} WHERE dihapus IS NULL`)) {
        if (!ada.has(r.kode)) run(`UPDATE ${tabel} SET dihapus = datetime('now') WHERE id = ?`, [r.id]);
      }
    }
    for (const u of Array.isArray(snap.users) ? snap.users : []) {
      if (!u || !u.nama_key) continue;
      const lokal = one("SELECT id FROM users WHERE nama_key = ?", [u.nama_key]);
      if (lokal) run("UPDATE users SET nama = ?, peran = ?, pass_hash = ?, aktif = ? WHERE id = ?", [u.nama, u.peran, u.pass_hash, u.aktif, lokal.id]);
      else run("INSERT INTO users(nama, nama_key, peran, pass_hash, aktif) VALUES (?,?,?,?,?)", [u.nama, u.nama_key, u.peran, u.pass_hash, u.aktif]);
    }
    for (const k of SETELAN_TOKO) if (snap.toko && snap.toko[k] !== undefined) setSetting(k, snap.toko[k]);
    // Penjualan dari perangkat lain / dari server ikut disalin (hanya untuk riwayat & laporan; stok sudah mengikuti server).
    for (const x of Array.isArray(snap.penjualan) ? snap.penjualan : []) {
      if (!x || !x.no) continue;
      const lokal = one("SELECT id, batal_at FROM sales WHERE no = ?", [x.no]);
      const pes = [x.bayar, x.ambil_tgl ?? null, x.ambil_jam ?? null, x.ambil_cara ?? null, x.request ?? null, x.diambil_at ?? null, x.diambil_oleh ?? null, x.lunas_at ?? null, x.lunas_metode ?? null, x.lunas_oleh ?? null];
      if (lokal) {
        if (x.batal_at && !lokal.batal_at) run("UPDATE sales SET batal_at = ?, batal_oleh = ?, batal_alasan = ? WHERE id = ?", [x.batal_at, x.batal_oleh, x.batal_alasan, lokal.id]);
        // Pelunasan & status pengambilan pesanan mengikuti server
        if (x.bayar !== undefined) run("UPDATE sales SET bayar = ?, ambil_tgl = ?, ambil_jam = ?, ambil_cara = ?, request = ?, diambil_at = ?, diambil_oleh = ?, lunas_at = ?, lunas_metode = ?, lunas_oleh = ? WHERE id = ?", [...pes, lokal.id]);
        continue;
      }
      const id = Number(run(`INSERT INTO sales(no, tgl, jam, kasir, pelanggan, hp, subtotal, diskon, ongkir, total, metode, catatan, batal_at, batal_oleh, batal_alasan,
        bayar, ambil_tgl, ambil_jam, ambil_cara, request, diambil_at, diambil_oleh, lunas_at, lunas_metode, lunas_oleh)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?)`, [x.no, x.tgl, x.jam, x.kasir, x.pelanggan, x.hp || "", x.subtotal, x.diskon || 0, x.ongkir || 0, x.total, x.metode, x.catatan || "", x.batal_at, x.batal_oleh, x.batal_alasan, ...pes]).lastInsertRowid);
      for (const it of Array.isArray(x.items) ? x.items : []) {
        const p = it.kode ? one("SELECT id FROM products WHERE kode = ? AND dihapus IS NULL", [it.kode]) : null;
        run("INSERT INTO sale_items(sale_id, product_id, kode, nama, kategori, harga, qty, hpp, ready) VALUES (?,?,?,?,?,?,?,?,?)",
          [id, p ? p.id : null, it.kode || "", it.nama, it.kategori, it.harga, it.qty, it.hpp || 0, it.ready || 0]);
      }
    }
    // Transaksi yang dihapus di server (salah input / uji coba) ikut dihapus di sini. Hanya dalam rentang yang dikirim server,
    // dan hanya bila daftarnya lengkap (tidak terpotong batas).
    const sejak = /^\d{4}-\d{2}-\d{2}$/.test(String(snap.sejak || "")) ? snap.sejak : null;
    if (sejak && Array.isArray(snap.penjualan) && snap.penjualan.length < 5000) {
      const ada = new Set(snap.penjualan.map(x => x && x.no));
      for (const r of all("SELECT id, no FROM sales WHERE tgl >= ?", [sejak])) {
        if (!ada.has(r.no)) { run("DELETE FROM sale_items WHERE sale_id = ?", [r.id]); run("DELETE FROM sales WHERE id = ?", [r.id]); }
      }
    }
    salinKeuangan(snap);
    tandaiBerubah();
    return true;
  });
}

/** Produksi, pengeluaran, dan pembayaran insentif: dalam rentang snap.sejak, isi perangkat disamakan persis dengan server
 *  (termasuk yang dicatat di server atau perangkat lain, dan yang sudah dihapus). Stok tidak disentuh: stok sudah mengikuti server. */
function salinKeuangan(snap){
  const sejak = /^\d{4}-\d{2}-\d{2}$/.test(String(snap.sejak || "")) ? snap.sejak : null;
  if (!sejak) return; // server versi lama
  const idUser = new Map(all("SELECT id, nama_key FROM users").map(u => [u.nama_key, u.id]));
  const idProduk = kode => (one("SELECT id FROM products WHERE kode = ? AND dihapus IS NULL", [kode]) || {}).id ?? null;

  if (Array.isArray(snap.pengeluaran)) {
    const ada = new Set();
    for (const x of snap.pengeluaran) {
      if (!x || !x.kunci) continue;
      ada.add(x.kunci);
      const nilai = [x.tgl, x.kategori, x.ket || "", x.nominal, x.oleh || "", x.dihapus || null];
      const lokal = one("SELECT id FROM expenses WHERE uid = ?", [x.kunci]);
      if (lokal) run("UPDATE expenses SET tgl = ?, kategori = ?, ket = ?, nominal = ?, oleh = ?, dihapus = ? WHERE id = ?", [...nilai, lokal.id]);
      else run("INSERT INTO expenses(tgl, kategori, ket, nominal, oleh, dihapus, uid, dibuat) VALUES (?,?,?,?,?,?,?,?)", [...nilai, x.kunci, x.dibuat || sekarangSql()]);
    }
    for (const r of all("SELECT id, uid FROM expenses WHERE tgl >= ? AND dihapus IS NULL", [sejak])) {
      if (!r.uid || !ada.has(r.uid)) run("DELETE FROM expenses WHERE id = ?", [r.id]);
    }
  }

  if (Array.isArray(snap.produksi)) {
    const ada = new Set();
    for (const x of snap.produksi) {
      const pembuat = x && idUser.get(x.pembuat);
      if (!x || !x.kunci || !pembuat) continue;
      ada.add(x.kunci);
      const nilai = [x.tgl, idProduk(x.kode), x.kode, x.nama, x.qty, pembuat, x.tarif, x.restock ? 1 : 0, x.oleh || ""];
      const lokal = one("SELECT id FROM produksi WHERE uid = ?", [x.kunci]);
      if (lokal) run("UPDATE produksi SET tgl = ?, product_id = ?, kode = ?, nama = ?, qty = ?, pembuat_id = ?, tarif = ?, restock = ?, oleh = ? WHERE id = ?", [...nilai, lokal.id]);
      else run("INSERT INTO produksi(tgl, product_id, kode, nama, qty, pembuat_id, tarif, restock, oleh, uid, dibuat) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [...nilai, x.kunci, x.dibuat || sekarangSql()]);
    }
    for (const r of all("SELECT id, uid FROM produksi WHERE tgl >= ?", [sejak])) {
      if (!r.uid || !ada.has(r.uid)) run("DELETE FROM produksi WHERE id = ?", [r.id]);
    }
  }

  if (Array.isArray(snap.insentif)) {
    for (const x of snap.insentif) {
      const pembuat = x && idUser.get(x.pembuat);
      if (!pembuat || !x.periode_dari) continue;
      const nilai = [x.periode_sampai, x.qty, x.hitung, x.nominal, x.tgl, x.ket || "", x.oleh || ""];
      const lokal = one("SELECT id FROM insentif_bayar WHERE pembuat_id = ? AND periode_dari = ?", [pembuat, x.periode_dari]);
      if (lokal) run("UPDATE insentif_bayar SET periode_sampai = ?, qty = ?, hitung = ?, nominal = ?, tgl = ?, ket = ?, oleh = ? WHERE id = ?", [...nilai, lokal.id]);
      else run("INSERT INTO insentif_bayar(periode_sampai, qty, hitung, nominal, tgl, ket, oleh, pembuat_id, periode_dari) VALUES (?,?,?,?,?,?,?,?,?)", [...nilai, pembuat, x.periode_dari]);
    }
  }
}
const sekarangSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** Kirim seluruh data perangkat ini ke server (yang masih kosong), bertahap supaya tiap kiriman tidak terlalu besar. */
async function unggahAwal(url, token){
  const data = eksporData().tabel;
  const bagian = [];
  for (const t of TABEL_DATA) for (let i = 0; i < Math.max(1, data[t].length); i += 400) bagian.push({ tabel: t, rows: data[t].slice(i, i + 400) });
  for (let i = 0; i < bagian.length; i++) {
    await panggil(url, "/api/cabang/unggah-awal", { token, ...bagian[i], mulai: i === 0, selesai: i === bagian.length - 1 });
  }
}

/** Sambungkan perangkat ini ke server pusat dengan akun admin server.
 *  unggahAwal: server masih baru/kosong → kirim seluruh data perangkat ini ke sana dulu. */
export async function sambungCabang({ url, nama, password, perangkat, paksa, unggahAwal: kirimSemua }){
  url = String(url || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/\s]+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    throw new HttpError(400, "Alamat server harus diawali https:// (contoh: https://macbook-pro-yudi.tailae4382.ts.net)");
  }
  if (one("SELECT COUNT(*) n FROM cabang_kirim WHERE terkirim IS NULL").n) throw new HttpError(409, "Masih ada transaksi yang menunggu dikirim ke server sebelumnya.");
  const terakhir = one("SELECT no FROM sales ORDER BY id DESC LIMIT 1");
  let j;
  try {
    j = await panggil(url, "/api/cabang/daftar", { nama, password, perangkat: perangkat || "Perangkat kasir", noTerakhir: terakhir ? terakhir.no : "", paksa: !!(paksa || kirimSemua), unggahAwal: !!kirimSemua });
    if (kirimSemua) await unggahAwal(url, j.token);
    versiServer = "";
  } catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message); }
  tx(() => {
    setSetting("cabang_url", url);
    setSetting("cabang_token", j.token);
    setSetting("cabang_kode", j.kode);
    setSetting("cabang_nama", j.nama);
    setSetting("cabang_galat", "");
    // Antrean Google Sheet perangkat ini tidak dikirim lagi: server pusat yang mengirim ke sheet.
    run("UPDATE outbox SET terkirim = datetime('now') WHERE terkirim IS NULL");
  });
  return sinkronCabang({ paksa: true });
}

/** Ganti nama perangkat ini di server pusat (butuh internet), lalu simpan di sini. */
export async function gantiNamaPerangkat(nama){
  if (!cabangAktif()) throw new HttpError(409, "Perangkat ini belum tersambung ke server pusat");
  const s = getSettings();
  let j;
  try { j = await panggil(s.cabang_url, "/api/cabang/nama-perangkat", { token: s.cabang_token, nama }); }
  catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message); }
  setSetting("cabang_nama", j.nama || nama);
  return statusCabang();
}

export function putusCabang({ paksa } = {}){
  const n = one("SELECT COUNT(*) n FROM cabang_kirim WHERE terkirim IS NULL").n;
  if (n && !paksa) throw new HttpError(409, `Masih ada ${n} transaksi yang belum terkirim ke server pusat. Sinkronkan dulu, atau putuskan paksa (transaksi itu tidak akan terkirim).`);
  tx(() => {
    for (const k of ["cabang_url", "cabang_token", "cabang_kode", "cabang_nama", "cabang_galat"]) setSetting(k, "");
    if (paksa) run("UPDATE cabang_kirim SET terkirim = datetime('now'), hasil = 'dibatalkan' WHERE terkirim IS NULL");
  });
  return statusCabang();
}
