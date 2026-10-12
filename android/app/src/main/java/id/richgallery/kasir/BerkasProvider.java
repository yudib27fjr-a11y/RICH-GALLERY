package id.richgallery.kasir;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Menyerahkan file APK pembaruan ke penginstal Android (pengganti FileProvider, tanpa library tambahan). */
public class BerkasProvider extends ContentProvider {
    static final String OTORITAS = "id.richgallery.kasir.berkas";

    static File folder(android.content.Context c) { return new File(c.getCacheDir(), "pembaruan"); }
    static Uri uri(File f) { return Uri.parse("content://" + OTORITAS + "/" + f.getName()); }

    private File file(Uri u) throws FileNotFoundException {
        String nama = u.getLastPathSegment();
        if (nama == null || nama.contains("/") || nama.contains("..")) throw new FileNotFoundException();
        File f = new File(folder(getContext()), nama);
        if (!f.isFile()) throw new FileNotFoundException();
        return f;
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri u, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(file(u), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri u) { return "application/vnd.android.package-archive"; }

    @Override
    public Cursor query(Uri u, String[] kolom, String sel, String[] arg, String urut) {
        try {
            File f = file(u);
            MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            c.addRow(new Object[]{f.getName(), f.length()});
            return c;
        } catch (FileNotFoundException e) { return null; }
    }

    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
