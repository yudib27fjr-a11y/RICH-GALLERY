/* Mesin lokal: menjalankan seluruh API Rich Gallery di dalam aplikasi Android, tanpa server.
   Aturan bisnisnya sama persis dengan server (src/core), hanya database dan platformnya yang berbeda. */
import { pasangDriver, migrasi, seedJikaKosong, jalankan, kirimOutbox, bersihkanSesiKadaluarsa, sinkronCabang, pendengar } from "/src/core/semua.js";
import { buatDriver } from "./driver.js";
import { pasangPlatformLokal } from "./platform.js";

const KUNCI_SESI = "rg_sesi_lokal";
const bacaSesi = () => { try { const s = JSON.parse(localStorage.getItem(KUNCI_SESI) || "null"); return s && s.sampai > Date.now() ? s.token : null; } catch { return null; } };
const tulisSesi = (token, umur) => { try { if (!umur) localStorage.removeItem(KUNCI_SESI); else localStorage.setItem(KUNCI_SESI, JSON.stringify({ token, sampai: Date.now() + umur * 1000 })); } catch {} };

pasangPlatformLokal();
pasangDriver(buatDriver(window.RGDB));
migrasi();
seedJikaKosong();
bersihkanSesiKadaluarsa();

async function request(method, url, body){
  const u = new URL(url, "https://rg.lokal");
  const r = await jalankan({
    method, path: u.pathname, query: Object.fromEntries(u.searchParams),
    body: body === undefined ? {} : JSON.parse(JSON.stringify(body)),
    token: bacaSesi(), ip: "lokal", setSesi: tulisSesi,
  });
  if (u.pathname === "/api/pulihkan" && r.status === 200) tulisSesi("", 0);
  return r;
}
window.RG_LOKAL = { request };

// Kirim antrean ke Google Sheet tiap menit selama aplikasi terbuka dan ada internet.
const kirim = () => { if (navigator.onLine) kirimOutbox().catch(() => {}); };
setInterval(kirim, 60_000);
window.addEventListener("online", kirim);
setTimeout(kirim, 5000);
// Mode cabang: transaksi di perangkat ini langsung dikirim (beberapa detik setelah tersimpan).
// Selain itu perangkat bertanya ke server "ada yang baru?" tiap 10 detik selama aplikasi terbuka
// (jawaban "tidak ada" sangat kecil); saat aplikasi di latar belakang cukup tiap 2 menit.
const sinkron = () => { if (navigator.onLine) sinkronCabang().catch(() => {}); };
let terakhir = 0;
setInterval(() => {
  const jeda = document.hidden ? 120_000 : 10_000;
  if (Date.now() - terakhir >= jeda - 500) { terakhir = Date.now(); sinkron(); }
}, 5_000);
window.addEventListener("online", sinkron);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { terakhir = Date.now(); sinkron(); } });
setTimeout(sinkron, 3000);
// Data baru dari server sudah masuk: beri tahu layar supaya menampilkan angka terbaru.
pendengar.dataBaru = () => { try { window.dispatchEvent(new Event("rg-data-baru")); } catch { /* abaikan */ } };
