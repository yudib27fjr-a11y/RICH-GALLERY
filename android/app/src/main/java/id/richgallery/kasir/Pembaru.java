package id.richgallery.kasir;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.PublicKey;
import java.security.cert.CertificateFactory;

/**
 * Pembaruan otomatis dari GitHub Releases.
 * - Tampilan & aturan (paket web) diunduh di latar belakang, dipakai setelah aplikasi dimuat ulang.
 * - APK baru: pengguna diberi tombol "Pasang" (Android selalu meminta konfirmasi).
 * Setiap rilis ditandatangani dengan kunci aplikasi; pembaruan yang tanda tangannya tidak cocok ditolak.
 */
final class Pembaru {
    static final String URL_DASAR = "https://github.com/yudib27fjr-a11y/RICH-GALLERY/releases/latest/download/";

    private final MainActivity act;
    private final SharedPreferences pref;
    private volatile boolean jalan = false;
    private volatile JSONObject terakhir;
    /** Pemberitahuan terakhir untuk halaman: {"jenis":"web|apk","teks":"..."} */
    volatile String tertunda = null;

    Pembaru(MainActivity a) {
        act = a;
        pref = a.getSharedPreferences("rg", Context.MODE_PRIVATE);
    }

    /* ---------- versi ---------- */
    int webBawaan() {
        try (InputStream in = act.getAssets().open("www/versi-web.json")) {
            byte[] b = new byte[in.available()];
            int n = in.read(b);
            return new JSONObject(new String(b, 0, Math.max(n, 0), StandardCharsets.UTF_8)).optInt("web", 0);
        } catch (Exception e) { return 0; }
    }

    /** Folder paket web hasil pembaruan yang sedang dipakai, atau null bila memakai paket bawaan APK. */
    File folderAktif() {
        int ota = pref.getInt("web_ota", 0);
        if (ota <= webBawaan()) return null;
        File d = new File(act.getFilesDir(), "www-" + ota);
        return new File(d, "index.html").isFile() ? d : null;
    }

    int webAktif() { return folderAktif() != null ? pref.getInt("web_ota", 0) : webBawaan(); }

    int kodeApk() {
        try {
            PackageInfo p = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) { return 0; }
    }

    /* ---------- jaring pengaman: paket web baru yang gagal dibuka dibatalkan otomatis ---------- */
    void saatMulai() {
        int uji = pref.getInt("web_uji", 0);
        if (uji > 0 && uji == pref.getInt("web_ota", 0)) {
            pref.edit().putInt("web_buruk", uji).putInt("web_ota", 0).remove("web_uji").commit();
            act.toast("Pembaruan tampilan terakhir gagal dibuka, kembali ke versi sebelumnya.");
        }
        File d = folderAktif();
        int ota = pref.getInt("web_ota", 0);
        if (d != null && pref.getInt("web_terbukti", 0) != ota) pref.edit().putInt("web_uji", ota).commit();
    }

    /** Dipanggil halaman setelah berhasil tampil. */
    void halamanSiap() {
        int ota = pref.getInt("web_ota", 0);
        pref.edit().remove("web_uji").putInt("web_terbukti", ota).apply();
    }

    /* ---------- pemeriksaan ---------- */
    void periksa(final boolean manual) {
        if (jalan) return;
        if (!manual && System.currentTimeMillis() - pref.getLong("cek_terakhir", 0) < 30 * 60_000L) return;
        jalan = true;
        new Thread(() -> {
            try { kerja(manual); }
            catch (Exception e) { if (manual) act.kabariHalaman("info", "Gagal memeriksa pembaruan: " + e.getMessage()); }
            finally { jalan = false; }
        }).start();
    }

    private PublicKey kunciAplikasi() throws Exception {
        PackageManager pm = act.getPackageManager();
        Signature[] sig;
        if (Build.VERSION.SDK_INT >= 28) {
            PackageInfo p = pm.getPackageInfo(act.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
            sig = p.signingInfo.getApkContentsSigners();
        } else {
            PackageInfo p = pm.getPackageInfo(act.getPackageName(), PackageManager.GET_SIGNATURES);
            sig = p.signatures;
        }
        return CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(sig[0].toByteArray())).getPublicKey();
    }

