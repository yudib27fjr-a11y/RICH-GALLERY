#!/bin/bash
# Pasang / perbarui Rich Gallery POS di Mac sebagai server GRATIS (tanpa VPS, tanpa kartu kredit).
#
# Buka aplikasi Terminal, lalu tempel (JANGAN pakai sudo di depannya):
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/yudib27fjr-a11y/RICH-GALLERY/main/deploy/pasang-mac.sh)"
#
# Yang dilakukan:
#   1. Memasang Node.js (bila belum ada).
#   2. Mengunduh aplikasi ke /Users/Shared/RichGallery/app (data di /Users/Shared/RichGallery/data, tidak pernah ditimpa).
#   3. Menjalankan aplikasi otomatis setiap Mac menyala (launchd), plus cadangan harian 23:30.
#   4. Membuat alamat internet HTTPS gratis lewat Tailscale Funnel: https://nama-mac.xxxx.ts.net
# Menjalankan perintah yang sama lagi = memperbarui aplikasi ke versi terbaru.
#
# Catatan: ditulis untuk bash 3.2 bawaan macOS.
set -eu

ROOT="/Users/Shared/RichGallery"
APP="$ROOT/app"
DATA="$ROOT/data"
PORT=3000
LABEL="id.richgallery.server"
LABEL_CADANGAN="id.richgallery.cadangan"
ZIP_URL="https://github.com/yudib27fjr-a11y/RICH-GALLERY/archive/refs/heads/main.zip"
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

