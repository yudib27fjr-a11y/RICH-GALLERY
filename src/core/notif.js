/* Notifikasi HP untuk admin (Web Push, standar VAPID): transaksi, pesanan & absensi baru.
   - HP admin (Chrome Android, iPhone dari ikon Layar Utama, komputer) berlangganan dari Pengaturan → Notifikasi.
   - Saat ada penjualan, server mencatat notifikasi lalu "membangunkan" HP lewat layanan push (tanpa isi).
     HP (sw.js) lalu mengambil isi notifikasi dari /api/notif/terbaru memakai sesi admin-nya sendiri,
     jadi isi transaksi tidak lewat pihak ketiga dan tidak perlu enkripsi isi.
   - Hanya server pusat yang mengirim. Penjualan dari perangkat kasir ikut dikabari saat sampai di server. */
import { route } from "./router.js";
import { one, all, run, getSettings, setSetting } from "./db.js";
import { platform } from "./platform.js";
import { bad } from "./util.js";

const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const teksB64u = s => b64u(new TextEncoder().encode(s));
/** Layanan push yang dikenal (alamat lain ditolak supaya server tidak bisa disuruh memanggil sembarang alamat). */
const HOST_PUSH = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(\/|$)/i;

/** Kunci VAPID server (dibuat sekali, disimpan di pengaturan; kunci rahasia tidak pernah dikirim ke layar). */
async function kunciVapid(){
  let v = getSettings().vapid;
  if (v && v.publik && v.privat) return v;
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  v = { publik: b64u(await crypto.subtle.exportKey("raw", k.publicKey)), privat: await crypto.subtle.exportKey("jwk", k.privateKey) };
  setSetting("vapid", v);
  return v;
}
async function tokenVapid(endpoint, v){
  const aud = new URL(endpoint).origin;
  const isi = teksB64u(JSON.stringify({ typ: "JWT", alg: "ES256" })) + "." + teksB64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:admin@richgallery.my.id" }));
  const kunci = await crypto.subtle.importKey("jwk", v.privat, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const ttd = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kunci, new TextEncoder().encode(isi));
  return isi + "." + b64u(ttd);
}

