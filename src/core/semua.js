// Mendaftarkan semua endpoint API (dipakai server Node dan mesin lokal Android).
import "./routes/akun.js";
import "./routes/katalog.js";
import "./routes/penjualan.js";
import "./routes/stok.js";
import "./routes/produksi.js";
import "./routes/keuangan.js";
import "./routes/admin.js";
export { jalankan, cariRoute } from "./router.js";
export { pasangDriver, migrasi } from "./db.js";
export { pasangPlatform } from "./platform.js";
export { seedJikaKosong } from "./seed.js";
export { kirimOutbox } from "./sync.js";
export { bersihkanSesiKadaluarsa } from "./auth.js";
