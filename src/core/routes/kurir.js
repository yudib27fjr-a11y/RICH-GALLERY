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