hijau(){ printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
kuning(){ printf '\033[1;33m%s\033[0m\n' "$*"; }
gagal(){ printf '\n\033[1;31mGAGAL: %s\033[0m\n' "$*" >&2; printf 'Kirim tangkapan layar pesan ini untuk dibantu.\n' >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || gagal "Skrip ini khusus macOS."
[ "$(id -u)" -ne 0 ] || gagal "Jangan jalankan dengan sudo. Tempel perintahnya apa adanya; password Mac akan diminta saat dibutuhkan."
PEMILIK="$(id -un)"

node_cukup(){
  [ -x "$1" ] || return 1
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null
}
cari_node(){
  for n in "$(command -v node 2>/dev/null || true)" /usr/local/bin/node /opt/homebrew/bin/node; do
    if [ -n "$n" ] && node_cukup "$n"; then echo "$n"; return 0; fi
  done
  return 1
}
app_hidup(){ curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; }

echo "Password Mac Anda dibutuhkan untuk memasang layanan (tidak terlihat saat diketik)."
sudo -v || gagal "Password tidak diterima."
# Jaga sudo tetap aktif selama skrip berjalan.
( while true; do sudo -n true 2>/dev/null; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) &
JAGA_SUDO=$!
trap 'kill $JAGA_SUDO 2>/dev/null || true' EXIT

# ------------------------------------------------------------------ 1. Node.js
hijau "1/6 Memeriksa Node.js"
NODE="$(cari_node || true)"
if [ -z "$NODE" ]; then
  echo "Mengunduh Node.js LTS ..."
  VERSI="$(curl -fsSL https://nodejs.org/dist/index.json | tr '{' '\n' | grep '"lts":"' | grep -o '"version":"v[0-9.]*"' | head -1 | cut -d'"' -f4)"
  [ -n "$VERSI" ] || gagal "Tidak bisa mengetahui versi Node.js terbaru. Pasang manual dari https://nodejs.org (LTS), lalu jalankan perintah ini lagi."
  PKG="/tmp/node-$VERSI.pkg"
  curl -fL --progress-bar -o "$PKG" "https://nodejs.org/dist/$VERSI/node-$VERSI.pkg"
  echo "Memasang Node.js $VERSI ..."
  sudo installer -pkg "$PKG" -target / >/dev/null
  rm -f "$PKG"
  NODE="$(cari_node || true)"
  [ -n "$NODE" ] || gagal "Node.js gagal terpasang. Pasang manual dari https://nodejs.org (LTS), lalu jalankan perintah ini lagi."
fi
echo "Node.js $("$NODE" -v) di $NODE"

# ------------------------------------------------------------------ 2. Aplikasi
hijau "2/6 Mengunduh aplikasi terbaru"
mkdir -p "$ROOT" "$DATA/backup"
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/app.zip" "$ZIP_URL"
unzip -q "$TMP/app.zip" -d "$TMP/isi"
BARU="$(find "$TMP/isi" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$BARU" ] && [ -f "$BARU/server.js" ] || gagal "File aplikasi yang diunduh tidak lengkap. Coba lagi."
# Hentikan versi lama dulu.
sudo launchctl bootout system/"$LABEL" 2>/dev/null || true
rm -rf "$APP"
mv "$BARU" "$APP"
rm -rf "$TMP"

# Pengaturan disimpan di luar folder app supaya tidak hilang saat diperbarui.
ENV_UTAMA="$ROOT/pengaturan.env"
if [ ! -f "$ENV_UTAMA" ]; then
  cat > "$ENV_UTAMA" <<EOF
PORT=$PORT
HOST=127.0.0.1
DB_PATH=$DATA/rich-gallery.db
BACKUP_DIR=$DATA/backup
COOKIE_SECURE=true
TRUST_PROXY=true
TZ_TOKO=Asia/Jakarta
SESSION_DAYS=30
SYNC_INTERVAL_SEC=60
BACKUP_KEEP_DAYS=30
EOF
fi
cp "$ENV_UTAMA" "$APP/.env"

# ------------------------------------------------------------------ 3. Layanan latar belakang (launchd)
hijau "3/6 Menjalankan aplikasi di latar belakang (otomatis setiap Mac menyala)"
tulis_plist(){ # $1=label $2=berkas $3=argumen-program (sudah XML) $4=tambahan XML
  sudo tee "$2" >/dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>UserName</key><string>$PEMILIK</string>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>ProgramArguments</key>
  <array>$3</array>
$4
</dict>
</plist>
EOF
  sudo chown root:wheel "$2"; sudo chmod 644 "$2"
}
PLIST="/Library/LaunchDaemons/$LABEL.plist"
PLIST_CADANGAN="/Library/LaunchDaemons/$LABEL_CADANGAN.plist"
tulis_plist "$LABEL" "$PLIST" \
  "<string>$NODE</string><string>--disable-warning=ExperimentalWarning</string><string>server.js</string>" \
  "  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$DATA/server.log</string>
  <key>StandardErrorPath</key><string>$DATA/server.log</string>"
tulis_plist "$LABEL_CADANGAN" "$PLIST_CADANGAN" \
  "<string>$NODE</string><string>--disable-warning=ExperimentalWarning</string><string>scripts/backup.js</string>" \
  "  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>23</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$DATA/backup.log</string>
  <key>StandardErrorPath</key><string>$DATA/backup.log</string>"
sudo launchctl bootout system/"$LABEL_CADANGAN" 2>/dev/null || true
sleep 1
sudo launchctl bootstrap system "$PLIST"
sudo launchctl bootstrap system "$PLIST_CADANGAN"
for i in $(seq 1 40); do app_hidup && break; sleep 1; done
if ! app_hidup; then
  [ -f "$DATA/server.log" ] && tail -25 "$DATA/server.log"
  gagal "Aplikasi tidak mau berjalan (lihat catatan di atas)."
fi
echo "Aplikasi berjalan di Mac ini: http://127.0.0.1:$PORT"

# ------------------------------------------------------------------ 4. Jangan tidur
hijau "4/6 Mengatur agar Mac tidak tidur saat tersambung listrik"
if sudo pmset -c sleep 0 disksleep 0 2>/dev/null; then echo "Sleep saat dicas: tidak pernah."; else kuning "Atur manual: System Settings -> Battery/Energy -> jangan tidur saat tersambung listrik."; fi
sudo pmset -a autorestart 1 2>/dev/null || true   # nyala lagi setelah listrik padam (Mac desktop)

# ------------------------------------------------------------------ 5. Tailscale
hijau "5/6 Menyiapkan alamat internet gratis (Tailscale Funnel)"
if [ ! -x "$TS" ]; then
  kuning "Tailscale belum terpasang. Halaman unduhan dibuka sekarang:"
  kuning "  1) Pasang Tailscale (App Store atau unduhan langsung).  2) Buka Tailscale, Log in dengan akun Google."
  kuning "  3) Jalankan perintah pemasangan ini lagi."
  open "https://tailscale.com/download/mac" 2>/dev/null || true
  kuning "Aplikasi sudah berjalan di Mac ini; tinggal alamat internetnya yang belum."
  exit 0
fi
status_ts(){ "$TS" status --json 2>/dev/null || true; }
if ! status_ts | grep -q '"BackendState": *"Running"'; then
  open -a Tailscale 2>/dev/null || true
  kuning "Masuk ke Tailscale: klik ikon Tailscale di bar atas -> Log in, lalu masuk dengan akun Google."
  kuning "Menunggu Anda masuk (maksimal 5 menit) ..."
  for i in $(seq 1 100); do status_ts | grep -q '"BackendState": *"Running"' && break; sleep 3; done
  status_ts | grep -q '"BackendState": *"Running"' || gagal "Belum masuk ke Tailscale. Log in lewat ikon Tailscale di bar atas, lalu jalankan perintah ini lagi."
fi
kuning 'Bila muncul tautan "Funnel is not enabled" / "To enable", buka tautan itu, klik Enable, lalu kembali ke sini.'
"$TS" funnel --bg "$PORT" </dev/null || true
DNS="$(status_ts | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(String(JSON.parse(s).Self.DNSName||"").replace(/\.$/,""))}catch{console.log("")}})')"
[ -n "$DNS" ] || gagal "Tidak bisa membaca alamat Tailscale. Jalankan perintah ini lagi."
ALAMAT="https://$DNS"
echo "$ALAMAT" > "$ROOT/ALAMAT-SERVER.txt"

# ------------------------------------------------------------------ 6. Selesai
hijau "6/6 Memeriksa alamat internet"
OK=""
for i in $(seq 1 30); do
  if curl -fsS --max-time 8 "$ALAMAT/api/status" >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done
echo
if [ -n "$OK" ]; then printf '\033[1;32m%s\033[0m\n' "SELESAI! Rich Gallery POS sudah online:"
else kuning "Hampir selesai. Alamat di bawah mungkin butuh 1-5 menit sampai bisa dibuka (sertifikat HTTPS sedang dibuat):"; fi
printf '\n    \033[1;36m%s\033[0m\n\n' "$ALAMAT"
echo "Alamat ini juga disimpan di $ROOT/ALAMAT-SERVER.txt"
echo "Langkah berikutnya: buka alamat itu, buat akun admin, lalu pulihkan cadangan dari HP (Pengaturan -> Pulihkan)."
echo "Mac ini harus tetap menyala, login, dan tersambung internet selama toko buka."
