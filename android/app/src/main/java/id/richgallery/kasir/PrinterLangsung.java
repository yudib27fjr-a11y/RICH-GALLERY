package id.richgallery.kasir;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.pm.PackageManager;
import android.os.Build;

import com.imin.printer.INeoPrinterCallback;
import com.imin.printer.InitPrinterCallback;
import com.imin.printer.PrinterHelper;

import java.io.OutputStream;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Cetak langsung ke printer bawaan perangkat kasir dengan perintah ESC/POS (teks asli, hitam pekat, tidak buram).
 *
 * Perangkat iMin (dan Sunmi) menyediakan printer bawaan sebagai perangkat Bluetooth virtual yang sudah terpasang:
 * iMin = "BluetoothPrinter", Sunmi = "InnerPrinter". Data ESC/POS dikirim lewat profil serial (SPP).
 * Bisa juga dipakai untuk printer struk Bluetooth biasa yang sudah dipasangkan (nama mengandung "printer").
 *
 * iMin model baru (mis. Swift 2, D4, M2) tidak lagi menyediakan Bluetooth virtual: printernya dilayani aplikasi sistem
 * "com.imin.printerservice". Bila layanan itu ada, data ESC/POS dikirim lewat SDK iMin (sendRAWData) — cara yang sama
 * dengan aplikasi kasir lain — dan Bluetooth hanya dipakai sebagai cadangan.
 */
class PrinterLangsung {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String[] NAMA_BAWAAN = {"bluetoothprinter", "innerprinter", "iposprinter", "imin"};
    static final int KODE_IZIN = 4711;

    private final MainActivity act;
    private final Object kunci = new Object();
    /** Data yang menunggu izin Bluetooth (Android 12+). */
    private volatile byte[] menunggu;

    /** Layanan printer iMin: null = belum dicek / tidak ada, true = tersambung. */
    private volatile boolean iminSiap = false;
    private volatile boolean iminAda = false;

    PrinterLangsung(MainActivity a) {
        act = a;
        mulaiImin();
    }

    private void mulaiImin() {
        try { act.getPackageManager().getPackageInfo("com.imin.printerservice", 0); iminAda = true; }
        catch (Exception e) { iminAda = false; return; }
        try {
            PrinterHelper.getInstance().initPrinterService(act.getApplicationContext(), new InitPrinterCallback() {
                @Override public void onConnected() {
                    iminSiap = true;
                    try { PrinterHelper.getInstance().initPrinter(act.getPackageName(), null); } catch (Throwable ignored) { }
                }
                @Override public void onDisconnected() { iminSiap = false; }
            });
        } catch (Throwable e) { iminAda = false; }
    }

    /** Kirim lewat layanan printer iMin. Mengembalikan true bila terkirim. */
    private boolean kirimImin(byte[] data) {
        if (!iminAda) return false;
        for (int i = 0; i < 30 && !iminSiap; i++) { // tunggu layanan tersambung (maks. 3 detik)
            if (i == 0) mulaiImin();
            try { Thread.sleep(100); } catch (InterruptedException ignored) { }
        }
        if (!iminSiap) return false;
        try {
            PrinterHelper h = PrinterHelper.getInstance();
            // Kirim per potongan supaya buffer layanan tidak meluap.
            for (int i = 0; i < data.length; i += 4096) {
                byte[] p = java.util.Arrays.copyOfRange(data, i, Math.min(data.length, i + 4096));
                h.sendRAWData(p, null);
            }
            return true;
        } catch (Throwable e) {
            act.toast("Printer iMin: " + e.getMessage());
            return false;
        }
    }

    private boolean perluIzin() {
        return Build.VERSION.SDK_INT >= 31 && act.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED;
    }

