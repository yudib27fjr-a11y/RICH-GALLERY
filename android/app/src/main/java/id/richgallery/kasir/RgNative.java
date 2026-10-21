package id.richgallery.kasir;

import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Iterator;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Kemampuan native untuk halaman web (window.RGNative): password, HTTP tanpa CORS, cetak, simpan file, mode. */
public class RgNative {
    private final MainActivity act;
    private static final int ITERASI = 60000;
    /** Versi kemampuan native. Naikkan bila menambah metode baru yang dipakai halaman; paket web yang butuh versi lebih tinggi tidak akan dipasang di APK lama. */
    static final int API = 8; // 8: bukaAplikasi (Gojek, Grab, Maxim)
    /** Versi native minimum yang dibutuhkan paket tampilan saat ini. Halaman memeriksa sendiri metode baru (mis. cetakLangsung),
     *  jadi angka ini hanya dinaikkan bila halaman benar-benar tidak bisa jalan di APK lama. Dibaca oleh workflow rilis. */
    static final int WEB_BUTUH_API = 2;

    RgNative(MainActivity a) { act = a; }

    /* ---------- Password: PBKDF2-HMAC-SHA256, format sama dengan server Node ---------- */
    static byte[] pbkdf2(byte[] pw, byte[] salt, int iter, int panjang) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        // Kunci HMAC kosong setara dengan satu byte nol (kunci selalu diisi nol sampai panjang blok).
        mac.init(new SecretKeySpec(pw.length == 0 ? new byte[1] : pw, "HmacSHA256"));
        byte[] hasil = new byte[panjang];
        int blok = (panjang + 31) / 32, pos = 0;
        for (int b = 1; b <= blok; b++) {
            mac.update(salt);
            mac.update(new byte[]{(byte) (b >>> 24), (byte) (b >>> 16), (byte) (b >>> 8), (byte) b});
            byte[] u = mac.doFinal(), t = u.clone();
            for (int i = 1; i < iter; i++) { u = mac.doFinal(u); for (int j = 0; j < t.length; j++) t[j] ^= u[j]; }
            int n = Math.min(32, panjang - pos);
            System.arraycopy(t, 0, hasil, pos, n);
            pos += n;
        }
        return hasil;
    }

    @JavascriptInterface
    public String hashPassword(String pw) {
        try {
            byte[] salt = new byte[16];
            new SecureRandom().nextBytes(salt);
            byte[] h = pbkdf2(pw.getBytes(StandardCharsets.UTF_8), salt, ITERASI, 32);
            return "pbkdf2$" + ITERASI + "$" + Base64.encodeToString(salt, Base64.NO_WRAP) + "$" + Base64.encodeToString(h, Base64.NO_WRAP);
        } catch (Exception e) { return ""; }
    }

    @JavascriptInterface
    public boolean cekPassword(String pw, String simpan) {
        try {
            String[] p = simpan.split("\\$");
            if (p.length != 4 || !p[0].equals("pbkdf2")) return false; // hash scrypt dari server lama: minta admin atur ulang PIN
            byte[] target = Base64.decode(p[3], Base64.DEFAULT);
            byte[] h = pbkdf2(pw.getBytes(StandardCharsets.UTF_8), Base64.decode(p[2], Base64.DEFAULT), Integer.parseInt(p[1]), target.length);
            return MessageDigest.isEqual(h, target);
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public String sha256(String teks) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(teks.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte x : d) sb.append(String.format("%02x", x & 0xff));
            return sb.toString();
        } catch (Exception e) { return ""; }
    }

    /* ---------- HTTP (sinkron Google Sheet) — hasil dikirim ke window.__rgHttp(id, status, teks) ---------- */
    @JavascriptInterface
    public void http(final String id, final String metode, final String url, final String headersJson, final String body) {
        new Thread(() -> {
            int status = 0;
            String teks;
            try {
                String u = url, m = metode;
                byte[] isi = body == null || body.isEmpty() ? null : body.getBytes(StandardCharsets.UTF_8);
                for (int lompat = 0; ; lompat++) {
                    if (!u.startsWith("https://")) throw new Exception("Hanya alamat https yang diizinkan");
                    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    c.setRequestMethod(m);
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) { String k = it.next(); c.setRequestProperty(k, h.getString(k)); }
                    if (isi != null && !m.equals("GET")) {
                        c.setDoOutput(true);
                        try (OutputStream out = c.getOutputStream()) { out.write(isi); }
                    }
                    status = c.getResponseCode();
                    String lokasi = c.getHeaderField("Location");
                    if (status >= 300 && status < 400 && lokasi != null && lompat < 5) {
                        // Apps Script membalas POST dengan 302 ke halaman hasil; ikuti dengan GET.
                        u = new URL(new URL(u), lokasi).toString();
                        if (status == 302 || status == 303 || status == 301) { m = "GET"; isi = null; }
                        c.disconnect();
                        continue;
                    }
                    InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    teks = in == null ? "" : baca(in);
                    c.disconnect();
                    break;
                }
            } catch (Exception e) {
                status = 0;
                teks = String.valueOf(e.getMessage());
            }
            final String js = "window.__rgHttp && window.__rgHttp(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(teks) + ")";
            act.jalankanJs(js);
        }).start();
    }

    private static String baca(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n, total = 0;
        while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; if (total > 10_000_000) break; }
        in.close();
        return out.toString("UTF-8");
    }

    /* ---------- Buka link di aplikasi tertentu (Canva, WhatsApp / WhatsApp Business) atau di browser ---------- */
    /** paket: nama paket aplikasi (mis. "com.canva.editor", "com.whatsapp.w4b"), "browser" untuk peramban, atau "" (pilihan Android).
     *  Bila aplikasinya belum terpasang, link dibuka dengan cara biasa. */
    @JavascriptInterface
    public void bukaDengan(final String url, final String paket) { act.runOnUiThread(() -> act.bukaDengan(url, paket)); }

    /** Buka aplikasi lain (mis. Gojek, Grab, Maxim). Belum terpasang → halaman Play Store-nya. */
    @JavascriptInterface
    public void bukaAplikasi(final String paket) { act.runOnUiThread(() -> act.bukaAplikasi(paket)); }

    /** Apakah aplikasi dengan paket ini terpasang (untuk keterangan di Pengaturan). */
    @JavascriptInterface
    public boolean adaAplikasi(String paket) {
        try { act.getPackageManager().getPackageInfo(paket, 0); return true; } catch (Exception e) { return false; }
    }

    /* ---------- Cetak struk/label lewat layanan cetak Android ---------- */
    @JavascriptInterface
    public void cetak(int kertasMm) { act.runOnUiThread(() -> act.cetak(kertasMm)); }

    /** Cetak halaman dengan ukuran kertas tertentu (mm), mis. kartu ucapan. */
    @JavascriptInterface
    public void cetakUkuran(float lebarMm, float tinggiMm) { act.runOnUiThread(() -> act.cetakUkuran(lebarMm, tinggiMm)); }

    /** Cetak ESC/POS langsung ke printer bawaan (iMin "BluetoothPrinter" / Sunmi "InnerPrinter"). Data dalam base64. */
    @JavascriptInterface
    public void cetakLangsung(String b64) {
        try { act.printer.cetak(Base64.decode(b64, Base64.DEFAULT)); }
        catch (Exception e) { act.toast("Data cetak tidak valid"); }
    }

    /** Nama printer bawaan yang ditemukan, "" bila tidak ada, "izin" bila izin Bluetooth belum diberikan. */
    @JavascriptInterface
    public String printerLangsung() { return act.printer.status(); }

    /* ---------- Simpan file (CSV, dll.) ke Download/RichGallery ---------- */
    @JavascriptInterface
    public String simpanFile(String nama, String mime, String b64) {
        try { return Berkas.simpanKeDownload(act, nama, mime == null || mime.isEmpty() ? "application/octet-stream" : mime, Base64.decode(b64, Base64.DEFAULT)); }
        catch (Exception e) { return ""; }
    }

    /* ---------- Mode aplikasi ---------- */
    @JavascriptInterface
    public String info() {
        try {
            return new JSONObject().put("mode", act.mode()).put("server", act.server()).put("versi", act.versi())
                    .put("web", act.pembaru.webAktif()).put("api", API).toString();
        } catch (Exception e) { return "{}"; }
    }

    /* ---------- Pembaruan otomatis ---------- */
    @JavascriptInterface
    public void webSiap() { act.pembaru.halamanSiap(); }

    @JavascriptInterface
    public void periksaPembaruan() { act.pembaru.periksa(true); }

    @JavascriptInterface
    public String statusPembaruan() { String s = act.pembaru.tertunda; return s == null ? "" : s; }

    @JavascriptInterface
    public void pasangApk() { act.pembaru.pasangApk(); }

    @JavascriptInterface
    public void setMode(String mode, String server) {
        if ("online".equals(mode) && (server == null || !server.startsWith("https://"))) return;
        act.runOnUiThread(() -> act.gantiMode("online".equals(mode) ? "online" : "offline", server == null ? "" : server.trim()));
    }
}
