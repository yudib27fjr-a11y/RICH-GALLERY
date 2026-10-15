/* Mode cabang: perangkat (mis. iMin) tetap bekerja offline, lalu transaksi dikirim ke server pusat begitu server bisa dihubungi.
   - Setiap transaksi yang berhasil di perangkat dicatat di tabel cabang_kirim (satu "perintah" dengan uid unik).
   - Perintah dikirim berurutan; server menyimpan uid yang sudah diterima, jadi kiriman ulang tidak pernah tercatat dobel.
   - Setelah antrean kosong, perangkat mengambil data terbaru dari server: produk, bahan, stok, akun, pengaturan toko.
   - Di mode cabang, katalog/akun/pengaturan hanya diubah di server pusat (perangkat menolak dengan pesan jelas). */
import { one, all, run, tx, getSettings, setSetting } from "./db.js";
import { platform } from "./platform.js";
import { HttpError, sekarang } from "./util.js";

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

let jalan = false;
/** Kirim antrean lalu ambil data terbaru. Aman dipanggil kapan saja; tidak berjalan dobel. */
export async function sinkronCabang(){
  if (!cabangAktif() || jalan) return statusCabang();
  jalan = true;
  const s = getSettings();
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
      const snap = await panggil(s.cabang_url, "/api/cabang/tarik", { token: s.cabang_token });
      terapkanSnapshot(snap);
    }
    setSetting("cabang_terakhir", new Date().toISOString());
    setSetting("cabang_galat", "");
  } catch (e) {
    if (e.status === 401) setSetting("cabang_galat", "Perangkat ini sudah dicabut dari server pusat. Sambungkan ulang di Pengaturan.");
    else setSetting("cabang_galat", String(e.message || e).slice(0, 300));
  } finally { jalan = false; }
  return statusCabang();
}

const KOLOM = {
  products: ["nama", "kategori", "harga", "hpp", "stok", "stok_min", "barcode", "insentif", "aktif"],
  materials: ["nama", "kategori", "harga", "satuan", "stok", "stok_min", "barcode"],
};
const SETELAN_TOKO = ["nama_toko", "alamat", "telp", "footer", "prefix", "hpp_persen", "insentif", "periode_mulai"];

/** Samakan katalog, stok, akun, dan pengaturan toko dengan server pusat. */
export function terapkanSnapshot(snap){
  tx(() => {
    if (one("SELECT COUNT(*) n FROM cabang_kirim WHERE terkirim IS NULL").n) return; // ada transaksi baru: tunggu kiriman berikutnya
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
  });
}

/** Sambungkan perangkat ini ke server pusat dengan akun admin server. */
export async function sambungCabang({ url, nama, password, perangkat, paksa }){
  url = String(url || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/\s]+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    throw new HttpError(400, "Alamat server harus diawali https:// (contoh: https://macbook-pro-yudi.tailae4382.ts.net)");
  }
  if (one("SELECT COUNT(*) n FROM cabang_kirim WHERE terkirim IS NULL").n) throw new HttpError(409, "Masih ada transaksi yang menunggu dikirim ke server sebelumnya.");
  const terakhir = one("SELECT no FROM sales ORDER BY id DESC LIMIT 1");
  let j;
  try {
    j = await panggil(url, "/api/cabang/daftar", { nama, password, perangkat: perangkat || "Perangkat kasir", noTerakhir: terakhir ? terakhir.no : "", paksa: !!paksa });
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
  return sinkronCabang();
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
