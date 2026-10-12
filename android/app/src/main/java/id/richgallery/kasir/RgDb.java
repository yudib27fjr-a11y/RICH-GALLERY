package id.richgallery.kasir;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Jembatan database untuk mesin lokal (window.RGDB).
 * Mesin JavaScript mengirim teks SQL lengkap (parameter sudah disisipkan & di-escape), satu pernyataan per panggilan.
 * Semua panggilan JavaScript datang dari satu thread "JavaBridge", jadi transaksi Android tetap di thread yang sama.
 */
public class RgDb {
    static final String NAMA_FILE = "rich-gallery.db";

    private final Context ctx;
    private final Object kunci = new Object();
    private SQLiteDatabase db;
    /** true di antara begin() dan commit()/rollback() dari JavaScript (bisa terdiri dari banyak panggilan). */
    private boolean dalamTx = false;
    /** Hanya aktif di mode offline, supaya halaman dari server online tidak bisa menyentuh database HP. */
    volatile boolean izinkan = true;

    RgDb(Context c) {
        ctx = c.getApplicationContext();
        buka();
    }

    File file() { return ctx.getDatabasePath(NAMA_FILE); }

    private void buka() {
        File f = file();
        File dir = f.getParentFile();
        if (dir != null && !dir.exists()) dir.mkdirs();
        db = SQLiteDatabase.openDatabase(f.getPath(), null, SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY);
        // Jurnal biasa (bukan WAL): file .db selalu utuh setelah transaksi, sehingga cadangan cukup disalin saat terkunci.
        db.disableWriteAheadLogging();
        db.setForeignKeyConstraintsEnabled(true);
    }

    void tutup() {
        synchronized (kunci) {
            try { if (db != null && db.isOpen()) db.close(); } catch (Exception ignored) { }
        }
    }

    private static String galat(Exception e) {
        try { return new JSONObject().put("error", String.valueOf(e.getMessage())).toString(); }
        catch (Exception x) { return "{\"error\":\"Galat database\"}"; }
    }
    private static final String DITOLAK = "{\"error\":\"Database lokal hanya bisa dipakai di mode offline\"}";

    @JavascriptInterface
    public String exec(String sql) {
        if (!izinkan) return DITOLAK;
        synchronized (kunci) {
            try { db.execSQL(sql); return "{}"; }
            catch (Exception e) { return galat(e); }
        }
    }

    @JavascriptInterface
    public String query(String sql) {
        if (!izinkan) return DITOLAK;
        synchronized (kunci) {
            Cursor c = null;
            try {
                c = db.rawQuery(sql, null);
                JSONArray rows = new JSONArray();
                String[] kolom = c.getColumnNames();
                while (c.moveToNext()) {
                    JSONObject o = new JSONObject();
                    for (int i = 0; i < kolom.length; i++) {
                        switch (c.getType(i)) {
                            case Cursor.FIELD_TYPE_INTEGER: o.put(kolom[i], c.getLong(i)); break;
                            case Cursor.FIELD_TYPE_FLOAT: o.put(kolom[i], c.getDouble(i)); break;
                            case Cursor.FIELD_TYPE_STRING: o.put(kolom[i], c.getString(i)); break;
                            default: o.put(kolom[i], JSONObject.NULL);
                        }
                    }
                    rows.put(o);
                }
                return new JSONObject().put("rows", rows).toString();
            } catch (Exception e) {
                return galat(e);
            } finally {
                if (c != null) c.close();
            }
        }
    }

    @JavascriptInterface
    public String run(String sql) {
        if (!izinkan) return DITOLAK;
        synchronized (kunci) {
            SQLiteStatement st = null;
            try {
                String awal = sql.trim().toUpperCase(Locale.ROOT);
                st = db.compileStatement(sql);
                long changes = 0, id = 0;
                if (awal.startsWith("INSERT") || awal.startsWith("REPLACE")) {
                    long r = st.executeInsert();
                    changes = r == -1 ? 0 : 1;
                    id = r == -1 ? 0 : r;
                } else if (awal.startsWith("UPDATE") || awal.startsWith("DELETE")) {
                    changes = st.executeUpdateDelete();
                } else {
                    st.execute();
                }
                return new JSONObject().put("changes", changes).put("lastInsertRowid", id).toString();
            } catch (Exception e) {
                return galat(e);
            } finally {
                if (st != null) st.close();
            }
        }
    }

