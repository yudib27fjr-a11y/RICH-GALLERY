# Rich Gallery — Kasir, Stok & Produksi

Aplikasi kasir untuk Rich Gallery: penjualan dan struk termal, barcode, stok produk jadi dan bahan baku, barang masuk/keluar, stok opname, produksi dan insentif karyawan, pengeluaran, laporan laba, serta sinkron ke Google Sheet **PEMBUKUAN RG 2026**.

Tersedia dalam dua bentuk yang memakai **aturan bisnis yang sama persis** (`src/core/`):

| | Aplikasi Android (offline) | Website (online, VPS) |
|---|---|---|
| Data disimpan di | HP/perangkat iMin itu sendiri | server, dipakai bersama semua perangkat |
| Butuh internet | tidak (hanya untuk kirim ke Google Sheet) | ya |
| Cocok untuk | satu perangkat kasir di toko | beberapa kasir/HP, admin memantau dari rumah |
| Panduan | [`android/README.md`](android/README.md) | bagian 2–8 di bawah |

Pindah dari Android offline ke website online cukup dengan memulihkan file cadangan dari HP di website (lihat `android/README.md` bagian 6). Format databasenya sama.

- **Server:** Node.js 22.13 atau lebih baru, **tanpa paket npm**. Hanya memakai modul bawaan Node (`http`, `sqlite`, `crypto`), jadi tidak perlu `npm install` dan tidak ada library pihak ketiga yang perlu dirawat.
- **Database:** SQLite, satu file `data/rich-gallery.db`. Cadangan cukup dengan menyalin satu file.
- **Pengguna:** admin dan karyawan, masing-masing login sendiri. Karyawan bisa memakai PIN 4 angka.

---

## 1. Hak akses

| Menu | Admin | Karyawan |
|---|---|---|
| Kasir, cetak struk, scan barcode | ✔ | ✔ (tanggal selalu hari ini) |
| Transaksi | semua tanggal, bisa membatalkan | hanya hari ini, tidak bisa membatalkan |
| Produksi | semua karyawan, bayar insentif | catat produksi, lihat insentif sendiri |
| Stok | tambah/ubah/hapus barang, lihat HPP | lihat stok & riwayat, cetak label |
| Masuk/Keluar, Opname | ✔ | ✔ |
| Pengeluaran, Laporan | ✔ | – |
| Pengaturan | toko, pengguna, sinkron sheet, cadangan, impor | printer perangkat & ganti PIN |

Semua aturan ini dijaga di server, bukan hanya disembunyikan di tampilan.

---

## 2. Coba di komputer sendiri

```bash
node --version        # harus v22.13 atau lebih baru
cd rich-gallery
npm start             # buka http://localhost:3000
npm test              # 15 tes otomatis, dijalankan dua kali: jalur server & jalur aplikasi Android
```

Saat pertama dibuka, muncul layar **Buat akun admin**. Database otomatis terisi 480 produk dan 192 bahan dari sheet, beserta karyawan ALIT, IZA, MANU, YUDI, EVA, dan SAVIRA (belum punya PIN).

---

## 3. Pasang di VPS (Ubuntu 22.04 / 24.04)

Spesifikasi termurah sudah cukup: 1 vCPU, 1 GB RAM. Siapkan juga domain/subdomain, misalnya `kasir.richgallery.id`, yang diarahkan (A record) ke IP VPS.

### 3.1 Pasang Node.js, nginx, certbot
```bash
sudo apt update && sudo apt install -y curl nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # pastikan v22.13+
```

### 3.2 Salin aplikasi
```bash
sudo useradd --system --create-home --home-dir /opt/rich-gallery richgallery
# unggah isi folder rich-gallery ke /opt/rich-gallery (lewat scp/sftp/git), lalu:
sudo mkdir -p /opt/rich-gallery/data
sudo cp /opt/rich-gallery/.env.example /opt/rich-gallery/.env
sudo chown -R richgallery:richgallery /opt/rich-gallery
```
Buka `/opt/rich-gallery/.env` dan sesuaikan bila perlu. Isi bawaannya sudah cocok untuk VPS di belakang nginx dengan HTTPS.

### 3.3 Jalankan sebagai layanan + cadangan harian
```bash
sudo cp /opt/rich-gallery/deploy/rich-gallery.service /etc/systemd/system/
sudo cp /opt/rich-gallery/deploy/rich-gallery-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rich-gallery rich-gallery-backup.timer
sudo systemctl status rich-gallery      # harus "active (running)"
```

