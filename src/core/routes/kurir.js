/* Daftar kurir offline (dihubungi lewat WhatsApp) untuk menu Kurir.
   Disimpan di pengaturan toko "kurir_offline" & ikut ke perangkat kasir saat sinkron.
   Admin di perangkat kasir mengubahnya lewat server pusat. */
import { route } from "../router.js";
import { getSettings, setSetting } from "../db.js";
import { bad, teks } from "../util.js";
import { cabangAktif, mintaPusat, sinkronCabang } from "../cabang-perangkat.js";

/** Rapikan daftar kurir: nama wajib, nomor HP Indonesia diubah ke 62…, maks 30 kurir. */
export function rapikanKurir(daftar){
  if (!Array.isArray(daftar)) throw bad("Daftar kurir tidak valid");
  if (daftar.length > 30) throw bad("Maksimal 30 kurir");
  return daftar.map((k, i) => {
    const nama = teks(k && k.nama, { wajib: true, max: 40, nama: `Nama kurir ${i + 1}` });
    let hp = String(k && k.hp || "").replace(/\D/g, "");
    if (hp.startsWith("0")) hp = "62" + hp.slice(1); else if (hp.startsWith("8")) hp = "62" + hp;
    if (hp.length < 10 || hp.length > 15) throw bad(`Nomor WA ${nama} belum benar (contoh 0812xxxxxxx)`);
    return { nama, hp };
  });
}
export const simpanKurir = daftar => { const d = rapikanKurir(daftar); setSetting("kurir_offline", d); return { daftar: d }; };

route("GET", "/api/kurir", "semua", () => ({ daftar: Array.isArray(getSettings().kurir_offline) ? getSettings().kurir_offline : [] }));
route("PUT", "/api/kurir", "admin", async ({ body }) => {
  if (!cabangAktif()) return simpanKurir(body.daftar);
  const r = await mintaPusat("/api/cabang/kurir", { daftar: body.daftar });
  await sinkronCabang({ paksa: true }).catch(() => {}); // langsung ambil daftar terbaru dari server
  return r;
});

/* ---- Mitra bisnis (buku kontak per kategori: cutting stiker, papan ucapan, karangan bunga, toko, distributor bunga, …) ---- */
export function rapikanMitra(daftar){
  if (!Array.isArray(daftar)) throw bad("Daftar mitra tidak valid");
  if (daftar.length > 100) throw bad("Maksimal 100 mitra");
  return daftar.map((m, i) => {
    const nama = teks(m && m.nama, { wajib: true, max: 60, nama: `Nama mitra ${i + 1}` });
    const kategori = teks(m && m.kategori, { max: 40, nama: "Kategori" }) || "Lainnya";
    let hp = String(m && m.hp || "").replace(/\D/g, "");
    if (hp.startsWith("0")) hp = "62" + hp.slice(1); else if (hp.startsWith("8")) hp = "62" + hp;
    if (hp && (hp.length < 10 || hp.length > 15)) throw bad(`Nomor WA ${nama} belum benar (contoh 0812xxxxxxx)`);
    return { kategori, nama, hp, kota: teks(m && m.kota, { max: 40, nama: "Kota" }) || "", catatan: teks(m && m.catatan, { max: 300, nama: "Catatan" }) || "" };
  });
}
export const simpanMitra = daftar => { const d = rapikanMitra(daftar); setSetting("mitra", d); return { daftar: d }; };
route("GET", "/api/mitra", "semua", () => ({ daftar: Array.isArray(getSettings().mitra) ? getSettings().mitra : [] }));
route("PUT", "/api/mitra", "admin", async ({ body }) => {
  if (!cabangAktif()) return simpanMitra(body.daftar);
  const r = await mintaPusat("/api/cabang/mitra", { daftar: body.daftar });
  await sinkronCabang({ paksa: true }).catch(() => {});
  return r;
});
