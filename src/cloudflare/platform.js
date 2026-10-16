/* Kemampuan platform untuk server Cloudflare (Worker + Durable Object, mode nodejs_compat). */
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { pasangPlatform } from "../core/platform.js";
import { eksporData, imporData } from "../core/ekspor.js";
import { tx } from "../core/db.js";
import { hariIni } from "../core/util.js";

/* PBKDF2-SHA256, format sama dengan server Node & aplikasi Android: pbkdf2$iterasi$garam$hash (base64). */
const ITER = 100_000;
function hashPassword(pw){
  const salt = randomBytes(16);
  return `pbkdf2$${ITER}$${salt.toString("base64")}$${pbkdf2Sync(pw, salt, ITER, 32, "sha256").toString("base64")}`;
}
function cekPassword(pw, simpan){
  const [alg, a, b, c] = String(simpan).split("$");
  if (alg !== "pbkdf2") return false; // hash scrypt dari server lama: minta admin mengatur ulang password
  const target = Buffer.from(c, "base64");
  const hasil = pbkdf2Sync(pw, Buffer.from(b, "base64"), +a, target.length, "sha256");
  return hasil.length === target.length && timingSafeEqual(hasil, target);
}

async function http({ method, url, body, headers }){
  const r = await fetch(url, { method, headers, body: body || undefined, redirect: "follow", signal: AbortSignal.timeout(30000) });
  return { status: r.status, text: await r.text() };
}

export function pasangPlatformCF(){
  pasangPlatform({
    zona: "Asia/Jakarta",
    sesiHari: 30,
    hashPassword, cekPassword,
    sha256: t => createHash("sha256").update(t).digest("hex"),
    token: () => randomBytes(32).toString("base64url"),
    http,
    // Di Cloudflare tidak ada file .db: cadangan berupa JSON berisi seluruh data, dan bisa dipulihkan lagi di sini.
    cadangan: async () => ({ unduh: { nama: `rich-gallery-${hariIni()}.json`, tipe: "application/json", isi: JSON.stringify(eksporData()) } }),
    pulihkan: async b64 => {
      const teks = Buffer.from(b64, "base64").toString("utf8");
      if (teks.startsWith("SQLite format 3")) throw new Error("Server Cloudflare memakai cadangan .json. Untuk memindahkan data dari iMin: di iMin buka Pengaturan → Server pusat → Sambungkan, lalu pilih Kirim semua data.");
      let dump; try { dump = JSON.parse(teks); } catch { throw new Error("File bukan cadangan .json Rich Gallery"); }
      tx(() => imporData(dump));
    },
  });
}
