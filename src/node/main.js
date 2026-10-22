import { createServer } from "node:http";
import { config } from "./config.js";
import { bukaDb, tutupDb } from "./driver.js";
import { pasangPlatformNode } from "./platform.js";
import { handle } from "./http.js";
import { migrasi, seedJikaKosong, kirimOutbox, bersihkanSesiKadaluarsa, sinkronCabang, hapusFotoAbsenLama, rekapProduksiHarian, kirimNotif } from "../core/semua.js";

pasangPlatformNode();
bukaDb();
const baru = migrasi();
if (seedJikaKosong()) console.log("Database baru dibuat dan diisi data awal dari sheet PEMBUKUAN RG 2026.");
else if (baru) console.log("Database baru dibuat.");

const server = createServer((req, res) => { handle(req, res); });
server.requestTimeout = 300_000;
server.listen(config.port, config.host, () => {
  console.log(`Rich Gallery POS berjalan di http://${config.host}:${config.port}  (zona waktu toko ${config.tz})`);
});

// Kirim antrean ke Google Sheet secara berkala, dan bersihkan sesi kedaluwarsa tiap jam.
const syncTimer = setInterval(() => kirimOutbox().catch(e => console.error("sync:", e.message)), config.syncIntervalSec * 1000);
const sesiTimer = setInterval(() => { bersihkanSesiKadaluarsa(); try { hapusFotoAbsenLama(); } catch (e) { console.error("hapus foto absen", e.message); } }, 3600_000);
// Bila server ini disambungkan sebagai cabang dari server lain: kirim transaksi & ambil data terbaru tiap 30 detik.
// Rekap produksi harian ke HP admin (sekali sehari setelah 21.30).
const rekapTimer = setInterval(() => { try { rekapProduksiHarian(); } catch (e) { console.error("rekap produksi:", e.message); } kirimNotif().catch(() => {}); }, 5 * 60_000);
const cabangTimer = setInterval(() => sinkronCabang().catch(e => console.error("cabang:", e.message)), 10_000);

function berhenti(){
  console.log("Menutup server…");
  clearInterval(syncTimer); clearInterval(sesiTimer); clearInterval(rekapTimer); clearInterval(cabangTimer);
  server.close(() => { tutupDb(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", berhenti);
process.on("SIGINT", berhenti);