    @JavascriptInterface
    public String begin() {
        if (!izinkan) return DITOLAK;
        synchronized (kunci) {
            try {
                // Bila ada transaksi yang tertinggal (mis. halaman dimuat ulang di tengah jalan), batalkan dulu.
                while (db.inTransaction()) db.endTransaction();
                db.beginTransaction();
                dalamTx = true;
                return "{}";
            } catch (Exception e) { return galat(e); }
        }
    }

    @JavascriptInterface
    public String commit() {
        synchronized (kunci) {
            try { db.setTransactionSuccessful(); db.endTransaction(); dalamTx = false; return "{}"; }
            catch (Exception e) { return galat(e); }
        }
    }

    @JavascriptInterface
    public String rollback() {
        synchronized (kunci) {
            try { if (db.inTransaction()) db.endTransaction(); dalamTx = false; return "{}"; }
            catch (Exception e) { return galat(e); }
        }
    }

    /** Salinan utuh database saat ini, aman walau sedang dipakai. */
    byte[] salinan() throws IOException {
        // Tunggu sampai tidak ada transaksi yang sedang berjalan, lalu salin file selagi terkunci.
        for (int i = 0; i < 200; i++) {
            synchronized (kunci) {
                if (!dalamTx) return bacaFile(file());
            }
            try { Thread.sleep(25); } catch (InterruptedException e) { break; }
        }
        throw new IOException("Database sedang sibuk, coba lagi sebentar");
    }

    @JavascriptInterface
    public String cadangan() {
        if (!izinkan) return DITOLAK;
        try {
            String nama = "rich-gallery-" + new SimpleDateFormat("yyyy-MM-dd-HHmm", Locale.ROOT).format(new Date()) + ".db";
            String lokasi = Berkas.simpanKeDownload(ctx, nama, "application/octet-stream", salinan());
            return new JSONObject().put("lokasi", lokasi).toString();
        } catch (Exception e) { return galat(e); }
    }

    /** Ganti seluruh database dengan file cadangan (.db) dari HP lain atau dari server. */
    @JavascriptInterface
    public String pulihkan(String b64) {
        if (!izinkan) return DITOLAK;
        File calon = new File(ctx.getCacheDir(), "pulihkan.db");
        try {
            byte[] isi = Base64.decode(b64, Base64.DEFAULT);
            if (isi.length < 100 || !new String(isi, 0, 15, "ISO-8859-1").equals("SQLite format 3")) throw new IOException("Bukan file database SQLite");
            tulisFile(calon, isi);
            SQLiteDatabase cek = SQLiteDatabase.openDatabase(calon.getPath(), null, SQLiteDatabase.OPEN_READONLY);
            try {
                Cursor c = cek.rawQuery("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users','products','materials','sales','settings')", null);
                int n; try { c.moveToFirst(); n = c.getInt(0); } finally { c.close(); }
                if (n != 5) throw new IOException("File ini bukan database Rich Gallery");
                Cursor k = cek.rawQuery("PRAGMA integrity_check", null);
                String hasil; try { k.moveToFirst(); hasil = k.getString(0); } finally { k.close(); }
                if (!"ok".equalsIgnoreCase(hasil)) throw new IOException("File cadangan rusak");
            } finally { cek.close(); }

            synchronized (kunci) {
                // Simpan data lama dulu, jaga-jaga salah pilih file.
                try { Berkas.simpanKeDownload(ctx, "sebelum-pulihkan-" + System.currentTimeMillis() + ".db", "application/octet-stream", salinan()); } catch (Exception ignored) { }
                while (db.inTransaction()) db.endTransaction();
                dalamTx = false;
                db.close();
                File f = file();
                for (String akhiran : new String[]{"-wal", "-shm", "-journal"}) new File(f.getPath() + akhiran).delete();
                tulisFile(f, isi);
                buka();
            }
            return "{}";
        } catch (Exception e) {
            synchronized (kunci) { if (db == null || !db.isOpen()) buka(); }
            return galat(e);
        } finally {
            calon.delete();
        }
    }

    static byte[] bacaFile(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int pos = 0, n;
            while (pos < buf.length && (n = in.read(buf, pos, buf.length - pos)) > 0) pos += n;
            return buf;
        }
    }

    static void tulisFile(File f, byte[] isi) throws IOException {
        try (OutputStream out = new FileOutputStream(f)) { out.write(isi); }
    }
}
