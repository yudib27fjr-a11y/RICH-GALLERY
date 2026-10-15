/* Skema database bersama: dipakai server Node dan aplikasi Android (SQLite di keduanya).
   Setiap versi skema adalah satu langkah. Tambahkan langkah baru di akhir, jangan ubah langkah lama.
   Tulis satu pernyataan per baris yang diakhiri ";" + baris baru (aplikasi Android menjalankannya satu per satu). */
export const MIGRASI = [
`CREATE TABLE users(
  id INTEGER PRIMARY KEY,
  nama TEXT NOT NULL,
  nama_key TEXT NOT NULL UNIQUE,
  peran TEXT NOT NULL CHECK (peran IN ('admin','karyawan')),
  pass_hash TEXT,
  aktif INTEGER NOT NULL DEFAULT 1,
  dibuat TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kadaluarsa INTEGER NOT NULL,
  dibuat INTEGER NOT NULL
);
CREATE TABLE settings(kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL);

CREATE TABLE products(
  id INTEGER PRIMARY KEY,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  kategori TEXT NOT NULL,
  harga INTEGER NOT NULL DEFAULT 0,
  hpp INTEGER NOT NULL DEFAULT 0,
  stok REAL NOT NULL DEFAULT 0,
  stok_min REAL NOT NULL DEFAULT 0,
  barcode TEXT,
  insentif INTEGER,
  aktif INTEGER NOT NULL DEFAULT 1,
  dihapus TEXT,
  diubah TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX products_kode ON products(kode) WHERE dihapus IS NULL;
CREATE UNIQUE INDEX products_barcode ON products(barcode) WHERE dihapus IS NULL AND barcode IS NOT NULL;

CREATE TABLE materials(
  id INTEGER PRIMARY KEY,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  kategori TEXT NOT NULL DEFAULT 'LAIN-LAIN',
  harga INTEGER NOT NULL DEFAULT 0,
  satuan TEXT NOT NULL DEFAULT 'PCS',
  stok REAL NOT NULL DEFAULT 0,
  stok_min REAL NOT NULL DEFAULT 0,
  barcode TEXT,
  dihapus TEXT,
  diubah TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX materials_kode ON materials(kode) WHERE dihapus IS NULL;
CREATE UNIQUE INDEX materials_barcode ON materials(barcode) WHERE dihapus IS NULL AND barcode IS NOT NULL;

CREATE TABLE sales(
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  tgl TEXT NOT NULL,
  jam TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  kasir TEXT NOT NULL,
  pelanggan TEXT NOT NULL,
  hp TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL,
  diskon INTEGER NOT NULL DEFAULT 0,
  ongkir INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  metode TEXT NOT NULL,
  bayar INTEGER NOT NULL,
  catatan TEXT NOT NULL DEFAULT '',
  batal_at TEXT,
  batal_oleh TEXT,
  batal_alasan TEXT,
  legacy_id TEXT UNIQUE,
  dibuat TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sales_tgl ON sales(tgl);
CREATE TABLE sale_items(
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  kode TEXT NOT NULL DEFAULT '',
  nama TEXT NOT NULL,
  kategori TEXT NOT NULL,
  harga INTEGER NOT NULL,
  qty REAL NOT NULL,
  hpp INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sale_items_sale ON sale_items(sale_id);

CREATE TABLE stock_moves(
  id INTEGER PRIMARY KEY,
  tgl TEXT NOT NULL,
  jam TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('produk','bahan')),
  item_id INTEGER,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  tipe TEXT NOT NULL CHECK (tipe IN ('masuk','keluar','opname','koreksi','jual','batal','produksi','hapus_produksi')),
  qty REAL NOT NULL,
  stok_sebelum REAL,
  stok_sesudah REAL,
  ref TEXT NOT NULL DEFAULT '',
  ket TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  oleh TEXT NOT NULL DEFAULT '',
  legacy_id TEXT UNIQUE,
  dibuat TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX stock_moves_tipe ON stock_moves(tipe, tgl);

CREATE TABLE produksi(
  id INTEGER PRIMARY KEY,
  tgl TEXT NOT NULL,
  product_id INTEGER REFERENCES products(id),
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  qty REAL NOT NULL,
  pembuat_id INTEGER NOT NULL REFERENCES users(id),
  tarif INTEGER NOT NULL,
  restock INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER,
  oleh TEXT NOT NULL DEFAULT '',
  legacy_id TEXT UNIQUE,
  dibuat TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX produksi_tgl ON produksi(tgl);

CREATE TABLE insentif_bayar(
  id INTEGER PRIMARY KEY,
  pembuat_id INTEGER NOT NULL REFERENCES users(id),
  periode_dari TEXT NOT NULL,
  periode_sampai TEXT NOT NULL,
  qty REAL NOT NULL,
  hitung INTEGER NOT NULL,
  nominal INTEGER NOT NULL,
  tgl TEXT NOT NULL,
  ket TEXT NOT NULL DEFAULT '',
  expense_id INTEGER,
  user_id INTEGER,
  oleh TEXT NOT NULL DEFAULT '',
  dibuat TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pembuat_id, periode_dari)
);

CREATE TABLE expenses(
  id INTEGER PRIMARY KEY,
  tgl TEXT NOT NULL,
  kategori TEXT NOT NULL,
  ket TEXT NOT NULL DEFAULT '',
  nominal INTEGER NOT NULL,
  user_id INTEGER,
  oleh TEXT NOT NULL DEFAULT '',
  dihapus TEXT,
  legacy_id TEXT UNIQUE,
  dibuat TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX expenses_tgl ON expenses(tgl);

CREATE TABLE outbox(
  id INTEGER PRIMARY KEY,
  tipe TEXT NOT NULL,
  baris TEXT NOT NULL,
  dibuat TEXT NOT NULL DEFAULT (datetime('now')),
  terkirim TEXT,
  percobaan INTEGER NOT NULL DEFAULT 0,
  galat TEXT
);
CREATE INDEX outbox_pending ON outbox(id) WHERE terkirim IS NULL;`,

/* 2: sinkron perangkat cabang (offline) ke server pusat. */
`ALTER TABLE produksi ADD COLUMN uid TEXT;
CREATE UNIQUE INDEX produksi_uid ON produksi(uid) WHERE uid IS NOT NULL;
ALTER TABLE expenses ADD COLUMN uid TEXT;
CREATE UNIQUE INDEX expenses_uid ON expenses(uid) WHERE uid IS NOT NULL;
CREATE TABLE cabang_kirim(
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  aksi TEXT NOT NULL,
  data TEXT NOT NULL,
  waktu TEXT NOT NULL,
  oleh TEXT NOT NULL DEFAULT '',
  dibuat TEXT NOT NULL DEFAULT (datetime('now')),
  terkirim TEXT,
  hasil TEXT,
  percobaan INTEGER NOT NULL DEFAULT 0,
  galat TEXT
);
CREATE INDEX cabang_kirim_pending ON cabang_kirim(id) WHERE terkirim IS NULL;
CREATE TABLE cabang_terima(
  uid TEXT PRIMARY KEY,
  perangkat_id INTEGER,
  aksi TEXT NOT NULL,
  status TEXT NOT NULL,
  pesan TEXT,
  diterima TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE perangkat(
  id INTEGER PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  admin_id INTEGER,
  dibuat TEXT NOT NULL DEFAULT (datetime('now')),
  terakhir TEXT,
  dicabut TEXT
);`,
];

export const DEFAULT_SETTINGS = {
  nama_toko: "RICH GALLERY",
  alamat: "Jl. Olahraga No.27 Sport Center - Indramayu",
  telp: "",
  footer: "Transfer: Bank Mandiri\na.n. Siti Nur Khodijah\nNo Rek 1340021896906\n\nTerima kasih telah berbelanja",
  prefix: "RG/SC/",
  no_berikutnya: 1180,
  hpp_persen: 45,
  insentif: 2500,
  periode_mulai: 15,
  sync_url: "",
  sheet_id: "1dCUGkIgl0kzF4CaA-tlQxIspoWqUJ9Go5zV86148AwQ",
  // Diisi saat perangkat ini disambungkan ke server pusat (mode cabang).
  cabang_url: "",
  cabang_token: "",
  cabang_kode: "",
  cabang_nama: "",
};
