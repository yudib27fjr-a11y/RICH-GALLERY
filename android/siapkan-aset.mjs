// Menyalin tampilan (public/) dan inti aturan bisnis (src/core/) ke aset aplikasi Android.
// Jalankan setiap kali file web berubah, sebelum membangun APK:  node android/siapkan-aset.mjs
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WWW = path.join(ROOT, "android/app/src/main/assets/www");

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });
cpSync(path.join(ROOT, "public"), WWW, { recursive: true });
cpSync(path.join(ROOT, "src/core"), path.join(WWW, "src/core"), { recursive: true });
cpSync(path.join(ROOT, "android/aset-tambahan"), WWW, { recursive: true });

// Nomor versi paket web (diisi nomor build GitHub Actions); dipakai pembaruan otomatis.
writeFileSync(path.join(WWW, "versi-web.json"), JSON.stringify({ web: Number(process.env.WEB_VERSI || 0) }) + "\n");

// Font Google tidak tersedia saat offline; pakai font sistem supaya halaman tidak menunggu internet.
const idx = path.join(WWW, "index.html");
writeFileSync(idx, readFileSync(idx, "utf8").split("\n").filter(l => !l.includes("fonts.googleapis.com")).join("\n"));

let n = 0; const hitung = d => readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? hitung(path.join(d, e.name)) : n++);
hitung(WWW);
console.log(`Aset Android siap: ${n} file di ${path.relative(ROOT, WWW)}`);
