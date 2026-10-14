#!/usr/bin/env bash
# Pasang / perbarui Rich Gallery POS di VPS Ubuntu (22.04 / 24.04) atau Debian 12 dengan SATU perintah:
#
#   curl -fsSL https://raw.githubusercontent.com/yudib27fjr-a11y/RICH-GALLERY/main/deploy/pasang.sh | sudo bash
#
# Tanpa domain, alamatnya otomatis memakai IP server: https://103-11-22-33.sslip.io (gratis, sudah HTTPS).
# Dengan domain sendiri (A record sudah diarahkan ke IP VPS):
#
#   curl -fsSL https://raw.githubusercontent.com/yudib27fjr-a11y/RICH-GALLERY/main/deploy/pasang.sh | sudo bash -s -- kasir.domainanda.com
#
# Menjalankan perintah yang sama lagi = memperbarui aplikasi ke versi terbaru. Data (folder data/) dan .env tidak disentuh.
set -euo pipefail

REPO="https://github.com/yudib27fjr-a11y/RICH-GALLERY.git"
DIR="/opt/rich-gallery"
PENGGUNA="richgallery"
PORT_APP=3000

hijau(){ printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
kuning(){ printf '\033[1;33m%s\033[0m\n' "$*"; }
gagal(){ printf '\n\033[1;31mGAGAL: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || gagal "Jalankan dengan sudo / sebagai root."
command -v apt-get >/dev/null || gagal "Skrip ini untuk Ubuntu/Debian (apt)."
export DEBIAN_FRONTEND=noninteractive

DOMAIN="${1:-}"
FILE_DOMAIN="/etc/rich-gallery-domain"
if [ -z "$DOMAIN" ] && [ -s "$FILE_DOMAIN" ]; then DOMAIN="$(cat "$FILE_DOMAIN")"; fi

hijau "1/7 Memasang paket dasar"
apt-get update -qq
apt-get install -y -qq curl ca-certificates git gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if [ -z "$DOMAIN" ]; then
  IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me || true)"
  [[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || gagal "Tidak bisa mengetahui IP publik server. Jalankan ulang dengan domain: ... | sudo bash -s -- kasir.domainanda.com"
  DOMAIN="${IP//./-}.sslip.io"
fi
DOMAIN="$(echo "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##')"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || gagal "Domain tidak valid: $DOMAIN"
echo "$DOMAIN" > "$FILE_DOMAIN"
echo "Alamat server: https://$DOMAIN"

hijau "2/7 Memasang Node.js 22"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' || gagal "Node.js minimal v22.13 dibutuhkan (terpasang: $(node --version))."
echo "Node.js $(node --version)"

hijau "3/7 Mengunduh aplikasi"
id "$PENGGUNA" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir "$DIR" --shell /usr/sbin/nologin "$PENGGUNA"
if [ -d "$DIR/.git" ]; then
  git -c safe.directory="$DIR" -C "$DIR" fetch -q --depth 1 origin main
  git -c safe.directory="$DIR" -C "$DIR" reset -q --hard origin/main
else
  if [ -d "$DIR" ] && [ "$(ls -A "$DIR" 2>/dev/null | grep -v '^data$' | grep -v '^\.env$' || true)" ]; then
    LAMA="$DIR.lama-$(date +%Y%m%d%H%M%S)"; kuning "Folder $DIR lama dipindah ke $LAMA (data/ dan .env tetap dipakai)."
    mkdir -p "$LAMA"; find "$DIR" -mindepth 1 -maxdepth 1 ! -name data ! -name .env -exec mv {} "$LAMA"/ \;
  fi
  mkdir -p "$DIR"
  TMP="$(mktemp -d)"; git clone -q --depth 1 "$REPO" "$TMP/repo"
  cp -a "$TMP/repo/." "$DIR/"; rm -rf "$TMP"
fi
echo "Versi: $(git -c safe.directory="$DIR" -C "$DIR" log -1 --format='%h %s')"

hijau "4/7 Menyiapkan pengaturan & folder data"
mkdir -p "$DIR/data/backup"
[ -f "$DIR/.env" ] || cp "$DIR/.env.example" "$DIR/.env"
aturEnv(){ if grep -q "^$1=" "$DIR/.env"; then sed -i "s#^$1=.*#$1=$2#" "$DIR/.env"; else echo "$1=$2" >> "$DIR/.env"; fi; }
aturEnv HOST 127.0.0.1
aturEnv PORT "$PORT_APP"
aturEnv COOKIE_SECURE true
aturEnv TRUST_PROXY true
# Kode milik root (layanan tidak bisa mengubahnya); hanya data/ yang bisa ditulis aplikasi.
chown -R root:root "$DIR"
chown -R "$PENGGUNA:$PENGGUNA" "$DIR/data"
chown root:"$PENGGUNA" "$DIR/.env"; chmod 640 "$DIR/.env"

hijau "5/7 Menjalankan layanan + cadangan harian"
cp "$DIR/deploy/rich-gallery.service" "$DIR/deploy/rich-gallery-backup.service" "$DIR/deploy/rich-gallery-backup.timer" /etc/systemd/system/
NODE_BIN="$(command -v node)"
sed -i "s#/usr/bin/node#$NODE_BIN#" /etc/systemd/system/rich-gallery.service /etc/systemd/system/rich-gallery-backup.service
systemctl daemon-reload
systemctl enable -q rich-gallery rich-gallery-backup.timer
systemctl restart rich-gallery
systemctl start rich-gallery-backup.timer
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT_APP/api/status" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT_APP/api/status" >/dev/null 2>&1 || { journalctl -u rich-gallery -n 30 --no-pager; gagal "Aplikasi tidak mau berjalan (lihat log di atas)."; }
echo "Aplikasi berjalan."

hijau "6/7 Memasang HTTPS (Caddy, sertifikat gratis & diperpanjang otomatis)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
# Web server lain yang memakai port 80/443 dihentikan supaya Caddy bisa jalan.
for lain in apache2 nginx httpd lighttpd; do
  if systemctl is-active -q "$lain" 2>/dev/null; then kuning "Menghentikan $lain (memakai port 80/443)."; systemctl disable -q --now "$lain"; fi
done
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<EOF
# Dibuat oleh deploy/pasang.sh — Rich Gallery POS
$DOMAIN {
	encode gzip
	request_body {
		max_size 50MB
	}
	reverse_proxy 127.0.0.1:$PORT_APP
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || gagal "Konfigurasi Caddy tidak valid."
systemctl enable -q caddy
systemctl restart caddy
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; echo "Firewall: port 80 & 443 dibuka."
fi

hijau "7/7 Memeriksa alamat https://$DOMAIN"
OK=""
for i in $(seq 1 45); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/status" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done

echo
if [ -n "$OK" ]; then
  printf '\033[1;32m%s\033[0m\n' "SELESAI! Rich Gallery POS sudah online:"
  printf '\n    \033[1mhttps://%s\033[0m\n\n' "$DOMAIN"
  echo "Langkah berikutnya: buka alamat itu, buat akun admin, lalu pulihkan cadangan dari HP (Pengaturan → Pulihkan)."
else
  kuning "Aplikasi sudah berjalan, tapi https://$DOMAIN belum bisa dibuka dari server ini."
  echo "Kemungkinan penyebab:"
  echo " - Domain belum diarahkan (A record) ke IP server ini, atau perubahan DNS belum menyebar (tunggu 5–30 menit)."
  echo " - Firewall di panel penyedia VPS menutup port 80/443. Buka kedua port itu di panel."
  echo "Setelah diperbaiki, jalankan lagi perintah pemasangan yang sama. Log HTTPS: journalctl -u caddy -n 50 --no-pager"
fi