### 3.4 nginx + HTTPS
```bash
sudo cp /opt/rich-gallery/deploy/nginx.conf /etc/nginx/sites-available/rich-gallery
sudo nano /etc/nginx/sites-available/rich-gallery        # ganti kasir.contoh.com dengan domain Anda
sudo ln -s /etc/nginx/sites-available/rich-gallery /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d kasir.richgallery.id             # HTTPS gratis, diperpanjang otomatis
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

> **Penting:** `.env` memakai `COOKIE_SECURE=true`, jadi login hanya berfungsi lewat **https**. Selesaikan langkah certbot dulu sebelum masuk dari HP.

---

## 4. Langkah pertama setelah online

1. Buka `https://domain-anda` lalu buat **akun admin**. Akun ini hanya bisa dibuat sekali.
2. **Pengaturan → Pengguna:** beri PIN untuk setiap karyawan yang perlu login. Karyawan tanpa PIN tetap bisa dipilih sebagai pembuat di menu Produksi.
3. **Pengaturan → Sinkron ke Google Sheet:** tempel URL Apps Script. Bila skrip belum terpasang di sheet, pasang `deploy/sinkron-sheet-apps-script.gs` dulu (petunjuk ada di bagian atas file itu). Server akan mengirim data tiap 60 detik, termasuk saat semua HP kasir sedang tertutup.
4. **Pindahkan data dari aplikasi versi file** (bila sudah dipakai): di aplikasi lama buka Pengaturan → Unduh cadangan (.json). Di website baru buka Pengaturan → Cadangan & impor → Pilih file. Impor aman diulang karena data yang sama tidak akan tergandakan.

### Di perangkat iMin / HP kasir
- Buka alamat website di **Chrome** → menu ⋮ → **Tambahkan ke layar utama**.
- Masuk dengan nama dan PIN masing-masing. Sesi bertahan 30 hari.
- **Pengaturan → Perangkat ini:** pilih kertas 58/80 mm dan cara cetak (Chrome atau RawBT), lalu tekan **Cetak struk uji**. Pengaturan ini tersimpan per perangkat.
- Alat scan barcode USB/Bluetooth (mode keyboard, akhiran Enter) langsung berfungsi di menu Kasir, Produksi, Masuk/Keluar, Opname, dan Stok.

---

## 5. Cadangan & pemulihan

- **Otomatis:** setiap malam pukul 23:30 waktu server, salinan database dibuat di `/opt/rich-gallery/data/backup/` dan disimpan 30 hari. Untuk membuat cadangan saat itu juga: `sudo -u richgallery npm --prefix /opt/rich-gallery run backup`.
- **Manual dari website:** Pengaturan → Unduh cadangan database (.db). Simpan juga di luar VPS, misalnya di Google Drive, minimal seminggu sekali.
- **Memulihkan dari website:** Pengaturan → Cadangan & impor → *Pilih file cadangan (.db) untuk dipulihkan*. Seluruh data diganti dengan isi file, lalu semua pengguna masuk lagi. File boleh berasal dari server maupun dari aplikasi Android. Data server sebelum dipulihkan disimpan otomatis di `data/backup/sebelum-pulihkan-….db`.
- **Memulihkan lewat terminal:**
  ```bash
  sudo systemctl stop rich-gallery
  sudo -u richgallery cp /path/cadangan.db /opt/rich-gallery/data/rich-gallery.db
  sudo rm -f /opt/rich-gallery/data/rich-gallery.db-wal /opt/rich-gallery/data/rich-gallery.db-shm
  sudo systemctl start rich-gallery
  ```

## 6. Memperbarui versi aplikasi
```bash
# unggah file baru ke /opt/rich-gallery (JANGAN timpa folder data/ dan file .env)
sudo chown -R richgallery:richgallery /opt/rich-gallery
sudo systemctl restart rich-gallery
```
Perubahan struktur database dijalankan otomatis saat server mulai (lihat `MIGRASI` di `src/core/skema.js`).

## 7. Lupa password admin
```bash
cd /opt/rich-gallery && sudo -u richgallery npm run reset-admin -- "Yudi" "password-baru-min-8"
```

