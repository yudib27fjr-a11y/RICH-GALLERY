import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = (k, d) => (process.env[k] ?? "").trim() || d;

export const config = {
  port: +env("PORT", "3000"),
  host: env("HOST", "127.0.0.1"),
  dbPath: path.resolve(ROOT, env("DB_PATH", "data/rich-gallery.db")),
  backupDir: path.resolve(ROOT, env("BACKUP_DIR", "data/backup")),
  cookieSecure: env("COOKIE_SECURE", "false") === "true",   // true bila website dibuka lewat https
  trustProxy: env("TRUST_PROXY", "false") === "true",       // true bila di belakang nginx
  tz: env("TZ_TOKO", "Asia/Jakarta"),                       // zona waktu toko
  sessionDays: +env("SESSION_DAYS", "30"),
  syncIntervalSec: +env("SYNC_INTERVAL_SEC", "60"),
  publicDir: path.join(ROOT, "public"),
};
