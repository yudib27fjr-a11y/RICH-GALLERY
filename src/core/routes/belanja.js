/* Belanja online (Shopee, dll.) → barang toko.
   - Email pesanan Shopee yang diteruskan ke belanja@richgallery.my.id dibaca otomatis (Cloudflare Email Worker),
     atau isi emailnya ditempel admin di aplikasi. Hanya barang yang berhubungan dengan barang toko (bahan/produk)
     yang dicatat; email tanpa barang toko diabaikan.
   - Belanja berstatus "kirim" (dalam pengiriman) sampai barang datang & dikonfirmasi ulang:
     jumlah diterima dicek, lalu stok bertambah & pengeluaran "Belanja Bahan" tercatat.
   - Disimpan di server pusat; perangkat kasir mengaksesnya lewat server. */
import { route } from "../router.js";
import { one, all, run, tx } from "../db.js";
import { bad, notFound, teks, angka, tanggal, sekarang } from "../util.js";
import { ubahStok, antre } from "../stok.js";
import { cabangAktif, mintaPusat, sinkronCabang } from "../cabang-perangkat.js";
import { antreNotif } from "../notif.js";
import { KAT_BAHAN } from "../../../public/shared.js";

const TABEL = { produk: "products", bahan: "materials" };
const uang = s => { const d = String(s || "").replace(/[^\d]/g, ""); return d ? Number(d) : 0; };

