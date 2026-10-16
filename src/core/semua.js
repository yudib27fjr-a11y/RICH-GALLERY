// Mendaftarkan semua endpoint API (dipakai server Node dan mesin lokal Android).
import "./routes/akun.js";
import "./routes/katalog.js";
import "./routes/penjualan.js";
import "./routes/stok.js";
import "./routes/produksi.js";
import "./routes/keuangan.js";
import "./routes/admin.js";
import "./routes/cabang.js";
export { jalankan, cariRoute } from "./router.js";
export { pasangDriver, migrasi } from "./db.js";
export { pasangPlatform } from "./platform.js";
export { seedJikaKosong } from "./seed.js";
export { kirimOutbox } from "./sync.js";
export { bersihkanSesiKadaluarsa } from "./auth.js";
export { sinkronCabang, cabangAktif, pendengar } from "./cabang-perangkat.js";
