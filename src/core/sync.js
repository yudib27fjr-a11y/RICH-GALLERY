import { all, one, run, getSettings, setSetting } from "./db.js";
import { platform } from "./platform.js";

/* Kirim antrean (outbox) ke Google Apps Script → tab "APP …" di sheet PEMBUKUAN RG 2026.
   Di server berjalan tiap menit; di aplikasi Android berjalan tiap menit selama aplikasi terbuka dan ada internet. */
let jalan = false;
export async function kirimOutbox({ paksa = false } = {}){
  const url = String(getSettings().sync_url || "").trim();
  if (!url || jalan) return { terkirim: 0, alasan: !url ? "URL Apps Script belum diisi" : "sedang mengirim" };
  jalan = true; let total = 0;
  try {
    for (let putaran = 0; putaran < 20; putaran++) {
      const batch = all("SELECT id, tipe, baris, percobaan FROM outbox WHERE terkirim IS NULL ORDER BY id LIMIT 300");
      if (!batch.length) break;
      if (!paksa && putaran === 0 && batch[0].percobaan > 3 && Math.random() > 0.25) break; // mundur perlahan bila terus gagal
      const ids = batch.map(b => b.id).join(",");
      try {
        const r = await platform.http({ method: "POST", url, headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ items: batch.map(b => ({ type: b.tipe, row: JSON.parse(b.baris) })) }) });
        let j = null; try { j = JSON.parse(r.text); } catch { /* bukan JSON */ }
        if (j && j.ok === false) throw new Error(j.error || "Apps Script menolak data");
        if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
        run(`UPDATE outbox SET terkirim = datetime('now'), galat = NULL WHERE id IN (${ids})`);
        setSetting("sync_terakhir", new Date().toISOString()); setSetting("sync_galat", "");
        total += batch.length;
      } catch (e) {
        run(`UPDATE outbox SET percobaan = percobaan + 1, galat = ? WHERE id IN (${ids})`, [String(e.message).slice(0, 300)]);
        setSetting("sync_galat", String(e.message).slice(0, 300));
        break;
      }
    }
    run("DELETE FROM outbox WHERE terkirim IS NOT NULL AND terkirim < datetime('now', '-90 days')");
  } finally { jalan = false; }
  return { terkirim: total };
}

export function statusSync(){
  const s = getSettings();
  return { aktif: !!s.sync_url, menunggu: one("SELECT COUNT(*) n FROM outbox WHERE terkirim IS NULL").n, terakhir: s.sync_terakhir || null, galat: s.sync_galat || "" };
}

/** Ambil isi tab sheet lewat endpoint publik Google Visualization (sheet harus bisa dilihat siapa pun yang punya link). */
export async function tarikSheet(sheetId, namaTab, tq){
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(namaTab)}&tq=${encodeURIComponent(tq)}`;
  const r = await platform.http({ method: "GET", url });
  const m = r.text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (r.status !== 200 || !m) throw new Error("Sheet tidak bisa dibaca. Pastikan aksesnya 'Siapa saja yang memiliki link'.");
  const j = JSON.parse(m[1]);
  if (j.status !== "ok") throw new Error(j.errors?.[0]?.detailed_message || "Sheet menolak permintaan");
  return j.table.rows.map(row => row.c.map(c => c ? (c.v ?? c.f) : null));
}
