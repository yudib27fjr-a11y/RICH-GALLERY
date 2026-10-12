/* Mesin lokal: menjalankan seluruh API Rich Gallery di dalam aplikasi Android, tanpa server.
   Aturan bisnisnya sama persis dengan server (src/core), hanya database dan platformnya yang berbeda. */
import { pasangDriver, migrasi, seedJikaKosong, jalankan, kirimOutbox, bersihkanSesiKadaluarsa } from "/src/core/semua.js";
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
