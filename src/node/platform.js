import { randomBytes, scryptSync, pbkdf2Sync, timingSafeEqual, createHash } from "node:crypto";
import { config } from "./config.js";
import { pasangPlatform } from "../core/platform.js";
import { salinDb, gantiDb } from "./driver.js";
import { hariIni } from "../core/util.js";

/* Password disimpan sebagai PBKDF2-SHA256 (sama dengan aplikasi Android, supaya database bisa dipindah dua arah).
   Hash scrypt lama tetap bisa diperiksa. */
const ITER = 100_000;
function hashPassword(pw){
  const salt = randomBytes(16);
  return `pbkdf2$${ITER}$${salt.toString("base64")}$${pbkdf2Sync(pw, salt, ITER, 32, "sha256").toString("base64")}`;
}
function cekPassword(pw, simpan){
  const [alg, a, b, c] = String(simpan).split("$");
  let hasil, target;
  if (alg === "pbkdf2") { target = Buffer.from(c, "base64"); hasil = pbkdf2Sync(pw, Buffer.from(b, "base64"), +a, target.length, "sha256"); }
  else if (alg === "scrypt") { target = Buffer.from(b, "base64"); hasil = scryptSync(pw, Buffer.from(a, "base64"), 64, { N: 16384, r: 8, p: 1 }); }
  else return false;
  return hasil.length === target.length && timingSafeEqual(hasil, target);
}

async function http({ method, url, body, headers }){
  const r = await fetch(url, { method, headers, body, redirect: "follow", signal: AbortSignal.timeout(30000) });
  return { status: r.status, text: await r.text() };
}

export function pasangPlatformNode(){
  pasangPlatform({
    zona: config.tz,
    sesiHari: config.sessionDays,
    perangkat: process.env.RG_UJI_PERANGKAT === "1", // hanya untuk tes: server Node berperan sebagai perangkat kasir
    hashPassword, cekPassword,
    sha256: t => createHash("sha256").update(t).digest("hex"),
    token: () => randomBytes(32).toString("base64url"),
    http,
    cadangan: async () => ({ unduh: { nama: `rich-gallery-${hariIni()}.db`, tipe: "application/octet-stream", isi: salinDb() } }),
    pulihkan: async b64 => gantiDb(Buffer.from(b64, "base64")),
  });
}
