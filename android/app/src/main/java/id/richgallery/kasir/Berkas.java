package id.richgallery.kasir;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/** Menyimpan file ke folder Download/RichGallery, yang tetap ada walau aplikasi dihapus. */
final class Berkas {
    static final String SUBFOLDER = "RichGallery";
    private Berkas() { }

    /** Menulis (atau menimpa) file di Download/RichGallery. Mengembalikan lokasi yang bisa ditunjukkan ke pengguna. */
    static String simpanKeDownload(Context ctx, String nama, String mime, byte[] isi) throws IOException {
        nama = nama.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = ctx.getContentResolver();
            Uri koleksi = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            String relatif = Environment.DIRECTORY_DOWNLOADS + "/" + SUBFOLDER + "/";
            Uri uri = null;
            Cursor c = cr.query(koleksi, new String[]{MediaStore.MediaColumns._ID},
                    MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                    new String[]{nama, relatif}, null);
            if (c != null) {
                try { if (c.moveToFirst()) uri = Uri.withAppendedPath(koleksi, String.valueOf(c.getLong(0))); } finally { c.close(); }
            }
            if (uri == null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, nama);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, relatif);
                uri = cr.insert(koleksi, v);
                if (uri == null) throw new IOException("Tidak bisa membuat file di folder Download");
            }
            try (OutputStream out = cr.openOutputStream(uri, "wt")) {
                if (out == null) throw new IOException("Tidak bisa menulis file");
                out.write(isi);
            }
            return "Download/" + SUBFOLDER + "/" + nama;
        }
        // Android 9 ke bawah: folder Download milik aplikasi (tanpa izin tambahan).
        File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), SUBFOLDER);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Tidak bisa membuat folder cadangan");
        File f = new File(dir, nama);
        RgDb.tulisFile(f, isi);
        return f.getPath();
    }

    private static final String[] HARI = {"minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu"};

    /** Cadangan otomatis sekali sehari, berputar 7 file (rich-gallery-senin.db … rich-gallery-minggu.db). */
    static void cadanganHarian(Context ctx, RgDb db) {
        SharedPreferences pref = ctx.getSharedPreferences("rg", Context.MODE_PRIVATE);
        String hariIni = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        if (hariIni.equals(pref.getString("cadangan_harian", ""))) return;
        try {
            if (db.file().length() < 8192) return; // database belum berisi
            String nama = "rich-gallery-" + HARI[Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1] + ".db";
            simpanKeDownload(ctx, nama, "application/octet-stream", db.salinan());
            pref.edit().putString("cadangan_harian", hariIni).apply();
        } catch (Exception e) {
            Log.w("RichGallery", "Cadangan harian gagal", e);
        }
    }
}
