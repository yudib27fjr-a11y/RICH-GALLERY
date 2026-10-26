/* Promosi & pengingat tugas.
   - Menu Promosi: rencana promosi toko (diskon, giveaway, iklan, endorse, dll.) dengan dana promosi; minimal N promosi per bulan.
     Dibuka admin & penanggung jawab promosi (bawaan: Iza). Dana yang dikeluarkan dicatat admin sebagai pengeluaran "Promosi".
   - Pengingat: karyawan wajib konten (bawaan: Wulan, minimal 2 video/minggu) & penanggung jawab promosi diingatkan di aplikasi;
     HP admin mendapat notifikasi saat toko tutup bila target belum tercapai.
   - Disimpan di server pusat; perangkat kasir mengaksesnya lewat server. */
import { route } from "../router.js";
import { one, all, run, tx, getSettings, setSetting } from "../db.js";
import { HttpError, bad, notFound, teks, angka, tanggal, sekarang } from "../util.js";
import { antre } from "../stok.js";
import { antreNotif } from "../notif.js";
import { platform } from "../platform.js";
import { cabangAktif, mintaPusat } from "../cabang-perangkat.js";
import { mingguDari, klaimKonten } from "./konten.js";
import { jamTutupToko } from "./produksi.js";

export const JENIS_PROMO = ["Diskon", "Promo bundling", "Giveaway", "Iklan IG / TikTok", "Endorse / KOL", "Brosur / banner", "Promo hari besar", "Lainnya"];
const STATUS_PROMO = ["rencana", "jalan", "selesai", "batal"];
const rp = n => "Rp" + Math.round(n || 0).toLocaleString("id-ID");

/* ---------- pengaturan tugas ---------- */
const userAktif = id => id ? one("SELECT id, nama FROM users WHERE id = ? AND aktif = 1", [+id]) : null;
const userNama = k => one("SELECT id, nama FROM users WHERE nama_key = ? AND aktif = 1", [k]);
/** { pic: {id,nama}|null, minPromosi, wajib: [{id,nama,min}] } — bawaan: PJ promosi Iza, wajib konten Wulan 2×/minggu. */
export function setelanTugas(s = getSettings()){
  const t = s.tugas || {};
  const pic = t.pic_promosi_id !== undefined ? userAktif(t.pic_promosi_id) : userNama("iza");
  const daftar = Array.isArray(t.wajib_konten) ? t.wajib_konten : (() => { const w = userNama("wulan"); return w ? [{ user_id: w.id, min: 2 }] : []; })();
  const wajib = daftar.map(x => { const u = userAktif(x.user_id); return u ? { id: u.id, nama: u.nama, min: Math.max(1, Number(x.min) || 1) } : null; }).filter(Boolean);
  return { pic, minPromosi: Math.max(1, Number(t.min_promosi_bulan) || 1), wajib };
}
const bulanIni = () => sekarang().tgl.slice(0, 7);
const jumlahPromosiBulan = bulan => (one("SELECT COUNT(*) n FROM promosi WHERE status != 'batal' AND substr(mulai, 1, 7) = ?", [bulan]) || {}).n || 0;
const kontenMinggu = (userId, tgl = sekarang().tgl) => {
  const [a, b] = mingguDari(tgl);
  return (one("SELECT COUNT(*) n FROM konten WHERE user_id = ? AND status IN ('hitung', 'kembar', 'batas') AND tgl BETWEEN ? AND ?", [userId, a, b]) || {}).n || 0;
};
const bolehPromosi = (user, t = setelanTugas()) => user.peran === "admin" || (t.pic && t.pic.id === user.id);