    private JSONObject ambilVersi() throws Exception {
        byte[] json = PaketUpdate.unduh(URL_DASAR + "versi.json", 200_000);
        byte[] ttd = PaketUpdate.unduh(URL_DASAR + "versi.json.sig", 20_000);
        if (!PaketUpdate.cekTandaTangan(json, ttd, kunciAplikasi())) throw new Exception("tanda tangan pembaruan tidak cocok, pembaruan diabaikan");
        JSONObject v = new JSONObject(new String(json, StandardCharsets.UTF_8));
        terakhir = v;
        return v;
    }

    private void kerja(boolean manual) throws Exception {
        JSONObject v = ambilVersi();
        pref.edit().putLong("cek_terakhir", System.currentTimeMillis()).apply();
        boolean ada = false;

        if (v.getInt("apk") > kodeApk()) {
            kabari("apk", v.optString("apkNama", "baru"));
            ada = true;
        }

        int web = v.getInt("web");
        boolean cocok = v.optInt("minApi", 1) <= RgNative.API;
        if (cocok && web > webAktif() && web != pref.getInt("web_buruk", -1)) {
            byte[] zip = PaketUpdate.unduh(URL_DASAR + "www.zip", 30_000_000);
            if (!PaketUpdate.sha256Hex(zip).equalsIgnoreCase(v.getString("wwwSha256"))) throw new Exception("file pembaruan rusak saat diunduh");
            File tmp = new File(act.getFilesDir(), "www-" + web + ".tmp"), dir = new File(act.getFilesDir(), "www-" + web);
            PaketUpdate.hapus(tmp);
            PaketUpdate.ekstrakZip(zip, tmp);
            if (!new File(tmp, "index.html").isFile()) throw new Exception("paket pembaruan tidak lengkap");
            PaketUpdate.hapus(dir);
            if (!tmp.renameTo(dir)) throw new Exception("tidak bisa memasang paket pembaruan");
            pref.edit().putInt("web_ota", web).commit();
            // Hapus paket lama, sisakan yang aktif.
            File[] semua = act.getFilesDir().listFiles();
            if (semua != null) for (File f : semua) if (f.getName().startsWith("www-") && !f.equals(dir)) PaketUpdate.hapus(f);
            kabari("web", v.optString("catatan", ""));
            ada = true;
        }
        if (!ada && manual) act.kabariHalaman("info", "Aplikasi sudah versi terbaru.");
    }

    private void kabari(String jenis, String teks) {
        try { tertunda = new JSONObject().put("jenis", jenis).put("teks", teks).toString(); } catch (Exception ignored) { }
        act.kabariHalaman(jenis, teks);
    }

    /* ---------- pasang APK ---------- */
    void pasangApk() {
        new Thread(() -> {
            try {
                JSONObject v = terakhir != null ? terakhir : ambilVersi();
                act.kabariHalaman("info", "Mengunduh aplikasi versi " + v.optString("apkNama") + "…");
                byte[] apk = PaketUpdate.unduh(URL_DASAR + "RichGallery.apk", 80_000_000);
                if (!PaketUpdate.sha256Hex(apk).equalsIgnoreCase(v.getString("apkSha256"))) throw new Exception("file APK rusak saat diunduh");
                File dir = BerkasProvider.folder(act);
                PaketUpdate.hapus(dir);
                dir.mkdirs();
                File f = new File(dir, "RichGallery-" + v.optString("apkNama", "baru") + ".apk");
                RgDb.tulisFile(f, apk);
                act.runOnUiThread(() -> act.bukaPenginstal(f));
            } catch (Exception e) {
                act.kabariHalaman("info", "Gagal mengunduh pembaruan: " + e.getMessage());
            }
        }).start();
    }
}
