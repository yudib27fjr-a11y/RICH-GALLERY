# Aplikasi Android Rich Gallery (offline, siap online)

Aplikasi kasir yang berjalan **penuh tanpa internet** di HP atau perangkat iMin: kasir dan struk, barcode, stok, masuk/keluar, opname, produksi dan insentif, pengeluaran, laporan, serta login admin/karyawan. Semua data tersimpan di database SQLite di dalam perangkat.

Saat internet tersedia, data otomatis dikirim ke Google Sheet **PEMBUKUAN RG 2026** (tab `APP …`). Bila suatu saat ingin online, data bisa dipindahkan utuh ke server dan aplikasi cukup diarahkan ke alamat server. Tidak perlu membuat ulang apa pun.

- Android 7.0 ke atas (termasuk perangkat iMin lama).
- Tanpa library tambahan: Java + WebView + SQLite bawaan Android.
- Aturan bisnisnya **sama persis** dengan server (`src/core/`), karena kodenya memang sama.

---

## 1. Mendapatkan file APK

APK dibangun otomatis oleh GitHub Actions setiap kali ada perubahan di repository **yudib27fjr-a11y/RICH-GALLERY** (branch `main`).

- **Unduh APK terbaru:** https://github.com/yudib27fjr-a11y/RICH-GALLERY/releases/latest → file **RichGallery.apk**.
- Semua APK ditandatangani dengan kunci yang sama, sehingga versi baru selalu bisa dipasang menimpa versi lama **tanpa menghapus data**. Pembaruan otomatis juga hanya mau memasang paket yang ditandatangani kunci itu.

### Kunci tanda tangan — simpan baik-baik
- Kunci (`rich-gallery.keystore`) **tidak** disimpan di GitHub. Di GitHub Actions, kunci diambil dari *Secret* bernama `RG_KEYSTORE_B64` (Settings → Secrets and variables → Actions).
- Simpan salinan file `rich-gallery.keystore` (dan `RG_KEYSTORE_B64.txt`) di tempat aman, misalnya Google Drive pribadi. **Kalau kunci ini hilang, aplikasi tidak bisa diperbarui lagi**, dan semua perangkat harus menghapus lalu memasang ulang aplikasi.
- Jangan pernah mengunggah file kunci ke repository. `.gitignore` sudah mencegahnya.

### Membangun di komputer (Android Studio)
1. Taruh `rich-gallery.keystore` di folder `android/app/`.
2. Jalankan `node android/siapkan-aset.mjs`, lalu buka folder `android` di Android Studio.
3. Pilih **Build → Build APK(s)**.

> Aset tampilan (`app/src/main/assets/www`) sudah disertakan. Bila file di `public/` atau `src/core/` diubah, jalankan `node android/siapkan-aset.mjs` sebelum membangun ulang. GitHub Actions melakukannya otomatis.

---

## 2. Memasang di perangkat iMin / HP

1. Kirim file `.apk` ke perangkat (kabel USB, Google Drive, atau WhatsApp ke diri sendiri).
2. Ketuk file tersebut. Bila muncul peringatan, izinkan **Instal aplikasi tidak dikenal** untuk aplikasi pembuka file (File Manager/Drive/WhatsApp).
3. Buka **Rich Gallery** dari layar utama.

## 3. Pertama kali dibuka

1. Muncul layar **Buat akun admin**. Isi nama dan password (minimal 8 karakter). Database langsung terisi 480 produk dan 192 bahan dari sheet, serta karyawan ALIT, IZA, MANU, YUDI, EVA, dan SAVIRA.
2. **Pengaturan → Pengguna:** beri PIN 4 angka untuk karyawan yang perlu login.
3. **Pengaturan → Perangkat ini:** pilih kertas 58/80 mm, lalu tekan **Cetak struk uji**.
   - *Cetak bawaan Android:* aplikasi membuka layanan cetak Android. Pilih printer bawaan iMin di sana.
   - *RawBT:* bila printer bawaan tidak muncul, pasang aplikasi **RawBT** dari Play Store, pilih printer di RawBT, lalu ubah *Cara mencetak* ke RawBT.
4. **Pengaturan → Sinkron ke Google Sheet:** tempel URL Apps Script (cara memasang skripnya ada di `deploy/sinkron-sheet-apps-script.gs`). Data terkirim tiap menit selama aplikasi terbuka dan ada internet. Saat offline, data mengantre dan dikirim nanti.

Alat scan barcode USB/Bluetooth (mode keyboard, akhiran Enter) dan tombol **Kembali** Android langsung berfungsi.

---

## 4. Data & cadangan — penting

- Data hanya ada di perangkat ini. **Menghapus (uninstall) aplikasi akan menghapus datanya.** Memperbarui APK dengan versi baru tidak menghapus data.
- **Cadangan otomatis harian** disimpan di folder `Download/RichGallery/` dengan nama `rich-gallery-senin.db` … `rich-gallery-minggu.db` (7 hari terakhir, saling menimpa). Folder ini tetap ada walau aplikasi dihapus.
- **Cadangan manual:** Pengaturan → *Simpan cadangan database sekarang*. Salin file ini ke Google Drive atau komputer secara rutin, minimal seminggu sekali.
- **Memulihkan:** Pengaturan → *Pilih file cadangan (.db) untuk dipulihkan* → ketik `GANTI SEMUA DATA`. Data sebelum dipulihkan disimpan dulu sebagai `sebelum-pulihkan-….db`.
- Pindah ke HP baru: pasang APK di HP baru, buat admin sementara, lalu pulihkan file cadangan dari HP lama. Akun dan PIN akan mengikuti isi file cadangan.

## 5. Pembaruan otomatis