/* ---------- aksi (dipakai langsung di server, atau lewat server dari perangkat kasir) ---------- */
const promo = id => { const p = one("SELECT * FROM promosi WHERE id = ?", [+id]); if (!p) throw notFound("Promosi tidak ditemukan"); return p; };
function rapikanPromo(d){
  const mulai = tanggal(d.mulai, { nama: "Tanggal mulai" }), selesai = d.selesai ? tanggal(d.selesai, { nama: "Tanggal selesai" }) : mulai;
  if (selesai < mulai) throw bad("Tanggal selesai sebelum tanggal mulai");
  return {
    judul: teks(d.judul, { wajib: true, max: 120, nama: "Nama promosi" }), jenis: teks(d.jenis, { max: 40, nama: "Jenis" }) || "Lainnya",
    mulai, selesai, dana: angka(d.dana ?? 0, { min: 0, max: 1e10, bulat: true, nama: "Dana promosi" }) ?? 0,
    ket: teks(d.ket, { max: 1000, nama: "Keterangan" }) || "", status: STATUS_PROMO.includes(d.status) ? d.status : "rencana",
  };
}
const AKSI = {
  tugas: (_, user) => {
    const t = setelanTugas(), L = [], tgl = sekarang().tgl, [a, b] = mingguDari(tgl);
    const saya = t.wajib.find(w => w.id === user.id);
    if (saya) { const n = kontenMinggu(user.id, tgl); L.push({ jenis: "konten", n, min: saya.min, selesai: n >= saya.min, dari: a, sampai: b }); }
    // Jendela pengingat hanya untuk karyawan yang ditugasi (wajib konten / penanggung jawab promosi), tidak untuk admin.
    if (t.pic && t.pic.id === user.id) { const n = jumlahPromosiBulan(bulanIni()); L.push({ jenis: "promosi", n, min: t.minPromosi, selesai: n >= t.minPromosi, bulan: bulanIni(), pic: t.pic.nama }); }
    return L;
  },
  daftar: ({ bulan }, user) => {
    const t = setelanTugas(); if (!bolehPromosi(user, t)) throw new HttpError(403, "Menu promosi untuk admin & penanggung jawab promosi");
    const bl = /^\d{4}-\d{2}$/.test(bulan || "") ? bulan : bulanIni();
    const daftar = all("SELECT * FROM promosi WHERE substr(mulai, 1, 7) = ? OR substr(selesai, 1, 7) = ? ORDER BY mulai DESC, id DESC", [bl, bl]);
    return { bulan: bl, daftar, jumlah: jumlahPromosiBulan(bl), min: t.minPromosi, pic: t.pic, jenis: JENIS_PROMO, admin: user.peran === "admin" };
  },
  simpan: ({ id, data }, user) => tx(() => {
    if (!bolehPromosi(user)) throw new HttpError(403, "Menu promosi untuk admin & penanggung jawab promosi");
    const d = rapikanPromo(data || {});
    if (id) {
      const p = promo(id);
      run("UPDATE promosi SET judul = ?, jenis = ?, mulai = ?, selesai = ?, dana = ?, ket = ?, status = ? WHERE id = ?", [d.judul, d.jenis, d.mulai, d.selesai, d.dana, d.ket, d.status, p.id]);
      return { id: p.id };
    }
    const nid = Number(run("INSERT INTO promosi(judul, jenis, mulai, selesai, dana, ket, status, oleh, oleh_id) VALUES (?,?,?,?,?,?,?,?,?)",
      [d.judul, d.jenis, d.mulai, d.selesai, d.dana, d.ket, d.status, user.nama, user.id]).lastInsertRowid);
    if (user.peran !== "admin") antreNotif(`📣 Promosi baru · ${d.judul}`, `${d.jenis} · ${d.mulai}${d.selesai !== d.mulai ? " s/d " + d.selesai : ""}${d.dana ? " · dana " + rp(d.dana) : ""}\noleh ${user.nama}`, "/#promosi?baru=1");
    return { id: nid };
  }),
  hapus: ({ id }, user) => tx(() => {
    if (!bolehPromosi(user)) throw new HttpError(403, "Menu promosi untuk admin & penanggung jawab promosi");
    const p = promo(id); if (p.expense_id) throw bad("Dana promosi ini sudah dicatat sebagai pengeluaran. Batalkan saja promosinya.");
    run("DELETE FROM promosi WHERE id = ?", [p.id]); return { ok: true };
  }),
  dana: ({ id, nominal, tgl }, user) => tx(() => {
    if (user.peran !== "admin") throw new HttpError(403, "Hanya admin yang mencatat dana keluar");
    const p = promo(id); if (p.expense_id) throw bad("Dana promosi ini sudah dicatat");
    const n = angka(nominal ?? p.dana, { min: 1, max: 1e10, bulat: true, wajib: true, nama: "Dana promosi" }), t = tanggal(tgl || sekarang().tgl);
    const ket = `Promosi: ${p.judul}`.slice(0, 200);
    const eid = Number(run("INSERT INTO expenses(tgl, kategori, ket, nominal, user_id, oleh) VALUES (?,?,?,?,?,?)", [t, "Promosi", ket, n, user.id, user.nama]).lastInsertRowid);
    antre("pengeluaran", [[String(eid), t, "Promosi", ket, n, user.nama]]);
    run("UPDATE promosi SET expense_id = ?, dana_keluar = ? WHERE id = ?", [eid, n, p.id]);
    return { ok: true, nominal: n };
  }),
  klaim: ({ url }, user) => klaimKonten(url, user),
};
const jalankan = async (aksi, data, user) => {
  if (!cabangAktif()) return AKSI[aksi](data, user);
  const nk = (one("SELECT nama_key FROM users WHERE id = ?", [user.id]) || {}).nama_key || "";
  return mintaPusat("/api/cabang/promosi", { aksi, data, user: { nama_key: nk } });
};
/** Dipakai server pusat untuk permintaan dari perangkat kasir (pengguna dicocokkan dengan nama). */
export function aksiPromosiDariPerangkat(aksi, data, u){
  if (!AKSI[aksi]) throw bad("Aksi tidak dikenal");
  const user = one("SELECT id, nama, peran FROM users WHERE nama_key = ? AND aktif = 1", [String((u && u.nama_key) || "")]);
  if (!user) throw new HttpError(403, "Pengguna perangkat tidak dikenal di server");
  return AKSI[aksi](data, user);
}
route("GET", "/api/tugas-saya", "semua", ({ user }) => jalankan("tugas", {}, user));
route("GET", "/api/promosi", "semua", ({ query, user }) => jalankan("daftar", { bulan: query.bulan }, user));
route("POST", "/api/promosi", "semua", ({ body, user }) => jalankan("simpan", { data: body }, user));
route("PUT", "/api/promosi/:id", "semua", ({ params, body, user }) => jalankan("simpan", { id: +params.id, data: body }, user));
route("DELETE", "/api/promosi/:id", "semua", ({ params, user }) => jalankan("hapus", { id: +params.id }, user));
route("POST", "/api/promosi/:id/dana", "admin", ({ params, body, user }) => jalankan("dana", { id: +params.id, nominal: body.nominal, tgl: body.tgl }, user));
route("POST", "/api/konten/klaim", "semua", ({ body, user }) => jalankan("klaim", { url: body.url }, user));

