package id.richgallery.kasir;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Bagian pembaruan yang tidak bergantung pada Android (bisa diuji dengan Java biasa). */
final class PaketUpdate {
    private PaketUpdate() { }

    /** Unduh lewat https, mengikuti pengalihan (GitHub Releases → penyimpanan file). */
    static byte[] unduh(String url, int maks) throws IOException {
        String u = url;
        for (int lompat = 0; lompat < 8; lompat++) {
            if (!u.startsWith("https://")) throw new IOException("Hanya https yang diizinkan");
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", "RichGalleryApp");
            c.setRequestProperty("Cache-Control", "no-cache");
            int s = c.getResponseCode();
            if (s >= 300 && s < 400) {
                String lok = c.getHeaderField("Location");
                c.disconnect();
                if (lok == null) throw new IOException("Pengalihan tanpa alamat");
                u = new URL(new URL(u), lok).toString();
                continue;
            }
            if (s != 200) { c.disconnect(); throw new IOException("Server pembaruan membalas " + s); }
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n, total = 0;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > maks) throw new IOException("File pembaruan terlalu besar");
                    out.write(buf, 0, n);
                }
                return out.toByteArray();
            } finally { c.disconnect(); }
        }
        throw new IOException("Terlalu banyak pengalihan");
    }

    /** Memeriksa tanda tangan RSA-SHA256 dengan kunci publik sertifikat aplikasi. */
    static boolean cekTandaTangan(byte[] data, byte[] tandaTangan, PublicKey kunci) {
        try {
            Signature s = Signature.getInstance("SHA256withRSA");
            s.initVerify(kunci);
            s.update(data);
            return s.verify(tandaTangan);
        } catch (Exception e) {
            return false;
        }
    }

    static String sha256Hex(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }

    /** Ekstrak zip ke folder tujuan. Nama berbahaya (../, path absolut) ditolak. */
    static int ekstrakZip(byte[] zip, File tujuan) throws IOException {
        if (!tujuan.exists() && !tujuan.mkdirs()) throw new IOException("Tidak bisa membuat folder pembaruan");
        String akar = tujuan.getCanonicalPath() + File.separator;
        int n = 0;
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[16384];
            while ((e = z.getNextEntry()) != null) {
                File f = new File(tujuan, e.getName());
                if (!f.getCanonicalPath().startsWith(akar)) throw new IOException("Isi pembaruan tidak aman: " + e.getName());
                if (e.isDirectory()) { f.mkdirs(); continue; }
                File p = f.getParentFile();
                if (p != null && !p.exists()) p.mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    int r;
                    while ((r = z.read(buf)) > 0) out.write(buf, 0, r);
                }
                n++;
            }
        }
        return n;
    }

    static void hapus(File f) {
        if (f == null || !f.exists()) return;
        File[] isi = f.listFiles();
        if (isi != null) for (File x : isi) hapus(x);
        f.delete();
    }
}