const rp = n => "Rp" + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const judulBesar = s => String(s || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
/** Catat satu notifikasi untuk HP admin (dikirim setelah permintaan selesai). Di perangkat kasir tidak dicatat:
 *  server pusat yang mengabari saat datanya sampai. */
export function antreNotif(judul, isi, url = "/"){
  if (platform.perangkat) return;
  if (!one("SELECT 1 x FROM push_langganan LIMIT 1")) return;
  run("INSERT INTO notif(judul, isi, url) VALUES (?,?,?)", [String(judul).slice(0, 120), String(isi).slice(0, 400), url]);
}
/** Catat notifikasi penjualan baru (dipanggil di dalam transaksi database penjualan). */
const LABEL_JENIS = { dekorasi: "🎈 Pesanan dekorasi", sewa: "🔑 Penyewaan", mahar: "💍 Pesanan hias mahar", parcel: "🎁 Pesanan parcel" };
export function antreNotifPenjualan({ id, jenis, total, bayar, metode, pelanggan, items, pesanan, kasir }){
  if (platform.perangkat || !one("SELECT 1 x FROM push_langganan LIMIT 1")) return;
  const barang = items.slice(0, 3).map(i => judulBesar(i.nama) + (i.qty != 1 ? " ×" + i.qty : "")).join(", ") + (items.length > 3 ? `, +${items.length - 3} lagi` : "");
  const plg = pelanggan && pelanggan !== "CUSTOMER" ? judulBesar(pelanggan) : "Pelanggan";
  let judul, isi;
  if (pesanan) {
    const sisa = Math.max(0, total - (bayar || 0));
    judul = `${LABEL_JENIS[jenis] || "📦 Pesanan"} baru · ${rp(total)}`;
    isi = `${plg} · ${pesanan.cara === "antar" ? "diantar" : "diambil"} ${pesanan.tgl}${pesanan.jam ? " " + pesanan.jam : ""}${sisa ? ` · DP ${rp(bayar)}, sisa ${rp(sisa)}` : " · lunas"}\n${barang} · kasir ${judulBesar(kasir)}`;
  } else {
    judul = `🛍️ Transaksi baru · ${rp(total)}`;
    isi = `${plg} · ${metode}\n${barang} · kasir ${judulBesar(kasir)}`;
  }
  antreNotif(judul, isi, `/#riwayat?id=${id}`); // ketuk notifikasi → halaman Transaksi, baris transaksinya disorot
}

let mengirim = false;
/** Bangunkan HP admin untuk notifikasi yang belum dikirim. Aman dipanggil kapan saja (setelah tiap permintaan). */
export async function kirimNotif(){
  if (platform.perangkat || mengirim || !platform.http) return;
  if (!one("SELECT 1 x FROM notif WHERE terkirim IS NULL LIMIT 1")) return;
  mengirim = true;
  try {
    const akhir = one("SELECT MAX(id) id FROM notif WHERE terkirim IS NULL").id;
    run("UPDATE notif SET terkirim = datetime('now') WHERE terkirim IS NULL AND id <= ?", [akhir]);
    const v = await kunciVapid();
    // Satu "bangunan" per HP cukup: HP mengambil semua notifikasi terbaru sekaligus.
    await Promise.all(all("SELECT id, endpoint FROM push_langganan").map(async l => {
      try {
        const r = await platform.http({ method: "POST", url: l.endpoint, body: "", headers: { TTL: "86400", Urgency: "high", Authorization: `vapid t=${await tokenVapid(l.endpoint, v)}, k=${v.publik}` } });
        if (r.status === 404 || r.status === 410) run("DELETE FROM push_langganan WHERE id = ?", [l.id]); // langganan sudah tidak berlaku
        else if (r.status < 300) run("UPDATE push_langganan SET terakhir = datetime('now'), galat = NULL WHERE id = ?", [l.id]);
        else run("UPDATE push_langganan SET galat = ? WHERE id = ?", [`HTTP ${r.status} ${String(r.text || "").slice(0, 120)}`, l.id]);
      } catch (e) { run("UPDATE push_langganan SET galat = ? WHERE id = ?", [String(e.message || e).slice(0, 160), l.id]); }
    }));
    run("DELETE FROM notif WHERE waktu < datetime('now', '-7 days')");
  } finally { mengirim = false; }
}

route("GET", "/api/notif/kunci", "admin", async () => ({ publik: (await kunciVapid()).publik }), { pusatSaja: true });
route("GET", "/api/notif/langganan", "admin", ({ user }) => all("SELECT id, nama, dibuat, terakhir, galat, user_id = ? milik, endpoint FROM push_langganan ORDER BY id", [user.id])
  .map(({ endpoint, ...x }) => ({ ...x, kunci: endpoint.slice(-24) })));
route("POST", "/api/notif/langganan", "admin", ({ body, user }) => {
  const endpoint = String(body.endpoint || "");
  if (!HOST_PUSH.test(endpoint) || endpoint.length > 1000) throw bad("Alamat notifikasi dari HP ini tidak dikenal");
  const nama = String(body.nama || "HP admin").slice(0, 60);
  run(`INSERT INTO push_langganan(user_id, endpoint, nama) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, nama = excluded.nama, galat = NULL`, [user.id, endpoint, nama]);
  return { ok: true };
}, { pusatSaja: true });
route("DELETE", "/api/notif/langganan", "admin", ({ body }) => { run("DELETE FROM push_langganan WHERE endpoint = ? OR id = ?", [String(body.endpoint || ""), +body.id || 0]); return { ok: true }; });
route("POST", "/api/notif/uji", "admin", async ({ user }) => {
  run("INSERT INTO notif(judul, isi, url) VALUES (?,?,?)", ["🔔 Notifikasi Rich Gallery aktif", `Uji coba oleh ${judulBesar(user.nama)}. Transaksi, pesanan & absensi baru akan muncul seperti ini.`, "/#riwayat"]);
  await kirimNotif();
  return { ok: true, hp: one("SELECT COUNT(*) n FROM push_langganan").n, galat: all("SELECT nama, galat FROM push_langganan WHERE galat IS NOT NULL") };
}, { pusatSaja: true });
/** Dipanggil sw.js di HP admin saat dibangunkan: notifikasi 30 menit terakhir. */
route("GET", "/api/notif/terbaru", "admin", () => all("SELECT id, judul, isi, url FROM notif WHERE waktu >= datetime('now', '-30 minutes') ORDER BY id DESC LIMIT 5").reverse());
