// Cadangan harian database server. Dijalankan oleh systemd timer (lihat deploy/), atau manual: npm run backup
import { readdirSync, statSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../src/node/config.js";
import { bukaDb, salinDb, tutupDb } from "../src/node/driver.js";

const SIMPAN_HARI = +(process.env.BACKUP_KEEP_DAYS || 30);
bukaDb();
const cap = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const file = path.join(config.backupDir, `rich-gallery-${cap}.db`);
writeFileSync(file, salinDb());
tutupDb();
let dihapus = 0;
for (const f of readdirSync(config.backupDir)) {
  if (!/^(rich-gallery-\d+|sebelum-pulihkan-\d+)\.db$/.test(f)) continue;
  const p = path.join(config.backupDir, f);
  if (Date.now() - statSync(p).mtimeMs > SIMPAN_HARI * 86400_000) { rmSync(p); dihapus++; }
}
console.log(`Cadangan dibuat: ${file}${dihapus ? ` (${dihapus} cadangan lama dihapus)` : ""}`);