## 8. Melihat log / mengatasi masalah
```bash
sudo journalctl -u rich-gallery -f          # log server langsung
curl http://127.0.0.1:3000/api/health       # harus {"ok":true}
```
- **Login berhasil tapi langsung keluar lagi:** website dibuka lewat http, padahal `COOKIE_SECURE=true`. Pakai https.
- **Titik di samping nama berwarna oranye:** ada baris yang belum terkirim ke Google Sheet. Buka Pengaturan untuk melihat pesan galatnya.

---

## 9. Untuk pengembang

```
server.js                  titik masuk server (memanggil src/node/main.js)
src/core/                  ATURAN BISNIS BERSAMA — dipakai server dan aplikasi Android, tanpa kode khusus Node
  skema.js                   MIGRASI skema database + pengaturan bawaan
  db.js                      pembantu query & transaksi di atas "driver" yang dipasang platform
  platform.js                daftar kemampuan yang berbeda per platform (hash, HTTP, cadangan, …)
  router.js                  daftar endpoint + jalankan(): memproses satu permintaan API
  auth.js                    sesi, PIN/password (PBKDF2), pembatas percobaan login
  stok.js                    ubahStok(): satu-satunya jalan mengubah stok + buku stok
  sync.js                    kirim antrean ke Apps Script, tarik data dari sheet
  routes/*.js                endpoint API per bagian
src/node/                  khusus server: konfigurasi .env, node:sqlite, HTTP + cookie, header keamanan
public/                    tampilan (HTML/CSS/JS tanpa build step), dipakai website dan aplikasi
public/shared.js           kategori, barcode EAN-13, periode insentif (dipakai server & browser)
public/lokal/              mesin lokal Android: driver SQLite lewat jembatan native, platform, mesin.js
android/                   proyek Android (Java, tanpa library tambahan) — lihat android/README.md
.github/workflows/         membangun APK otomatis di GitHub
deploy/                    systemd, nginx, skrip Apps Script
scripts/                   backup.js, reset-admin.js
test/api.test.js           tes ujung-ke-ujung (npm test)
```

Prinsip yang dijaga:
- **Uang dan stok hanya dihitung di server.** Total transaksi dihitung ulang dan nomor invoice diambil di dalam satu transaksi database, jadi dua kasir yang menyimpan bersamaan tidak bisa mendapat nomor yang sama.
- **Semua perubahan stok lewat `ubahStok()`**, sehingga setiap angka stok punya jejak di tabel `stock_moves`: siapa, kapan, dan karena apa.
- **Data barang dan pengeluaran tidak dihapus permanen** (kolom `dihapus`), supaya riwayat lama tetap utuh.
- **Menambah kolom/tabel:** tambahkan langkah baru di akhir array `MIGRASI` di `src/core/skema.js`. Jangan mengubah langkah yang sudah ada. Tulis SQL yang didukung SQLite Android 7 (misalnya `INSERT OR REPLACE`, bukan `ON CONFLICT … DO UPDATE`).
- **Satu aturan, dua platform.** Logika baru ditulis di `src/core/`. `npm test` menjalankan semua tes dua kali: lewat driver server dan lewat driver Android (teks SQL + JSON, satu pernyataan per panggilan), supaya keduanya tidak pernah berbeda.

Endpoint utama (semua di bawah `/api`, perubahan data wajib header `X-RG: 1`):
`status, setup, login, logout, bootstrap, akun/password, users, produk, bahan, penjualan, penjualan/:id/batal, mutasi, opname, riwayat-stok, produksi, insentif, insentif/bayar, pengeluaran, laporan, pengaturan, sync, sync/kirim, sync/tarik, cadangan, pulihkan, impor-lama`.

## 10. Batasan saat ini
- **Website butuh internet saat menyimpan transaksi.** Bila koneksi toko sering putus, pakai aplikasi Android mode offline.
- **Aplikasi offline dan server tidak saling sinkron otomatis.** Data dipindah utuh lewat file cadangan (sekali pindah), bukan digabung terus-menerus. Jadi jangan memakai mode offline di satu HP dan website di HP lain secara bersamaan untuk toko yang sama.
- Riwayat penjualan dan produksi lama yang hanya ada di Google Sheet (Januari–Oktober 2026) tidak ikut masuk ke database. Laporan di website dihitung mulai data pertama yang masuk ke website, ditambah data yang diimpor dari aplikasi versi file.
