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

## 3. Pasang di VPS (Ubuntu 22.04 / 24.04, Debian 12)

Spesifikasi termurah sudah cukup: 1 vCPU, 1 GB RAM.

### 3.1 Satu perintah
Masuk ke VPS lewat SSH (`ssh root@IP-VPS`), lalu jalankan:
```bash
curl -fsSL https://raw.githubusercontent.com/yudib27fjr-a11y/RICH-GALLERY/main/deploy/pasang.sh | sudo bash
```
Skrip `deploy/pasang.sh` memasang Node.js 22, mengunduh aplikasi ke `/opt/rich-gallery`, menjalankannya sebagai layanan (hidup lagi otomatis bila server restart), memasang cadangan harian, dan memasang **HTTPS gratis** (Caddy + Let's Encrypt, diperpanjang otomatis). Di akhir, alamat website ditampilkan.

- **Tanpa domain:** alamatnya memakai IP server, misalnya `https://103-11-22-33.sslip.io`.
- **Dengan domain sendiri:** arahkan A record domain/subdomain ke IP VPS, tunggu beberapa menit, lalu:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/yudib27fjr-a11y/RICH-GALLERY/main/deploy/pasang.sh | sudo bash -s -- kasir.domainanda.com
  ```
- Port **80 dan 443** harus terbuka. Bila penyedia VPS punya firewall di panelnya, buka kedua port itu.

### 3.2 Memperbarui ke versi terbaru
Jalankan **perintah yang sama** lagi. Kode diperbarui dari GitHub dan layanan dimulai ulang; folder `data/` dan `.env` tidak disentuh. Domain yang terakhir dipakai diingat.

### 3.3 Letak file
- Aplikasi: `/opt/rich-gallery` (milik root; layanan hanya bisa menulis ke `data/`)
- Database: `/opt/rich-gallery/data/rich-gallery.db`, cadangan harian: `/opt/rich-gallery/data/backup/`
- Pengaturan: `/opt/rich-gallery/.env`, HTTPS: `/etc/caddy/Caddyfile`

### 3.4 Gratis: komputer Windows di toko sebagai server
Tanpa VPS dan tanpa kartu kredit. Komputer harus menyala dan tersambung internet selama toko buka.

Buka **PowerShell sebagai Administrator** (klik kanan Start → *Terminal (Admin)*), lalu:
```powershell
irm https://raw.githubusercontent.com/yudib27fjr-a11y/RICH-GALLERY/main/deploy/pasang-windows.ps1 | iex
```
Skrip `deploy/pasang-windows.ps1` memasang Node.js, menaruh aplikasi di `C:\RichGallery\app` (data di `C:\RichGallery\data`), menjalankannya otomatis setiap komputer menyala (Task Scheduler, tanpa perlu login Windows), membuat cadangan harian 23:30, mencegah komputer tidur saat dicas, lalu membuat alamat HTTPS gratis lewat **Tailscale Funnel** (`https://nama-komputer.xxxx.ts.net`, disimpan di `C:\RichGallery\ALAMAT-SERVER.txt`). Saat pertama kali, Anda diminta masuk ke Tailscale (akun Google) dan menekan *Enable* untuk Funnel.

Perbarui aplikasi: jalankan perintah yang sama lagi.

### 3.5 Gratis: Mac di toko sebagai server
Sama seperti 3.4, tetapi untuk Mac. Mac harus menyala, login, dan tersambung internet selama toko buka.

Buka aplikasi **Terminal**, lalu tempel (tanpa `sudo`):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/yudib27fjr-a11y/RICH-GALLERY/main/deploy/pasang-mac.sh)"
```
Skrip `deploy/pasang-mac.sh` memasang Node.js, menaruh aplikasi di `/Users/Shared/RichGallery/app` (data di `/Users/Shared/RichGallery/data`), menjalankannya otomatis lewat launchd, membuat cadangan harian 23:30, mencegah Mac tidur saat dicas, lalu membuat alamat HTTPS gratis lewat **Tailscale Funnel** (disimpan di `/Users/Shared/RichGallery/ALAMAT-SERVER.txt`). Tailscale dipasang dari App Store atau tailscale.com/download/mac, lalu login dengan akun Google.

Perbarui aplikasi: jalankan perintah yang sama lagi.

### 3.6 Gratis & selalu menyala: Cloudflare (disarankan)
Tanpa VPS, tanpa kartu kredit, tidak bergantung komputer toko. Berjalan di paket gratis Cloudflare Workers dengan database SQLite di Durable Object (batas gratis: 100.000 permintaan dan 100.000 baris tulis per hari, 5 GB data).

1. Cloudflare → **Workers & Pages**: bila diminta, buat subdomain `workers.dev` (sekali saja).
2. Cloudflare → ikon profil → **My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers** → **Create Token**, salin tokennya.
3. GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**: nama `CLOUDFLARE_API_TOKEN`, isi token tadi.
4. GitHub → **Actions → Pasang ke Cloudflare → Run workflow**. Alamatnya tampil di ringkasan: `https://rich-gallery-pos.<subdomain>.workers.dev`.
5. Pindahkan data iMin: di iMin **Pengaturan → Server pusat** → isi alamat Cloudflare dan admin server → **Sambungkan** → **Kirim semua data ke server**.

