/* Rich Gallery POS — service worker khusus notifikasi HP admin (transaksi & pesanan baru).
   Tidak menyimpan cache halaman: tampilan selalu diambil langsung dari server.
   Server hanya "membangunkan" HP tanpa isi; isi notifikasi diambil di sini memakai sesi admin di HP ini. */
const CACHE = "rg-notif";
const KUNCI = "/__notif_terakhir";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

async function idTerakhir(){
  try { const r = await (await caches.open(CACHE)).match(KUNCI); return r ? Number(await r.text()) || 0 : 0; } catch { return 0; }
}
async function simpanTerakhir(id){
  try { await (await caches.open(CACHE)).put(KUNCI, new Response(String(id))); } catch { /* abaikan */ }
}

self.addEventListener("push", e => e.waitUntil((async () => {
  let daftar = [];
  try {
    const r = await fetch("/api/notif/terbaru", { credentials: "include", cache: "no-store" });
    if (r.ok) daftar = await r.json();
  } catch { /* offline: tampilkan pesan umum */ }
  const terakhir = await idTerakhir();
  let baru = Array.isArray(daftar) ? daftar.filter(n => n.id > terakhir) : [];
  // HP wajib menampilkan sesuatu setiap kali dibangunkan (aturan iPhone & Chrome).
  if (!baru.length) baru = daftar.length ? [daftar[daftar.length - 1]] : [{ id: 0, judul: "Rich Gallery", isi: "Ada transaksi / pesanan baru. Buka aplikasi untuk melihat.", url: "/#riwayat" }];
  for (const n of baru) {
    await self.registration.showNotification(n.judul, {
      body: n.isi, tag: "rg-" + n.id, renotify: true, icon: "/icon-192.png", badge: "/favicon.png", data: { url: n.url || "/" },
    });
  }
  const maks = Math.max(terakhir, ...baru.map(n => n.id || 0));
  if (maks > terakhir) await simpanTerakhir(maks);
})()));

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const semua = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const c = semua.find(x => x.url.startsWith(self.location.origin));
    if (c) {
      // Aplikasi sudah terbuka: minta halaman membuka isinya sendiri (navigate() tidak selalu jalan di iPhone/Android).
      try { await c.focus(); } catch { /* abaikan */ }
      c.postMessage({ rgBuka: url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
