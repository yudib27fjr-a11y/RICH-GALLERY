/* Kemampuan yang berbeda antara server Node dan aplikasi Android.
   Diisi saat program mulai: src/node/platform.js atau public/lokal/platform.js. */
export const platform = {
  zona: "Asia/Jakarta",          // zona waktu toko
  sesiHari: 30,                  // umur sesi login
  hashPassword: null,            // (pw) => string
  cekPassword: null,             // (pw, simpan) => boolean
  sha256: null,                  // (teks) => hex
  token: null,                   // () => string acak aman
  http: null,                    // async ({ method, url, body, headers }) => { status, text }
  cadangan: null,                // async () => { unduh: { nama, tipe, isi } } | { disimpan: "lokasi" }
  pulihkan: null,                // async (base64) => void  (mengganti seluruh database)
};
export function pasangPlatform(p){ Object.assign(platform, p); }