Setiap perubahan di `main` otomatis dipasang ulang (lihat `.github/workflows/cloudflare.yml`, `wrangler.toml`, `src/cloudflare/`). Cadangan dari server Cloudflare berupa file `.json` dan bisa dipulihkan lagi di sana.

---

## 4. Langkah pertama setelah online

1. Buka `https://domain-anda` lalu buat **akun admin**. Akun ini hanya bisa dibuat sekali.
2. **Pengaturan → Pengguna:** beri PIN untuk setiap karyawan yang perlu login. Karyawan tanpa PIN tetap bisa dipilih sebagai pembuat di menu Produksi.
3. **Pengaturan → Sinkron ke Google Sheet:** tempel URL Apps Script. Bila skrip belum terpasang di sheet, pasang `deploy/sinkron-sheet-apps-script.gs` dulu (petunjuk ada di bagian atas file itu). Server akan mengirim data tiap 60 detik, termasuk saat semua HP kasir sedang tertutup.
4. **Pindahkan data dari aplikasi versi file** (bila sudah dipakai): di aplikasi lama buka Pengaturan → Unduh cadangan (.json). Di website baru buka Pengaturan → Cadangan & impor → Pilih file. Impor aman diulang karena data yang sama tidak akan tergandakan.

### Di perangkat iMin / HP kasir
- **Disarankan:** pakai aplikasi Android **Rich Gallery POS** → Pengaturan → Mode aplikasi → isi alamat server → **Pakai server online**. Cetak langsung ke printer bawaan iMin tetap berfungsi di mode online.
- Atau lewat browser: buka alamat website di **Chrome** → menu ⋮ → **Tambahkan ke layar utama** (cetak memakai layanan cetak Android atau RawBT).
- Masuk dengan nama dan PIN masing-masing. Sesi bertahan 30 hari.
- **Pengaturan → Perangkat ini:** pilih kertas 58/80 mm dan cara cetak, lalu tekan **Cetak struk uji**. Pengaturan ini tersimpan per perangkat.
- Alat scan barcode USB/Bluetooth (mode keyboard, akhiran Enter) langsung berfungsi di menu Kasir, Produksi, Masuk/Keluar, Opname, dan Stok.

---

## 5. Cadangan & pemulihan

- **Otomatis:** setiap malam pukul 23:30 waktu server, salinan database dibuat di `/opt/rich-gallery/data/backup/` dan disimpan 30 hari. Untuk membuat cadangan saat itu juga: `cd /opt/rich-gallery && sudo -u richgallery node --disable-warning=ExperimentalWarning scripts/backup.js`.
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
Jalankan lagi perintah pemasangan di bagian 3.1. Perubahan struktur database dijalankan otomatis saat server mulai (lihat `MIGRASI` di `src/core/skema.js`).

## 7. Lupa password admin
```bash
cd /opt/rich-gallery && sudo -u richgallery node --disable-warning=ExperimentalWarning scripts/reset-admin.js "Yudi" "password-baru-min-8"
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
deploy/                    pasang.sh (pasang VPS 1 perintah), systemd, Caddy, skrip Apps Script
src/cloudflare/            versi Cloudflare: worker.js, driver SQLite Durable Object, platform
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
