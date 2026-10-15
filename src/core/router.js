import { HttpError } from "./util.js";
import { userDariCtx } from "./auth.js";
import { tx } from "./db.js";
import { platform } from "./platform.js";
import { cabangAktif, catatPerintah, jadwalkanSinkron, PESAN_PUSAT } from "./cabang-perangkat.js";

const routes = [];
/**
 * Daftarkan endpoint. akses: false (publik), "semua" (harus login), "admin".
 * Handler menerima { user, params, query, body, ctx } dan mengembalikan data,
 * atau { unduh: { nama, tipe, isi } } untuk file.
 * opsi.cabang({ body, params, user, hasil, pra }) → { aksi, data }: perintah yang dikirim ke server pusat (mode cabang).
 *   Handler-nya wajib sinkron; perintah dicatat dalam transaksi yang sama.
 * opsi.pra({ params, body }): dibaca sebelum handler berjalan (mis. uid baris yang akan dihapus).
 * opsi.uid: beri body.uid acak supaya baris baru bisa dirujuk di server pusat.
 * opsi.pusatSaja: di mode cabang, perubahan ini hanya boleh di server pusat.
 */
export function route(method, pola, akses, handler, opsi = {}){
  const keys = [];
  const re = new RegExp("^" + pola.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, re, keys, akses, handler, opsi, batas: opsi.batas || 1_000_000 });
}
export const cariRoute = (method, path) => routes.find(r => r.method === method && r.re.test(path)) || null;

/**
 * Menjalankan satu permintaan API, dipakai server Node maupun mesin lokal Android.
 * ctx: { method, path, query, body, token, ip, setSesi(token, umurDetik) }
 * Hasil: { status, data } atau { status, unduh }.
 */
export async function jalankan(ctx){
  try {
    const r = cariRoute(ctx.method, ctx.path);
    if (!r) throw new HttpError(404, "Alamat API tidak dikenal");
    const user = userDariCtx(ctx);
    if (r.akses && !user) throw new HttpError(401, "Silakan masuk dulu");
    if (r.akses === "admin" && user.peran !== "admin") throw new HttpError(403, "Hanya admin yang bisa melakukan ini");
    const m = ctx.path.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const cabang = (r.opsi.cabang || r.opsi.pusatSaja) && cabangAktif();
    if (cabang && r.opsi.pusatSaja) throw new HttpError(409, PESAN_PUSAT);
    let hasil;
    if (cabang) {
      const body = { ...(ctx.body || {}) };
      if (r.opsi.uid && !body.uid) body.uid = platform.token();
      hasil = tx(() => {
        const pra = r.opsi.pra ? r.opsi.pra({ params, body }) : null;
        const h = r.handler({ user, params, query: ctx.query || {}, body, ctx });
        const p = r.opsi.cabang({ body, params, user, hasil: h, pra });
        if (p) catatPerintah(p, user);
        return h;
      });
      jadwalkanSinkron();
    } else {
      hasil = await r.handler({ user, params, query: ctx.query || {}, body: ctx.body || {}, ctx });
    }
    if (hasil && hasil.unduh) return { status: 200, unduh: hasil.unduh };
    return { status: 200, data: hasil ?? { ok: true } };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, data: { error: e.message } };
    if (String(e.message).includes("UNIQUE constraint failed")) return { status: 409, data: { error: "Data yang sama sudah ada (kode atau barcode ganda)" } };
    console.error(new Date().toISOString(), ctx.method, ctx.path, e);
    return { status: 500, data: { error: "Terjadi kesalahan. Coba lagi; bila berulang, hubungi admin." } };
  }
}