/* ---------- Membaca email Shopee ---------- */
/** Teks email (sudah polos) → rincian pesanan, atau null bila bukan email pesanan Shopee. */
export function bacaEmailShopee(isi, subjek = ""){
  const L0 = String(isi || "").replace(/\r/g, "").split("\n").map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  // Email HTML: nomor urut barang kadang di sel sendiri ("1." lalu nama di baris berikutnya) → gabungkan
  const L = []; for (let i = 0; i < L0.length; i++) { if (/^\d{1,3}\.$/.test(L0[i]) && L0[i + 1]) { L.push(L0[i] + " " + L0[i + 1]); i++; } else L.push(L0[i]); }
  const semua = L.join("\n");
  if (!/shopee/i.test(semua + subjek) || !/No\.?\s*Pesanan/i.test(semua)) return null;
  const nilai = (label, dari = 0, sampai = L.length) => {
    for (let i = dari; i < sampai; i++) {
      const m = L[i].match(new RegExp("^" + label + "\\s*:?\\s*(.*)$", "i"));
      if (m) return (m[1] || (L[i + 1] && !/:\s*$/.test(L[i + 1]) ? L[i + 1] : "")).trim();
    }
    return "";
  };
  const no = (nilai("No\\.?\\s*Pesanan").match(/#?\s*([0-9A-Z]{10,20})/i) || subjek.match(/#?([0-9]{6}[0-9A-Z]{6,14})/) || [])[1];
  if (!no) return null;
  const tglM = nilai("Tanggal Pemesanan").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const tgl = tglM ? `${tglM[3]}-${tglM[2].padStart(2, "0")}-${tglM[1].padStart(2, "0")}` : sekarang().tgl;
  const iSub = L.findIndex(x => /^Subtotal/i.test(x));
  const iRinci = Math.max(0, L.findIndex(x => /RINCIAN PESANAN/i.test(x)));
  const items = [];
  for (let i = iRinci; i < (iSub > 0 ? iSub : L.length); i++) {
    const m = L[i].match(/^(\d{1,3})\.\s+(.{3,})$/);
    if (!m || /^No\./i.test(L[i])) continue;
    let j = i + 1; const akhir = Math.min(L.length, i + 12);
    let k = j; while (k < akhir && !/^\d{1,3}\.\s+/.test(L[k]) && !/^Subtotal/i.test(L[k])) k++;
    const variasi = nilai("Variasi", j, k), qty = Number((nilai("Jumlah", j, k).match(/[\d.,]+/) || ["1"])[0].replace(/[.,]/g, "")) || 1;
    items.push({ nama: m[2].slice(0, 160), variasi: variasi.slice(0, 80), qty, harga: uang(nilai("Harga", j, k)) });
  }
  if (!items.length) return null;
  const batal = /dibatalkan|pembatalan/i.test(subjek) || /pesanan(mu)? (telah )?dibatalkan/i.test(semua);
  return {
    no: no.toUpperCase(), tgl, toko: nilai("Penjual").slice(0, 80) || "Shopee", items,
    subtotal: uang(nilai("Subtotal")), ongkir: uang(nilai("Ongkos Kirim")), biaya: uang(nilai("Biaya Layanan")),
    // Email "telah dikirim / tiba" kadang tanpa total → pakai jumlah harga barang
    total: uang(nilai("Total Pembayaran")) || uang(nilai("Total Dibayarkan")) || items.reduce((a, i) => a + (i.harga || 0) * (i.qty || 1), 0),
    metode: /COD|Cash On Delivery/i.test(semua + subjek) ? "COD" : (nilai("Metode Pembayaran").replace(/^\d+$/, "") || "Shopee").slice(0, 40), batal,
  };
}

/* ---------- Apakah barangnya barang toko? ---------- */
/* Dicocokkan per KATA UTUH (bukan potongan kata: "TAS" tidak cocok dengan "KUALITAS"). */
const KATA_TOKO = ["BUNGA", "MAWAR", "ROSE", "ROSES", "TULIP", "LILY", "ANGGREK", "DAISY", "BABY BREATH", "BABYBREATH", "DAUN", "ARTIFICIAL", "ARTIFISIAL", "PAMPAS", "HYDRANGEA",
  "KERTAS BUKET", "KERTAS BUNGA", "WRAPPING", "CELLOPHANE", "SELOFAN", "CELOFAN", "MIKA", "TISSUE BUNGA", "PITA SATIN", "PITA", "RIBBON", "BALON", "BALLOON", "BALLOONS", "FOIL", "BONEKA",
  "AKRILIK", "ACRYLIC", "BLOOM BOX", "GIFT BOX", "HAMPERS", "BUKET", "BOUQUET", "FLORAL", "FLORIST", "FLORIS", "OASIS", "FOAM", "KAWAT", "SELOTIP", "DOUBLE TAPE", "LEM TEMBAK",
  "GLUE GUN", "STANDING FLOWER", "PAPAN BUNGA", "PAPAN UCAPAN", "VAS", "TERARIUM", "TRAY", "SESERAHAN", "HANTARAN", "MAHAR", "TUMBLR", "KARTU UCAPAN", "GREETING CARD",
  "STIKER", "STICKER", "PAPER BAG", "PAPERBAG", "GOODIE BAG", "MUTIARA", "GLITTER"];
/* Kata yang menandakan barang pribadi (bukan untuk toko) — kecuali judulnya jelas barang florist (KUAT). */
const KATA_PRIBADI = ["TUMBLER", "BOTOL MINUM", "SEDOTAN", "TERMOS", "BAJU", "KAOS", "KEMEJA", "BLOUSE", "CELANA", "ROK", "DRESS", "GAMIS", "HIJAB", "JILBAB", "KERUDUNG", "PASHMINA",
  "MUKENA", "SEPATU", "SANDAL", "SENDAL", "SNEAKERS", "SKINCARE", "SERUM", "TONER", "MOISTURIZER", "SUNSCREEN", "LIPSTIK", "LIPSTICK", "LIP TINT", "LIP CREAM", "MASKARA", "MASCARA",
  "BEDAK", "CUSHION", "FOUNDATION", "PARFUM", "PERFUME", "SABUN", "SHAMPOO", "SAMPO", "KOSMETIK", "MAKEUP", "MAKE UP", "CASING", "SOFTCASE", "HARDCASE", "CASE HP", "CHARGER",
  "KABEL DATA", "EARPHONE", "HEADSET", "TWS", "POWERBANK", "POWER BANK", "HANDPHONE", "DOMPET", "JAM TANGAN", "KACAMATA", "SPREI", "SPREAD", "BANTAL", "GULING", "HANDUK", "PANCI",
  "WAJAN", "PIRING", "MANGKOK", "SENDOK", "POPOK", "DIAPERS", "SUSU", "VITAMIN", "SUPLEMEN", "OBAT", "MASKER WAJAH", "HANDBAG", "SLING BAG", "TOTE BAG", "RANSEL", "BACKPACK",
  "MAINAN ANAK", "KAUS KAKI", "PIYAMA", "LINGERIE", "BRA", "CELANA DALAM", "HELM", "JAKET", "SWEATER", "HOODIE"];
const KATA_KUAT = ["BUNGA", "FLORAL", "FLORIST", "FLORIS", "BUKET", "BOUQUET", "WRAPPING", "BALON", "BALLOON", "OASIS", "BLOOM BOX", "SESERAHAN", "HANTARAN", "MAHAR", "STANDING FLOWER", "PAPAN BUNGA", "CELLOPHANE"];
const adaKata = (N, w) => new RegExp(`(^| )${w}( |$)`).test(N);
const normal = s => " " + String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim() + " ";
/** Nama barang yang pernah di-"Abaikan" admin → otomatis diabaikan lagi. */
function namaDiabaikan(){
  const set = new Set();
  for (const r of all("SELECT items FROM belanja WHERE status = 'abaikan' AND alasan = 'Diabaikan admin' ORDER BY id DESC LIMIT 300")) {
    try { for (const i of JSON.parse(r.items || "[]")) set.add(normal(i.nama).trim()); } catch { /* abaikan */ }
  }
  return set;
}
const kata = s => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 3);
/* Warna: barang toko berwarna (mis. "Mawar Putih") hanya cocok dengan belanja berwarna sama. */
const WARNA = { PUTIH: "PUTIH", WHITE: "PUTIH", PINK: "PINK", MERAH: "MERAH", RED: "MERAH", KUNING: "KUNING", YELLOW: "KUNING", BIRU: "BIRU", BLUE: "BIRU", UNGU: "UNGU", PURPLE: "UNGU",
  LILAC: "UNGU", HIJAU: "HIJAU", GREEN: "HIJAU", SAGE: "HIJAU", HITAM: "HITAM", BLACK: "HITAM", ORANGE: "ORANGE", JINGGA: "ORANGE", PEACH: "PEACH", CREAM: "CREAM", KREM: "CREAM",
  GOLD: "GOLD", EMAS: "GOLD", SILVER: "SILVER", PERAK: "SILVER", MAROON: "MAROON", COKLAT: "COKLAT", BROWN: "COKLAT", NUDE: "NUDE", SALEM: "PEACH", TOSCA: "BIRU", NAVY: "BIRU" };
const warnaDari = s => new Set(kata(s).map(w => WARNA[w]).filter(Boolean));
const BUKAN = new Set(["DAN", "THE", "FOR", "DENGAN", "UNTUK", "ISI", "PCS", "PREMIUM", "MURAH", "READY", "STOCK", "STOK", "IMPORT", "BESAR", "KECIL", "WARNA", ...Object.keys(WARNA), "SOFT", "CABANG", "TANGKAI", "DEKORASI", "ESTETIK", "AESTHETIC", "MODEL", "BAHAN", "SET", "ORIGINAL", "TERMURAH", "PAKET", "SIZE", "UKURAN"]);
/** Cari barang toko yang paling cocok dengan nama barang belanja. */
export function cocokkanBarang(nama, { abaikan = null } = {}){
  const N = normal(nama);
  const kuat = KATA_KUAT.some(w => adaKata(N, w)), pribadi = KATA_PRIBADI.find(w => adaKata(N, w));
  if ((pribadi && !kuat) || (abaikan && abaikan.has(N.trim()))) return { toko: false, kata: "", pribadi: pribadi || "pernah diabaikan", barang: null };
  const k = new Set(kata(nama).filter(w => !BUKAN.has(w))), wq = warnaDari(nama);
  let terbaik = null;
  for (const jenis of ["bahan", "produk"]) {
    for (const b of all(`SELECT id, kode, nama, kategori FROM ${TABEL[jenis]} WHERE dihapus IS NULL`)) {
      const kb = kata(b.nama).filter(w => !BUKAN.has(w)), wb = warnaDari(b.nama);
      if (!kb.length) continue;
      if (wb.size && wq.size && ![...wb].some(w => wq.has(w))) continue; // beda warna
      const bonusWarna = wb.size && wq.size ? 0.15 : wb.size && !wq.size ? -0.15 : 0;
      const sama = kb.filter(w => k.has(w)).length, skor = sama / kb.length + (sama >= 2 ? 0.2 : 0) + (jenis === "bahan" ? 0.05 : 0) + bonusWarna;
      if (sama && skor >= 0.5 && (!terbaik || skor > terbaik.skor)) terbaik = { jenis, kode: b.kode, nama: b.nama, skor };
    }
  }
  const kunci = KATA_TOKO.find(w => adaKata(N, w)) || [...KAT_BAHAN].find(w => w !== "LAIN-LAIN" && adaKata(N, w)) || "";
  return { toko: !!terbaik || !!kunci, kata: kunci, barang: terbaik ? { jenis: terbaik.jenis, kode: terbaik.kode, nama: terbaik.nama } : null };
}

/* ---------- Simpan ---------- */
const muat = id => { const b = one("SELECT * FROM belanja WHERE id = ?", [+id]); if (!b) throw notFound("Belanja tidak ditemukan"); b.items = JSON.parse(b.items || "[]"); return b; };
const untuk = (b, user) => {
  if (user && user.peran === "admin") return b;
  // harga belanja, nama toko penjual & nomor pesanan hanya untuk admin
  const { subtotal, ongkir, biaya, total, nominal_bayar, toko, no_pesanan, alasan, ...x } = b;
  return { ...x, toko: "", no_pesanan: "", items: b.items.map(({ harga, ...i }) => i) };
};
/** Catat belanja dari email/tempelan. Pesanan yang sama (nomor sama) tidak dobel; email berikutnya hanya memperbarui. */
export function catatBelanja(p, { sumber = "shopee", oleh = "email" } = {}){
  return tx(() => {
    const abaikan = namaDiabaikan();
    const items = p.items.map(i => { const c = cocokkanBarang(`${i.nama} ${i.variasi || ""}`, { abaikan }); if (abaikan.has(normal(i.nama).trim())) Object.assign(c, { toko: false, barang: null }); return { ...i, toko: c.toko, kata: c.kata, barang: c.barang }; });
    const relevan = items.some(i => i.toko);
    const ada = one("SELECT id, status FROM belanja WHERE sumber = ? AND no_pesanan = ?", [sumber, p.no]);
    if (ada) {
      if (p.batal && ada.status === "kirim") run("UPDATE belanja SET status = 'batal', alasan = 'Dibatalkan di Shopee' WHERE id = ?", [ada.id]);
      return { id: ada.id, baru: false, relevan };
    }
    const status = p.batal ? "batal" : relevan ? "kirim" : "abaikan";
    const id = Number(run(`INSERT INTO belanja(sumber, no_pesanan, toko, tgl, items, subtotal, ongkir, biaya, total, metode, status, alasan, oleh)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [sumber, p.no, p.toko, p.tgl, JSON.stringify(items), p.subtotal || 0, p.ongkir || 0, p.biaya || 0, p.total || 0, p.metode || "",
      status, relevan ? null : "Tidak ada barang toko", oleh]).lastInsertRowid);
    if (status === "kirim") {
      const brg = items.filter(i => i.toko).map(i => `${i.nama.slice(0, 40)}${i.variasi ? " (" + i.variasi + ")" : ""} ×${i.qty}`).join(", ");
      antreNotif(`🛒 Belanja ${sumber === "shopee" ? "Shopee" : "online"} tercatat · ${p.toko}`, `${brg}\nDalam pengiriman — konfirmasi saat barang datang`, "/#belanja");
    }
    return { id, baru: true, relevan, status };
  });
}
/** Email masuk lain (mis. kode konfirmasi penerusan Gmail) disimpan supaya admin bisa membacanya. */
export function simpanSurat(dari, subjek, isi){
  run("INSERT INTO surat(dari, subjek, isi) VALUES (?,?,?)", [String(dari).slice(0, 200), String(subjek).slice(0, 300), String(isi).slice(0, 20000)]);
  run("DELETE FROM surat WHERE id NOT IN (SELECT id FROM surat ORDER BY id DESC LIMIT 20)");
}
/** Dipanggil Email Worker untuk setiap email yang masuk ke alamat belanja. */
export function terimaEmail({ dari = "", subjek = "", teks: isi = "" }){
  const p = bacaEmailShopee(isi, subjek);
  if (!p) { simpanSurat(dari, subjek, isi); return { ok: true, jenis: "lain" }; }
  return { ok: true, jenis: "shopee", ...catatBelanja(p) };
}

/* ---------- Konfirmasi barang datang ---------- */
function datang(id, body, user){
  return tx(() => {
    const b = muat(id);
    if (b.status !== "kirim") throw bad("Belanja ini tidak sedang dalam pengiriman");
    const terima = Array.isArray(body.items) ? body.items : [];
    const tgl = sekarang().tgl, ref = `Belanja ${b.sumber === "shopee" ? "Shopee " : ""}#${b.no_pesanan || b.id}`;
    const hasil = b.items.map((it, i) => {
      const t = terima.find(x => +x.i === i) || {};
      const qtyDatang = angka(t.datang ?? it.qty, { min: 0, max: 1e7, nama: `Jumlah datang ${it.nama}` }) ?? 0;
      let masuk = null;
      if (t.jenis && t.kode && qtyDatang > 0) {
        if (!TABEL[t.jenis]) throw bad("Jenis barang tidak valid");
        const item = one(`SELECT id, kode, nama, stok FROM ${TABEL[t.jenis]} WHERE kode = ? AND dihapus IS NULL`, [String(t.kode)]);
        if (!item) throw bad(`Barang ${t.kode} tidak ada`);
        const qtyStok = angka(t.stok ?? qtyDatang, { min: 0.01, max: 1e7, nama: `Jumlah masuk stok ${item.nama}` });
        ubahStok({ jenis: t.jenis, item, delta: qtyStok, tipe: "masuk", tgl, ref: "Belanja online", ket: "Belanja online", user }); // tanpa nama toko: riwayat stok terlihat karyawan
        antre("masuk", [[tgl, sekarang().jam, t.jenis.toUpperCase(), item.kode, item.nama, qtyStok, item.stok, "Belanja online", user.nama]]);
        masuk = { jenis: t.jenis, kode: item.kode, nama: item.nama, qty: qtyStok };
      }
      return { ...it, datang: qtyDatang, masuk };
    });
    let expenseId = null, nominal = 0;
    const totalB = b.total || b.items.reduce((a, i) => a + (i.harga || 0) * (i.qty || 1), 0);
    if (user.peran === "admin" && body.catat_biaya !== false) nominal = angka(body.nominal ?? totalB, { min: 0, max: 1e11, bulat: true, nama: "Nominal belanja" }) ?? 0;
    else if (body.catat_biaya !== false) nominal = totalB || 0; // karyawan: sesuai total pesanan
    if (nominal > 0) {
      const ket = `${ref} · ${b.toko}`.slice(0, 200);
      expenseId = Number(run("INSERT INTO expenses(tgl, kategori, ket, nominal, user_id, oleh) VALUES (?,?,?,?,?,?)", [tgl, "Belanja Bahan", ket, nominal, user.id, user.nama]).lastInsertRowid);
      antre("pengeluaran", [[String(expenseId), tgl, "Belanja Bahan", ket, nominal, user.nama]]);
    }
    const catatan = teks(body.catatan, { max: 300, nama: "Catatan" });
    run("UPDATE belanja SET status = 'datang', items = ?, datang_at = ?, datang_oleh = ?, expense_id = ?, nominal_bayar = ?, catatan = ? WHERE id = ?",
      [JSON.stringify(hasil), `${tgl} ${sekarang().jam}`, user.nama, expenseId, nominal || null, catatan || null, b.id]);
    return { ok: true, masuk: hasil.filter(x => x.masuk).length, nominal };
  });
}

/* ---------- Rute (di perangkat kasir diteruskan ke server pusat) ---------- */
const AKSI = {
  daftar: ({ status }, user) => all(`SELECT * FROM belanja WHERE status = ? ORDER BY ${status === "kirim" ? "tgl, id" : "id DESC"} LIMIT 200`, [["kirim", "datang", "abaikan", "batal"].includes(status) ? status : "kirim"])
    .map(b => untuk({ ...b, items: JSON.parse(b.items || "[]") }, user)),
  hitung: () => ({ kirim: one("SELECT COUNT(*) n FROM belanja WHERE status = 'kirim'").n }),
  datang: ({ id, data }, user) => datang(id, data || {}, user),
  status: ({ id, status }, user) => {
    if (user.peran !== "admin") throw bad("Hanya admin");
    if (!["kirim", "abaikan", "batal"].includes(status)) throw bad("Status tidak valid");
    const b = muat(id); if (b.status === "datang") throw bad("Belanja yang sudah datang tidak bisa diubah");
    run("UPDATE belanja SET status = ?, alasan = ? WHERE id = ?", [status, status === "kirim" ? null : status === "batal" ? "Dibatalkan" : "Diabaikan admin", b.id]);
    return { ok: true };
  },
  tempel: ({ isi }, user) => {
    if (user.peran !== "admin") throw bad("Hanya admin");
    const p = bacaEmailShopee(isi);
    if (!p) throw bad("Teks tidak dikenali sebagai email / rincian pesanan Shopee. Salin seluruh isi email (dari \"No. Pesanan\" sampai \"Total Pembayaran\").");
    const r = catatBelanja(p, { oleh: user.nama });
    return { ...r, toko: p.toko, no: p.no, barang: p.items.length };
  },
  manual: ({ data }, user) => {
    const d = data || {};
    const items = (Array.isArray(d.items) ? d.items : []).filter(i => i && String(i.nama || "").trim()).map(i => ({ nama: teks(i.nama, { wajib: true, max: 160, nama: "Nama barang" }), variasi: teks(i.variasi, { max: 80 }) || "",
      qty: angka(i.qty, { min: 0.01, max: 1e7, wajib: true, nama: "Jumlah" }), harga: user.peran === "admin" ? (angka(i.harga, { min: 0, max: 1e10, bulat: true, nama: "Harga" }) ?? 0) : 0 }));
    if (!items.length) throw bad("Isi minimal satu barang");
    const sub = items.reduce((a, i) => a + i.harga * i.qty, 0), ongkir = user.peran === "admin" ? (angka(d.ongkir, { min: 0, max: 1e9, bulat: true }) ?? 0) : 0;
    const no = teks(d.no, { max: 30, nama: "No pesanan" }) || `M${Date.now().toString(36).toUpperCase()}`;
    if (one("SELECT 1 x FROM belanja WHERE sumber = ? AND no_pesanan = ?", ["manual", no])) throw bad("Nomor pesanan itu sudah dicatat");
    const id = Number(run(`INSERT INTO belanja(sumber, no_pesanan, toko, tgl, items, subtotal, ongkir, biaya, total, metode, status, oleh) VALUES ('manual',?,?,?,?,?,?,0,?,?,'kirim',?)`,
      [no, teks(d.toko, { max: 80, nama: "Toko" }) || "Belanja online", tanggal(d.tgl || sekarang().tgl), JSON.stringify(items.map(i => { const c = cocokkanBarang(i.nama); return { ...i, toko: true, kata: c.kata, barang: c.barang }; })),
        Math.round(sub), ongkir, Math.round(sub + ongkir), teks(d.metode, { max: 40 }) || "", user.nama]).lastInsertRowid);
    return { id };
  },
  hapus: ({ id }, user) => { if (user.peran !== "admin") throw bad("Hanya admin"); const b = muat(id); if (b.status === "datang") throw bad("Belanja yang sudah datang tidak bisa dihapus (stok sudah masuk)"); run("DELETE FROM belanja WHERE id = ?", [b.id]); return { ok: true }; },
  surat: (_, user) => { if (user.peran !== "admin") throw bad("Hanya admin"); return all("SELECT id, dari, subjek, isi, waktu FROM surat ORDER BY id DESC LIMIT 10"); },
};
const jalankanAksi = async (aksi, data, user) => {
  if (!cabangAktif()) return AKSI[aksi](data, user);
  const nk = (one("SELECT nama_key FROM users WHERE id = ?", [user.id]) || {}).nama_key || "";
  const r = await mintaPusat("/api/cabang/belanja", { aksi, data, user: { nama_key: nk } });
  if (aksi === "datang") await sinkronCabang({ paksa: true }).catch(() => {}); // stok & pengeluaran terbaru dari server
  return r;
};
route("GET", "/api/belanja", "semua", ({ query, user }) => jalankanAksi("daftar", { status: query.status || "kirim" }, user));
route("GET", "/api/belanja/hitung", "semua", ({ user }) => jalankanAksi("hitung", {}, user));
route("POST", "/api/belanja", "semua", ({ body, user }) => jalankanAksi("manual", { data: body }, user));
route("POST", "/api/belanja/tempel", "admin", ({ body, user }) => jalankanAksi("tempel", { isi: String(body.isi || "").slice(0, 100000) }, user), { batas: 300_000 });
route("POST", "/api/belanja/:id/datang", "semua", ({ params, body, user }) => jalankanAksi("datang", { id: +params.id, data: body }, user));
route("POST", "/api/belanja/:id/status", "admin", ({ params, body, user }) => jalankanAksi("status", { id: +params.id, status: body.status }, user));
route("DELETE", "/api/belanja/:id", "admin", ({ params, user }) => jalankanAksi("hapus", { id: +params.id }, user));
route("GET", "/api/belanja/surat", "admin", ({ user }) => jalankanAksi("surat", {}, user));

/** Dipakai server pusat untuk permintaan dari perangkat kasir (pengguna perangkat dicocokkan dengan nama). */
export function aksiBelanjaDariPerangkat(aksi, data, userPerangkat){
  if (!AKSI[aksi]) throw bad("Aksi tidak dikenal");
  const u = one("SELECT id, nama, peran FROM users WHERE nama_key = ? AND aktif = 1", [String(userPerangkat && userPerangkat.nama_key || "")]);
  if (!u) throw bad("Pengguna perangkat tidak dikenal di server");
  return AKSI[aksi](data || {}, u);
}
