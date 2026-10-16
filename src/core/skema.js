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

/* 3: absensi sidik jari (mesin Fingerspot mengirim setiap scan ke server lewat webhook). */
`ALTER TABLE users ADD COLUMN pin_absen TEXT;
CREATE UNIQUE INDEX users_pin_absen ON users(pin_absen) WHERE pin_absen IS NOT NULL AND pin_absen <> '';
CREATE TABLE absen(
  id INTEGER PRIMARY KEY,
  tgl TEXT NOT NULL,
  jam TEXT NOT NULL,
  pin TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  sumber TEXT NOT NULL DEFAULT 'mesin' CHECK (sumber IN ('mesin','manual')),
  mesin TEXT NOT NULL DEFAULT '',
  verify TEXT,
  status_scan TEXT,
  ket TEXT NOT NULL DEFAULT '',
  oleh TEXT NOT NULL DEFAULT '',
  dihapus TEXT,
  dibuat TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX absen_tgl ON absen(tgl);
CREATE UNIQUE INDEX absen_scan ON absen(mesin, pin, tgl, jam) WHERE sumber = 'mesin';`,

/* 4: pesanan (diambil / diantar nanti) dengan catatan khusus, pelunasan DP, dan status pengambilan. */
`ALTER TABLE sales ADD COLUMN ambil_tgl TEXT;
ALTER TABLE sales ADD COLUMN ambil_jam TEXT;
ALTER TABLE sales ADD COLUMN ambil_cara TEXT;
ALTER TABLE sales ADD COLUMN request TEXT;
ALTER TABLE sales ADD COLUMN diambil_at TEXT;
ALTER TABLE sales ADD COLUMN diambil_oleh TEXT;
ALTER TABLE sales ADD COLUMN lunas_at TEXT;
ALTER TABLE sales ADD COLUMN lunas_metode TEXT;
ALTER TABLE sales ADD COLUMN lunas_oleh TEXT;
CREATE INDEX sales_pesanan ON sales(ambil_tgl) WHERE ambil_tgl IS NOT NULL;`,

/* 5: isi kartu ucapan per transaksi (dicetak / disalin ke Canva). */
`ALTER TABLE sales ADD COLUMN kartu TEXT;`,

/* 6: absen karyawan dengan PIN + foto selfie dari perangkat kasir (iMin) di lokasi toko. */
`CREATE TABLE absen_baru(
  id INTEGER PRIMARY KEY,
  tgl TEXT NOT NULL,
  jam TEXT NOT NULL,
  pin TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  sumber TEXT NOT NULL DEFAULT 'mesin' CHECK (sumber IN ('mesin','manual','pin')),
  mesin TEXT NOT NULL DEFAULT '',
  verify TEXT,
  status_scan TEXT,
  ket TEXT NOT NULL DEFAULT '',
  oleh TEXT NOT NULL DEFAULT '',
  dihapus TEXT,
  dibuat TEXT NOT NULL DEFAULT (datetime('now')),
  jenis TEXT,
  foto TEXT,
  lat REAL,
  lng REAL,
  jarak REAL,
  uid TEXT
);
INSERT INTO absen_baru(id, tgl, jam, pin, user_id, sumber, mesin, verify, status_scan, ket, oleh, dihapus, dibuat)
  SELECT id, tgl, jam, pin, user_id, sumber, mesin, verify, status_scan, ket, oleh, dihapus, dibuat FROM absen;
DROP TABLE absen;
ALTER TABLE absen_baru RENAME TO absen;
CREATE INDEX absen_tgl ON absen(tgl);
CREATE UNIQUE INDEX absen_scan ON absen(mesin, pin, tgl, jam) WHERE sumber = 'mesin';
CREATE UNIQUE INDEX absen_uid ON absen(uid) WHERE uid IS NOT NULL;
ALTER TABLE perangkat ADD COLUMN absen INTEGER NOT NULL DEFAULT 0;`,

/* 7: kartu ucapan memakai huruf "Grown" (permintaan toko). */
`UPDATE settings SET nilai = '"grown"' WHERE kunci = 'kartu_huruf';`,

/* 8: pembuat barang custom / pesanan di transaksi (otomatis tercatat di produksi & insentif). */
`ALTER TABLE sale_items ADD COLUMN pembuat TEXT;`,
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
  cabang_absen: false, // perangkat ini diizinkan admin untuk absen karyawan
  impor_oleh: "",
  // Pesan WhatsApp ke pelanggan setelah transaksi
  wa_otomatis: false,
  wa_template: "Halo {nama}, terima kasih sudah berbelanja di {toko} 🌸\n\nNo. nota: {no}\nTanggal: {tanggal}\nPesanan: {barang}\nTotal: {total}\n\nSemoga suka dengan pesanannya. Ditunggu kedatangannya kembali!",
  // Link template kartu ucapan di Canva
  canva_url: "https://www.canva.com/design/DAGUxNBXd4E/goxmLsKxdhdJwkpg7AbxmA/edit",
  // Kartu ucapan: dicetak seukuran desain Canva, berisi ucapan dari pelanggan
  kartu_lebar: 100,
  kartu_tinggi: 70,
  kartu_huruf: "grown",
  kartu_font: "",
  kartu_font_kode: "",
  kartu_warna: "#3a2a2a",
  kartu_area: "tengah",
  kartu_latar: "",
  kartu_latar_kode: "",
  canva_email: "",
  wa_nomor: "",
  // Absensi sidik jari
  absen_aktif: false,
  absen_token: "",
  absen_mesin: "",
  absen_jam_masuk: "08:00",
  absen_jam_pulang: "17:00",
  absen_terakhir: "",
  // Nota (invoice) A4
  inv_tagline: "Buket, Gift, Hampers, Dekorasi, Seserahan & Mahar",
  inv_bank: "Bank BRI 421201022815539\nSiti Nur Khodijah",
  inv_ttd: "",
  inv_ttd_nama: "Siti Nur Khodijah",
  inv_ttd_jabatan: "Financial Manager",
  // Absen PIN + selfie di perangkat kasir
  absen_pin_aktif: false,
  absen_lat: "-6.3377069", // Rich Gallery, Jl. Olahraga No.27 Sport Center - Indramayu (Google Maps)
  absen_lng: "108.3319216",
  absen_radius: 100,
};
