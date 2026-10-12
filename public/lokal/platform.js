/* Kemampuan platform untuk aplikasi Android (mode offline). Bergantung pada jembatan native RGNative & RGDB. */
import { pasangPlatform } from "/src/core/platform.js";

const b64url = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cek = s => { const o = JSON.parse(s || "{}"); if (o && o.error) throw new Error(o.error); return o; };

/* HTTP lewat native (tanpa batasan CORS), hasilnya dikirim balik ke window.__rgHttp. */
let nomor = 0;
const menunggu = new Map();
window.__rgHttp = (id, status, text) => { const f = menunggu.get(id); if (f) { menunggu.delete(id); f({ status, text }); } };
function http({ method, url, body = "", headers = {} }){
  return new Promise((ok, gagal) => {
    const id = String(++nomor);
    menunggu.set(id, r => r.status === 0 ? gagal(new Error(r.text || "Tidak terhubung ke internet")) : ok(r));
    window.RGNative.http(id, method, url, JSON.stringify(headers), body);
  });
}

export function pasangPlatformLokal(){
  pasangPlatform({
    zona: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta"; } catch { return "Asia/Jakarta"; } })(),
    sesiHari: 30,
    hashPassword: pw => window.RGNative.hashPassword(pw),
    cekPassword: (pw, h) => !!window.RGNative.cekPassword(pw, h),
    sha256: t => window.RGNative.sha256(t),
    token: () => b64url(crypto.getRandomValues(new Uint8Array(32))),
    http,
    cadangan: async () => ({ disimpan: cek(window.RGDB.cadangan()).lokasi }),
    pulihkan: async b64 => { cek(window.RGDB.pulihkan(b64)); },
  });
}