    /** Printer yang akan dipakai, atau null. Prioritas: printer bawaan iMin/Sunmi, lalu perangkat ber-nama "printer". */
    BluetoothDevice cari() {
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt == null || perluIzin()) return null;
        Set<BluetoothDevice> semua;
        try { semua = bt.getBondedDevices(); } catch (SecurityException e) { return null; }
        if (semua == null) return null;
        BluetoothDevice cadangan = null;
        for (BluetoothDevice d : semua) {
            String n;
            try { n = d.getName(); } catch (SecurityException e) { continue; }
            if (n == null) continue;
            String k = n.toLowerCase(Locale.ROOT).replace(" ", "");
            for (String b : NAMA_BAWAAN) if (k.equals(b) || k.startsWith(b)) return d;
            if (cadangan == null && k.contains("printer")) cadangan = d;
        }
        return cadangan;
    }

    /** Nama printer yang ditemukan, "" bila tidak ada, "izin" bila izin Bluetooth belum diberikan. */
    String status() {
        if (iminSiap || iminAda) return "Printer bawaan iMin";
        if (BluetoothAdapter.getDefaultAdapter() == null) return "";
        if (perluIzin()) return "izin";
        BluetoothDevice d = cari();
        if (d == null) return "";
        try { return d.getName(); } catch (SecurityException e) { return "izin"; }
    }

    void cetak(byte[] data) {
        if (iminAda) { // printer bawaan iMin lewat layanan sistem (tanpa Bluetooth)
            new Thread(() -> { if (!kirimImin(data)) kirimBluetoothAtauIzin(data); }).start();
            return;
        }
        kirimBluetoothAtauIzin(data);
    }

    private void kirimBluetoothAtauIzin(byte[] data) {
        if (perluIzin()) {
            menunggu = data;
            act.runOnUiThread(() -> act.requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, KODE_IZIN));
            return;
        }
        new Thread(() -> kirim(data)).start();
    }

    /** Dipanggil MainActivity setelah pengguna menjawab permintaan izin. */
    void hasilIzin(boolean diizinkan) {
        byte[] d = menunggu; menunggu = null;
        if (!diizinkan) { act.toast("Izin \"Perangkat sekitar\" diperlukan untuk mencetak ke printer bawaan."); return; }
        if (d != null) new Thread(() -> kirim(d)).start();
    }

    private void kirim(byte[] data) {
        synchronized (kunci) {
            BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
            if (bt == null) { act.toast("Perangkat ini tidak punya Bluetooth untuk printer bawaan. Pilih cara cetak lain di Pengaturan."); return; }
            if (!bt.isEnabled()) { act.toast("Nyalakan Bluetooth dulu: printer bawaan iMin tersambung lewat Bluetooth internal."); return; }
            BluetoothDevice d = cari();
            if (d == null) { act.toast(iminAda ? "Layanan printer iMin belum siap. Tutup lalu buka lagi aplikasi, atau pilih cara cetak lain." : "Printer bawaan tidak ditemukan. Cek Pengaturan Android → Bluetooth, atau pilih cara cetak lain."); return; }
            BluetoothSocket s = null;
            Exception galat = null;
            for (int coba = 0; coba < 2; coba++) {
                try {
                    try { bt.cancelDiscovery(); } catch (Exception ignored) { }
                    s = d.createRfcommSocketToServiceRecord(SPP);
                    s.connect();
                    OutputStream out = s.getOutputStream();
                    // Kirim per potongan agar buffer printer tidak meluap.
                    for (int i = 0; i < data.length; i += 1024) {
                        out.write(data, i, Math.min(1024, data.length - i));
                        out.flush();
                        Thread.sleep(20);
                    }
                    // Beri waktu data terkirim penuh sebelum koneksi ditutup.
                    Thread.sleep(Math.min(2000, 300 + data.length / 8));
                    galat = null;
                    break;
                } catch (Exception e) {
                    galat = e;
                    try { Thread.sleep(400); } catch (InterruptedException ignored) { }
                } finally {
                    try { if (s != null) s.close(); } catch (Exception ignored) { }
                    s = null;
                }
            }
            if (galat != null) act.toast("Gagal mencetak ke printer bawaan: " + galat.getMessage());
        }
    }
}
