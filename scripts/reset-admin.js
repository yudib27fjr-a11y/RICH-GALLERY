// Bila password admin lupa: npm run reset-admin -- "Nama" "password-baru-min-8"
// Menjadikan nama tersebut admin aktif dengan password baru (dibuat bila belum ada).
import { bukaDb, tutupDb } from "../src/node/driver.js";
import { pasangPlatformNode } from "../src/node/platform.js";
import { one, run, migrasi } from "../src/core/db.js";
import { hashPassword, validasiPassword, hapusSemuaSesiUser } from "../src/core/auth.js";

const [nama, pw] = process.argv.slice(2);
if (!nama || !pw) { console.error('Pemakaian: npm run reset-admin -- "Nama" "password-baru"'); process.exit(1); }
try { validasiPassword(pw, "admin"); } catch (e) { console.error(e.message); process.exit(1); }
pasangPlatformNode(); bukaDb(); migrasi();
const u = one("SELECT id FROM users WHERE nama_key = ?", [nama.toLowerCase()]);
if (u) { run("UPDATE users SET peran = 'admin', aktif = 1, pass_hash = ? WHERE id = ?", [hashPassword(pw), u.id]); hapusSemuaSesiUser(u.id); }
else run("INSERT INTO users(nama, nama_key, peran, pass_hash) VALUES (?, ?, 'admin', ?)", [nama, nama.toLowerCase(), hashPassword(pw)]);
tutupDb();
console.log(`Admin "${nama}" siap. Silakan masuk dengan password baru.`);
