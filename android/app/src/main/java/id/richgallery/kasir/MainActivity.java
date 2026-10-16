package id.richgallery.kasir;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Satu layar WebView yang menampilkan aplikasi Rich Gallery.
 * - Mode offline: halaman dimuat dari aset aplikasi di https://rg.lokal/ dan API dijalankan mesin lokal + SQLite di HP.
 * - Mode online: membuka website server (VPS); kemampuan cetak, unduh, dan pilih file tetap disediakan aplikasi.
 */
public class MainActivity extends Activity {
    static final String HOST_LOKAL = "rg.lokal";
    static final String URL_LOKAL = "https://rg.lokal/";
    private static final int REQ_FILE = 7;

    private WebView web;
    private RgDb db;
    private SharedPreferences pref;
    private ValueCallback<Uri[]> pilihFileCb;
    Pembaru pembaru;
    PrinterLangsung printer;

    @Override
    protected void onCreate(Bundle simpanan) {
        super.onCreate(simpanan);
        pref = getSharedPreferences("rg", MODE_PRIVATE);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        db = new RgDb(this);
        pembaru = new Pembaru(this);
        printer = new PrinterLangsung(this);
        pembaru.saatMulai();
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true); // absen: cek lokasi toko
        s.setMediaPlaybackRequiresUserGesture(false); // pratinjau kamera selfie absen
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " RichGalleryApp/" + versi());

        web.addJavascriptInterface(db, "RGDB");
        web.addJavascriptInterface(new RgNative(this), "RGNative");
        web.setWebViewClient(new Klien());
        web.setWebChromeClient(new Krom());
        web.setDownloadListener(this::unduh);
        CookieManager.getInstance().setAcceptCookie(true);

        new Thread(() -> Berkas.cadanganHarian(this, db)).start();
        muat();
        web.postDelayed(() -> pembaru.periksa(false), 4000);
    }

    /* ---------- Mode ---------- */
    String mode() { return pref.getString("mode", "offline"); }
    String server() { return pref.getString("server", ""); }
    String versi() {
        try { PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0); return p.versionName; }
        catch (Exception e) { return "?"; }
    }
    private boolean online() { return "online".equals(mode()) && server().startsWith("https://"); }

    private void muat() {
        db.izinkan = !online();
        web.loadUrl(online() ? server() : URL_LOKAL);
    }

    void gantiMode(String mode, String server) {
        SharedPreferences.Editor e = pref.edit().putString("mode", mode);
        if (!server.isEmpty()) e.putString("server", server);
        e.apply();
        web.clearHistory();
        muat();
        Toast.makeText(this, "online".equals(mode) ? "Mode online: " + server : "Mode offline", Toast.LENGTH_SHORT).show();
    }

    void jalankanJs(String js) { runOnUiThread(() -> web.evaluateJavascript(js, null)); }

    void toast(String pesan) { runOnUiThread(() -> Toast.makeText(this, pesan, Toast.LENGTH_LONG).show()); }

    /** Memberi tahu halaman soal pembaruan: jenis "web" (siap, tinggal muat ulang), "apk" (versi aplikasi baru), atau "info". */
    void kabariHalaman(String jenis, String teks) {
        jalankanJs("window.rgPembaruan ? window.rgPembaruan(" + JSONObject.quote(jenis) + "," + JSONObject.quote(teks) + ") : 0");
    }

    /** Membuka penginstal Android untuk APK pembaruan yang sudah diunduh. */
    void bukaPenginstal(File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(this, "Izinkan Rich Gallery memasang aplikasi, lalu ketuk Pasang sekali lagi.", Toast.LENGTH_LONG).show();
            try { startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); }
            catch (ActivityNotFoundException ignored) { }
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(BerkasProvider.uri(apk), "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "Penginstal Android tidak ditemukan", Toast.LENGTH_LONG).show(); }
    }

    /* ---------- Cetak: halaman memakai CSS cetak sehingga hanya struk/label yang tercetak ---------- */
    void cetak(int kertasMm) {
        try {
            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
            if (kertasMm == 210) { // nota / invoice A4 mendatar, berwarna (printer biasa)
                PrintDocumentAdapter a4 = web.createPrintDocumentAdapter("Nota Rich Gallery");
                PrintAttributes attrA4 = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape())
                        .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                        .build();
                pm.print("Nota Rich Gallery", a4, attrA4);
                return;
            }
            PrintDocumentAdapter adapter = web.createPrintDocumentAdapter("Struk Rich Gallery");
            int lebarMils = Math.round((kertasMm == 80 ? 80 : 58) / 25.4f * 1000);
            PrintAttributes attr = new PrintAttributes.Builder()
                    .setMediaSize(new PrintAttributes.MediaSize("RG" + kertasMm, "Struk " + kertasMm + " mm", lebarMils, 11690))
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                    .build();
            pm.print("Struk Rich Gallery", adapter, attr);
        } catch (Exception e) {
            Toast.makeText(this, "Tidak bisa membuka layanan cetak: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** Cetak dengan ukuran kertas bebas (mis. kartu ucapan seukuran desain Canva), berwarna, tanpa margin. */
    void cetakUkuran(float lebarMm, float tinggiMm) {
        try {
            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
            PrintDocumentAdapter adapter = web.createPrintDocumentAdapter("Kartu ucapan Rich Gallery");
            int w = Math.round(lebarMm / 25.4f * 1000), h = Math.round(tinggiMm / 25.4f * 1000);
            PrintAttributes attr = new PrintAttributes.Builder()
                    .setMediaSize(new PrintAttributes.MediaSize("RGK" + w + "x" + h, "Kartu " + Math.round(lebarMm) + " x " + Math.round(tinggiMm) + " mm", w, h))
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                    .build();
            pm.print("Kartu ucapan Rich Gallery", adapter, attr);
        } catch (Exception e) {
            Toast.makeText(this, "Tidak bisa membuka layanan cetak: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /* ---------- Unduhan dari website (mode online), mis. cadangan .db ---------- */
    private void unduh(String url, String ua, String disposisi, String mime, long panjang) {
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) r.addRequestHeader("Cookie", cookie);
            r.addRequestHeader("User-Agent", ua);
            String nama = URLUtil.guessFileName(url, disposisi, mime);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= 29) r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, Berkas.SUBFOLDER + "/" + nama);
            else r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, Berkas.SUBFOLDER + "/" + nama);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Mengunduh " + nama + " ke folder Download/" + Berkas.SUBFOLDER, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Gagal mengunduh: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    void bukaDengan(String url, String paket) {
        Uri u = Uri.parse(url);
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if ("browser".equals(paket)) {
            // Paksa ke peramban (bukan aplikasi yang biasanya menangkap link ini)
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setSelector(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER));
        } else if (paket != null && !paket.isEmpty()) {
            i.setPackage(paket);
        }
        try { startActivity(i); }
        catch (ActivityNotFoundException e) {
            if (paket != null && !paket.isEmpty() && !"browser".equals(paket)) toast("Aplikasinya belum terpasang, dibuka dengan cara biasa.");
            bukaLuar(u);
        }
    }

    private void bukaLuar(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
        catch (ActivityNotFoundException e) {
            Toast.makeText(this, "rawbt".equals(u.getScheme()) ? "Aplikasi RawBT belum terpasang. Pasang dari Play Store, atau pilih cara cetak Chrome di Pengaturan." : "Tidak ada aplikasi untuk membuka tautan ini", Toast.LENGTH_LONG).show();
        }
    }

    /* ---------- Aset aplikasi dilayani dari https://rg.lokal/ (supaya modul JavaScript & penyimpanan berjalan normal) ---------- */
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html"); MIME.put("js", "text/javascript"); MIME.put("css", "text/css");
        MIME.put("svg", "image/svg+xml"); MIME.put("png", "image/png"); MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json"); MIME.put("ico", "image/x-icon");
        MIME.put("ttf", "font/ttf"); MIME.put("txt", "text/plain");
    }

    private WebResourceResponse aset(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        if (path.startsWith("/public/")) path = path.substring("/public".length());
        if (path.contains("..")) return kosong(404);
        String nama = path.substring(path.lastIndexOf('/') + 1);
        if (!nama.contains(".")) path = "/index.html";
        String ext = path.substring(path.lastIndexOf('.') + 1);
        try {
            // Paket hasil pembaruan otomatis (bila ada) diutamakan; selain itu aset bawaan APK.
            InputStream in = null;
            File ota = pembaru.folderAktif();
            if (ota != null) { File f = new File(ota, path.substring(1)); if (f.isFile()) in = new FileInputStream(f); }
            if (in == null) in = getAssets().open("www" + path);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            return new WebResourceResponse(mime, "utf-8", 200, "OK", h, in);
        } catch (IOException e) {
            return kosong(404);
        }
    }

    private static WebResourceResponse kosong(int status) {
        return new WebResourceResponse("text/plain", "utf-8", status, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private class Klien extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST_LOKAL.equals(u.getHost())) return aset(u.getPath());
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String skema = u.getScheme() == null ? "" : u.getScheme();
            if (skema.equals("https") || skema.equals("http")) {
                String host = u.getHost() == null ? "" : u.getHost();
                if (host.equals(HOST_LOKAL)) return false;
                if (online() && host.equalsIgnoreCase(Uri.parse(server()).getHost())) return false;
            }
            // WhatsApp, RawBT, telepon, dan situs lain dibuka di aplikasi masing-masing.
            bukaLuar(u);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame() && online()) {
                view.loadUrl(URL_LOKAL + "gagal.html?u=" + Uri.encode(server()) + "&e=" + Uri.encode(String.valueOf(err.getDescription())));
            }
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap ikon) {
            // Database lokal hanya untuk halaman aplikasi sendiri.
            db.izinkan = url != null && url.startsWith(URL_LOKAL) && !online();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            // Mesin tampilan berhenti (mis. memori penuh): buka ulang layar tanpa menutup aplikasi.
            recreate();
            return true;
        }
    }

    private class Krom extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (pilihFileCb != null) pilihFileCb.onReceiveValue(null);
            pilihFileCb = cb;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(i, "Pilih file"), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                pilihFileCb = null;
                cb.onReceiveValue(null);
                return false;
            }
            return true;
        }

        /** Kamera untuk foto selfie absen: hanya untuk halaman aplikasi sendiri. */
        @Override
        public void onPermissionRequest(final PermissionRequest r) {
            runOnUiThread(() -> mintaKamera(r));
        }

        /** Lokasi untuk memastikan absen dilakukan di toko. */
        @Override
        public void onGeolocationPermissionsShowPrompt(String asal, GeolocationPermissions.Callback cb) {
            runOnUiThread(() -> mintaLokasi(asal, cb));
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d("RichGallery", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int hasil, Intent data) {
        super.onActivityResult(req, hasil, data);
        if (req == REQ_FILE && pilihFileCb != null) {
            Uri[] r = hasil == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null;
            pilihFileCb.onReceiveValue(r);
            pilihFileCb = null;
        }
    }

    /* ---------- Izin kamera & lokasi untuk absen (hanya halaman aplikasi sendiri / server toko) ---------- */
    static final int KODE_KAMERA = 71, KODE_LOKASI = 72;
    private PermissionRequest kameraTunda;
    private String lokasiAsal;
    private GeolocationPermissions.Callback lokasiCb;

    private boolean asalSendiri(String asal) {
        try {
            String host = Uri.parse(asal).getHost();
            if (host == null) return false;
            return host.equals(HOST_LOKAL) || (online() && host.equalsIgnoreCase(Uri.parse(server()).getHost()));
        } catch (Exception e) { return false; }
    }
    private boolean punyaIzin(String izin) {
        return checkSelfPermission(izin) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    void mintaKamera(PermissionRequest r) {
        boolean video = false;
        for (String x : r.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(x)) video = true;
        if (!video || !asalSendiri(r.getOrigin().toString())) { r.deny(); return; }
        if (punyaIzin(android.Manifest.permission.CAMERA)) { r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); return; }
        if (kameraTunda != null) kameraTunda.deny();
        kameraTunda = r;
        requestPermissions(new String[]{android.Manifest.permission.CAMERA}, KODE_KAMERA);
    }

    void mintaLokasi(String asal, GeolocationPermissions.Callback cb) {
        if (!asalSendiri(asal)) { cb.invoke(asal, false, false); return; }
        if (punyaIzin(android.Manifest.permission.ACCESS_FINE_LOCATION) || punyaIzin(android.Manifest.permission.ACCESS_COARSE_LOCATION)) { cb.invoke(asal, true, false); return; }
        if (lokasiCb != null) lokasiCb.invoke(lokasiAsal, false, false);
        lokasiAsal = asal; lokasiCb = cb;
        requestPermissions(new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION}, KODE_LOKASI);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] izin, int[] hasil) {
        super.onRequestPermissionsResult(req, izin, hasil);
        boolean ok = false;
        for (int h : hasil) if (h == android.content.pm.PackageManager.PERMISSION_GRANTED) ok = true;
        if (req == KODE_KAMERA && kameraTunda != null) {
            if (ok) kameraTunda.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); else kameraTunda.deny();
            kameraTunda = null;
            if (!ok) toast("Izin kamera ditolak. Foto selfie absen butuh kamera.");
        }
        if (req == KODE_LOKASI && lokasiCb != null) {
            lokasiCb.invoke(lokasiAsal, ok, false);
            lokasiCb = null;
            if (!ok) toast("Izin lokasi ditolak. Absen butuh lokasi untuk memastikan di toko.");
        }
        if (req == PrinterLangsung.KODE_IZIN && printer != null)
            printer.hasilIzin(hasil.length > 0 && hasil[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
    }

    @Override
    public void onBackPressed() {
        // Tutup jendela/keranjang di halaman dulu; bila tidak ada, kembali ke halaman sebelumnya atau sembunyikan aplikasi.
        web.evaluateJavascript("(window.rgBack && window.rgBack()) ? '1' : '0'", v -> {
            if ("\"1\"".equals(v)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override protected void onResume() { super.onResume(); web.onResume(); if (pembaru != null) pembaru.periksa(false); }
    @Override protected void onPause() { web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onDestroy() { db.tutup(); web.destroy(); super.onDestroy(); }
}