Setiap perubahan yang diunggah ke branch `main` diterbitkan sebagai rilis baru: APK, paket tampilan (`www.zip`), dan `versi.json` yang **ditandatangani** dengan kunci aplikasi.

Aplikasi memeriksa rilis terbaru saat dibuka, lalu paling sering 30 menit sekali saat kembali dibuka:

| Jenis perubahan | Yang terjadi di HP |
|---|---|
| **Fitur, tampilan, aturan bisnis** (`public/`, `src/core/`): hampir semua perubahan | Paket baru diunduh di latar belakang, lalu muncul spanduk **"Pembaruan siap — Muat ulang"**. Ketuk, selesai. |
| **Bagian native** (`android/`: ikon, cetak, izin) dengan `versionCode` dinaikkan | Muncul spanduk **"Aplikasi versi X tersedia — Pasang"**. Aplikasi mengunduh APK lalu membuka layar pasang Android, yang tetap butuh satu ketukan konfirmasi. |

Pengamannya:
- Paket yang tanda tangannya tidak cocok dengan kunci aplikasi **ditolak**.
- Paket tampilan yang membutuhkan versi APK lebih baru (`RgNative.API`) tidak dipasang sampai APK diperbarui.
- Bila paket tampilan baru gagal dibuka, aplikasi otomatis **kembali ke versi sebelumnya** saat dibuka lagi.
- Data tidak pernah ikut diganti. Perubahan struktur database dijalankan otomatis.

Pemeriksaan manual: **Pengaturan → Mode aplikasi → Periksa pembaruan sekarang**.

Website di VPS: setelah file server diperbarui dan layanan dimulai ulang, semua perangkat langsung memakai versi baru saat halaman dimuat ulang.

## 6. Pindah ke online (server VPS)

1. Pasang server mengikuti `README.md` utama (bagian 3), lalu buat admin di website.
2. Di aplikasi: **Pengaturan → Simpan cadangan database sekarang**.
3. Di browser, buka website server dan masuk sebagai admin → **Pengaturan → Pilih file cadangan (.db) untuk dipulihkan** → pilih file dari `Download/RichGallery`. Semua data HP pindah ke server: transaksi, stok, produksi, akun, dan PIN. Nomor invoice berikutnya melanjutkan nomor dari HP.
4. Di aplikasi: **Pengaturan → Mode aplikasi** → isi alamat server (`https://…`) → **Pakai server online**. Aplikasi sekarang membuka website server, sementara cetak, simpan file, dan tombol kembali tetap berfungsi.
5. Masuk dengan akun dan PIN yang sama seperti di HP.

Data offline di HP **tidak dihapus**. Tombol **Kembali ke mode offline** ada di Pengaturan, dan bila server tidak bisa dihubungi, aplikasi menawarkan pindah ke mode offline. Hanya saja, data offline dan server tidak tersinkron otomatis, jadi setelah pindah ke online, pakai satu mode saja.

---

## 7. Bila ada masalah

| Gejala | Yang dicoba |
|---|---|
| Dialog cetak tidak menampilkan printer iMin | Pasang RawBT, lalu ubah *Cara mencetak* ke RawBT di Pengaturan → Perangkat ini |
| Struk terpotong / terlalu kecil | Samakan *Lebar kertas* (58/80 mm) dengan kertas printer |
| Barcode tidak terbaca | Pastikan scanner di mode keyboard (HID) dengan akhiran Enter |
| Titik oranye di samping nama | Ada data yang belum terkirim ke Google Sheet; lihat pesan galat di Pengaturan → Sinkron |
| Lupa password admin (offline) | Pulihkan cadangan yang password-nya masih diingat. Tidak ada reset jarak jauh karena data hanya ada di HP |

## 8. Untuk pengembang

```
android/
  app/src/main/java/id/richgallery/kasir/
    MainActivity.java   WebView; aset dilayani dari https://rg.lokal/; mode offline/online; cetak; unduh; pilih file; tombol kembali
    RgDb.java           window.RGDB — SQLite Android: exec/query/run/begin/commit/rollback, cadangan, pulihkan
    RgNative.java       window.RGNative — PBKDF2 (format sama dengan server), sha256, HTTP tanpa CORS, cetak, simpan file, mode
    Berkas.java         simpan ke Download/RichGallery (MediaStore), cadangan harian berputar 7 hari
    Pembaru.java        pembaruan otomatis dari GitHub Releases: cek tanda tangan versi.json, paket web, APK, jaring pengaman
    PaketUpdate.java    unduh, verifikasi RSA-SHA256, SHA-256, ekstrak zip aman (Java murni, bisa diuji tanpa Android)
    BerkasProvider.java menyerahkan APK pembaruan ke penginstal Android
  aset-tambahan/        halaman "server tidak terhubung"
  siapkan-aset.mjs      salin public/ + src/core/ → app/src/main/assets/www
public/lokal/
  driver.js             menyisipkan parameter SQL sebagai literal ber-escape, memecah skema per pernyataan
  platform.js           hash/HTTP/cadangan lewat jembatan native
  mesin.js              memasang driver & platform, migrasi, data awal, lalu window.RG_LOKAL.request()
```

- `npm test` menjalankan seluruh tes server **lewat driver Android** dengan jembatan tiruan yang meniru perilaku `SQLiteDatabase` (satu pernyataan per panggilan, hasil JSON).
- Hash PIN memakai PBKDF2-HMAC-SHA256 (diuji dengan vektor RFC 7914). Hash dari HP bisa diperiksa server dan sebaliknya.
- Database memakai jurnal biasa (bukan WAL), dan cadangan menunggu transaksi selesai, sehingga file cadangan selalu utuh.
- Jembatan database hanya aktif untuk halaman `https://rg.lokal/` di mode offline. Halaman server online tidak bisa menyentuh database HP.