/* ---------- pengaturan (admin) ---------- */
route("GET", "/api/tugas/setelan", "admin", () => { const t = setelanTugas(); return { pic_promosi_id: t.pic ? t.pic.id : null, min_promosi_bulan: t.minPromosi, wajib_konten: t.wajib.map(w => ({ user_id: w.id, min: w.min })) }; }, { pusatSaja: true });
route("PUT", "/api/tugas/setelan", "admin", ({ body }) => {
  const t = { ...(getSettings().tugas || {}) };
  if (body.pic_promosi_id !== undefined) { if (body.pic_promosi_id && !userAktif(body.pic_promosi_id)) throw bad("Karyawan tidak ditemukan"); t.pic_promosi_id = body.pic_promosi_id ? +body.pic_promosi_id : null; }
  if (body.min_promosi_bulan != null) t.min_promosi_bulan = angka(body.min_promosi_bulan, { min: 1, max: 50, bulat: true, nama: "Minimal promosi per bulan" });
  if (Array.isArray(body.wajib_konten)) t.wajib_konten = body.wajib_konten.slice(0, 20).filter(x => userAktif(x.user_id)).map(x => ({ user_id: +x.user_id, min: angka(x.min, { min: 1, max: 50, bulat: true, nama: "Minimal konten per minggu" }) }));
  setSetting("tugas", t);
  return { ok: true };
}, { pusatSaja: true });

/* ---------- notifikasi admin saat toko tutup ---------- */
/** Sekali sehari saat toko tutup: Jumat & Sabtu ingatkan konten yang kurang; tgl 20, 25 & 28 ingatkan promosi bulan ini yang belum ada. */
export function pengingatTugasHarian(){
  if (platform.perangkat) return;
  const { tgl, jam } = sekarang(), s = getSettings();
  if (jam < jamTutupToko(tgl, s) || s.tugas_notif_tgl === tgl) return;
  setSetting("tugas_notif_tgl", tgl);
  const t = setelanTugas(s), hari = new Date(tgl + "T00:00:00Z").getUTCDay(), tanggalKe = Number(tgl.slice(8));
  if (hari === 5 || hari === 6) {
    const kurang = t.wajib.map(w => ({ ...w, n: kontenMinggu(w.id, tgl) })).filter(w => w.n < w.min);
    if (kurang.length) antreNotif("🎬 Pengingat konten minggu ini", kurang.map(w => `${w.nama}: baru ${w.n} dari minimal ${w.min} konten`).join("\n"), "/#konten?baru=1");
  }
  if ([20, 25, 28].includes(tanggalKe)) {
    const n = jumlahPromosiBulan(tgl.slice(0, 7));
    if (n < t.minPromosi) antreNotif("📣 Promosi bulan ini belum ada", `Baru ${n} dari minimal ${t.minPromosi} promosi bulan ini.${t.pic ? ` Ingatkan ${t.pic.nama}.` : ""}`, "/#promosi?baru=1");
  }
}
