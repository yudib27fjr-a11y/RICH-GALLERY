/**
 * SINKRON APLIKASI KASIR RICH GALLERY  ->  Google Sheet "PEMBUKUAN RG 2026"
 *
 * Cara pasang (sekali saja, oleh pemilik sheet):
 * 1. Buka Google Sheet PEMBUKUAN RG 2026 > menu Ekstensi > Apps Script.
 * 2. Hapus isi Code.gs, tempel seluruh isi file ini, klik Simpan.
 * 3. Klik Terapkan (Deploy) > Deployment baru > pilih jenis "Aplikasi web".
 *      - Jalankan sebagai: Saya (akun pemilik sheet)
 *      - Yang memiliki akses: Siapa saja
 *    Klik Terapkan, izinkan akses, lalu salin URL yang berakhiran /exec.
 * 4. Di aplikasi kasir: Pengaturan > Sinkron ke Google Sheet > tempel URL tersebut.
 *
 * Skrip ini hanya MENAMBAH baris ke tab berawalan "APP ". Tab lama Anda
 * (PENJUALAN, STOK OPNAME, BARANG MASUK, dst.) tidak diubah sama sekali.
 */

const HEADERS = {
  penjualan: ['ID Transaksi','Tanggal','Jam','No Invoice','Kode','Nama Barang','Kategori','Harga','Qty','Subtotal','Stok','Customer','No HP','Kasir','Metode Bayar','Diskon','Ongkir','HPP','Catatan'],
  batal:     ['ID Transaksi','No Invoice','Tanggal Batal','Jam','Oleh','Total'],
  masuk:     ['Tanggal','Jam','Jenis','Kode','Nama Barang','Qty','Stok Setelah','Keterangan','Oleh'],
  keluar:    ['Tanggal','Jam','Jenis','Kode','Nama Barang','Qty','Stok Setelah','Keterangan','Oleh'],
  opname:    ['Tanggal','Jam','Jenis','Kode','Nama Barang','Stok Sistem','Stok Fisik','Selisih','Oleh','Keterangan'],
  pengeluaran: ['ID','Tanggal','Kategori','Keterangan','Nominal','Oleh'],
  hapus_pengeluaran: ['ID','Tanggal Hapus','Oleh'],
  produksi:  ['Tanggal','Kode','Nama Barang','Qty','Pembuat','Tarif Insentif','Insentif','Jenis','Dicatat Oleh'],
  hapus_produksi: ['Tanggal Produksi','Kode','Nama Barang','Qty','Pembuat','Tanggal Hapus','Oleh'],
  insentif:  ['Tanggal Bayar','Nama','Periode Dari','Periode Sampai','Total Produksi','Insentif Dihitung','Dibayar','Catatan','Oleh'],
  insentif_lain: ['Tanggal','Nama','Jenis','Nominal','Keterangan','Dicatat Oleh']
};
const TAB = {
  penjualan: 'APP PENJUALAN', batal: 'APP PENJUALAN BATAL', masuk: 'APP BARANG MASUK', keluar: 'APP BARANG KELUAR',
  opname: 'APP STOK OPNAME', pengeluaran: 'APP PENGELUARAN', hapus_pengeluaran: 'APP PENGELUARAN DIHAPUS',
  produksi: 'APP PRODUKSI KARYAWAN', hapus_produksi: 'APP PRODUKSI DIHAPUS', insentif: 'APP INSENTIF DIBAYAR',
  insentif_lain: 'APP INSENTIF LAIN'
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    const groups = {};
    (data.items || []).forEach(function (it) {
      if (!TAB[it.type]) return;
      (groups[it.type] = groups[it.type] || []).push(it.row);
    });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Object.keys(groups).forEach(function (type) {
      const sh = ambilTab(ss, type);
      const rows = groups[type];
      const width = HEADERS[type].length;
      const norm = rows.map(function (r) { const x = r.slice(0, width); while (x.length < width) x.push(''); return x; });
      sh.getRange(sh.getLastRow() + 1, 1, norm.length, width).setValues(norm);
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('Sinkron Kasir Rich Gallery aktif.');
}

function ambilTab(ss, type) {
  let sh = ss.getSheetByName(TAB[type]);
  if (!sh) {
    sh = ss.insertSheet(TAB[type]);
    sh.getRange(1, 1, 1, HEADERS[type].length).setValues([HEADERS[type]]).setFontWeight('bold').setBackground('#8e1d4b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
