# Pasang / perbarui Rich Gallery POS di komputer Windows 10/11 sebagai server GRATIS (tanpa VPS, tanpa kartu kredit).
#
# Buka PowerShell sebagai Administrator (klik kanan Start -> "Terminal (Admin)" / "Windows PowerShell (Admin)"), lalu:
#
#   irm https://raw.githubusercontent.com/yudib27fjr-a11y/RICH-GALLERY/main/deploy/pasang-windows.ps1 | iex
#
# Yang dilakukan:
#   1. Memasang Node.js (bila belum ada).
#   2. Mengunduh aplikasi ke C:\RichGallery\app (data di C:\RichGallery\data, tidak pernah ditimpa).
#   3. Menjalankan aplikasi di latar belakang setiap komputer menyala (Task Scheduler), plus cadangan harian 23:30.
#   4. Membuat alamat internet HTTPS gratis lewat Tailscale Funnel: https://nama-komputer.xxxx.ts.net
# Menjalankan perintah yang sama lagi = memperbarui aplikasi ke versi terbaru.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

  $ROOT  = 'C:\RichGallery'
  $APP   = "$ROOT\app"
  $DATA  = "$ROOT\data"
  $PORT  = 3000
  $TUGAS = 'Rich Gallery POS'
  $TUGAS_CADANGAN = 'Rich Gallery POS - cadangan'
  $ZIP_URL = 'https://github.com/yudib27fjr-a11y/RICH-GALLERY/archive/refs/heads/main.zip'

  function Info($t)   { Write-Host ''; Write-Host "==> $t" -ForegroundColor Green }
  function Kuning($t) { Write-Host $t -ForegroundColor Yellow }
  function Berhenti($t) { throw $t }

  function Cari-Node {
    $c = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $p = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $p) { return $p }
    return $null
  }
  function Node-Cukup($n) {
    if (-not $n) { return $false }
    try { $v = (& $n -p 'process.versions.node').Trim() } catch { return $false }
    $a = [int]($v.Split('.')[0]); $b = [int]($v.Split('.')[1])
    return (($a -gt 22) -or (($a -eq 22) -and ($b -ge 13)))
  }
  function App-Hidup {
    try { $r = Invoke-WebRequest "http://127.0.0.1:$PORT/api/status" -UseBasicParsing -TimeoutSec 3; return ($r.StatusCode -eq 200) } catch { return $false }
  }
  function Hentikan-App {
    try { Stop-ScheduledTask -TaskName $TUGAS -ErrorAction SilentlyContinue } catch { }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -like '*RichGallery*') -and (($_.Name -eq 'node.exe') -or ($_.Name -eq 'cmd.exe')) } |
      ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { } }
    Start-Sleep -Seconds 1
  }

  try {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { Berhenti 'Buka PowerShell sebagai Administrator (klik kanan Start -> Terminal (Admin)), lalu jalankan perintah ini lagi.' }

    # ---------------------------------------------------------------- 1. Node.js
    Info '1/6 Memeriksa Node.js'
    $node = Cari-Node
    if (-not (Node-Cukup $node)) {
      Write-Host 'Mengunduh Node.js LTS ...'
      $idx = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
      $rel = $idx | Where-Object { $_.lts -and ($_.files -contains 'win-x64-msi') -and ([int]($_.version.TrimStart('v').Split('.')[0]) -ge 22) } | Select-Object -First 1
      if (-not $rel) { Berhenti 'Tidak menemukan installer Node.js. Pasang manual dari https://nodejs.org (versi LTS), lalu jalankan perintah ini lagi.' }
      $msi = Join-Path $env:TEMP "node-$($rel.version)-x64.msi"
      Invoke-WebRequest "https://nodejs.org/dist/$($rel.version)/node-$($rel.version)-x64.msi" -OutFile $msi -UseBasicParsing
      Write-Host "Memasang Node.js $($rel.version) ..."
      $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
      if (($p.ExitCode -ne 0) -and ($p.ExitCode -ne 3010)) { Berhenti "Pemasangan Node.js gagal (kode $($p.ExitCode))." }
      $node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
      if (-not (Node-Cukup $node)) { Berhenti 'Node.js terpasang tapi versinya kurang baru. Pasang manual versi LTS dari https://nodejs.org.' }
    }
    Write-Host "Node.js $((& $node -v).Trim()) di $node"

    # ---------------------------------------------------------------- 2. Aplikasi
    Info '2/6 Mengunduh aplikasi terbaru'
    New-Item -ItemType Directory -Force -Path $ROOT, $DATA, "$DATA\backup" | Out-Null
    $zip = Join-Path $env:TEMP 'rich-gallery-main.zip'
    $tmp = Join-Path $ROOT 'unduhan'
    Invoke-WebRequest $ZIP_URL -OutFile $zip -UseBasicParsing
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $isi = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (-not $isi -or -not (Test-Path (Join-Path $isi.FullName 'server.js'))) { Berhenti 'File aplikasi yang diunduh tidak lengkap. Coba lagi.' }
    Hentikan-App
    if (Test-Path $APP) { Remove-Item $APP -Recurse -Force }
    Move-Item $isi.FullName $APP
    Remove-Item $tmp -Recurse -Force; Remove-Item $zip -Force

    # Pengaturan disimpan di luar folder app supaya tidak hilang saat diperbarui.
    $envUtama = Join-Path $ROOT 'pengaturan.env'
    if (-not (Test-Path $envUtama)) {
      @(
        "PORT=$PORT",
        'HOST=127.0.0.1',
        'DB_PATH=C:/RichGallery/data/rich-gallery.db',
        'BACKUP_DIR=C:/RichGallery/data/backup',
        'COOKIE_SECURE=true',
        'TRUST_PROXY=true',
        'TZ_TOKO=Asia/Jakarta',
        'SESSION_DAYS=30',
        'SYNC_INTERVAL_SEC=60',
        'BACKUP_KEEP_DAYS=30'
      ) | Set-Content -Path $envUtama -Encoding ASCII
    }
    Copy-Item $envUtama (Join-Path $APP '.env') -Force

    # ---------------------------------------------------------------- 3. Layanan latar belakang
    Info '3/6 Menjalankan aplikasi di latar belakang (otomatis setiap komputer menyala)'
    $jalankan = Join-Path $ROOT 'jalankan.cmd'
    @(
      '@echo off',
      'rem Dibuat oleh pasang-windows.ps1. Menjalankan Rich Gallery POS dan menyalakannya lagi bila berhenti.',
      "cd /d `"$APP`"",
      ':ulang',
      "`"$node`" --disable-warning=ExperimentalWarning server.js >> `"$DATA\server.log`" 2>&1",
      'ping -n 6 127.0.0.1 >nul',
      'goto ulang'
    ) | Set-Content -Path $jalankan -Encoding ASCII
    $cadangan = Join-Path $ROOT 'cadangan.cmd'
    @(
      '@echo off',
      "cd /d `"$APP`"",
      "`"$node`" --disable-warning=ExperimentalWarning scripts\backup.js >> `"$DATA\backup.log`" 2>&1"
    ) | Set-Content -Path $cadangan -Encoding ASCII

    $pelaku = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $atur = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TUGAS -Force -Principal $pelaku -Settings $atur `
      -Action (New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$jalankan`"") `
      -Trigger (New-ScheduledTaskTrigger -AtStartup) | Out-Null
    Register-ScheduledTask -TaskName $TUGAS_CADANGAN -Force -Principal $pelaku -Settings $atur `
      -Action (New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cadangan`"") `
      -Trigger (New-ScheduledTaskTrigger -Daily -At '23:30') | Out-Null
    Start-ScheduledTask -TaskName $TUGAS
    $hidup = $false
    for ($i = 0; $i -lt 40; $i++) { if (App-Hidup) { $hidup = $true; break }; Start-Sleep -Seconds 1 }
    if (-not $hidup) {
      if (Test-Path "$DATA\server.log") { Get-Content "$DATA\server.log" -Tail 25 }
      Berhenti 'Aplikasi tidak mau berjalan (lihat catatan di atas).'
    }
    Write-Host "Aplikasi berjalan di komputer ini: http://127.0.0.1:$PORT"

    # ---------------------------------------------------------------- 4. Jangan tidur
    Info '4/6 Mengatur agar komputer tidak tidur saat tersambung listrik'
    try { powercfg /change standby-timeout-ac 0 | Out-Null; powercfg /change hibernate-timeout-ac 0 | Out-Null; Write-Host 'Sleep saat dicas: tidak pernah.' } catch { Kuning 'Tidak bisa mengubah pengaturan sleep; atur manual di Settings -> Power.' }

    # ---------------------------------------------------------------- 5. Tailscale
    Info '5/6 Menyiapkan alamat internet gratis (Tailscale Funnel)'
    $ts = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (-not (Test-Path $ts)) {
      if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
        Write-Host 'Memasang Tailscale ...'
        try { winget install --id Tailscale.Tailscale -e --silent --accept-package-agreements --accept-source-agreements | Out-Host } catch { }
      }
    }
    if (-not (Test-Path $ts)) {
      Kuning 'Tailscale belum terpasang. Halaman unduhan akan dibuka:'
      Kuning '  1) Unduh & pasang Tailscale untuk Windows.  2) Masuk (Log in) dengan akun Google.  3) Jalankan perintah pemasangan ini lagi.'
      Start-Process 'https://tailscale.com/download/windows'
      Kuning 'Aplikasi sudah berjalan di komputer ini; tinggal alamat internetnya yang belum.'
      return
    }
    $st = $null
    try { $st = (& $ts status --json) | Out-String | ConvertFrom-Json } catch { }
    if (-not $st -or $st.BackendState -ne 'Running') {
      Kuning 'Masuk ke Tailscale: buka tautan yang muncul di bawah (atau jendela login), lalu masuk dengan akun Google Anda.'
      & $ts up --unattended=true
      try { $st = (& $ts status --json) | Out-String | ConvertFrom-Json } catch { }
      if (-not $st -or $st.BackendState -ne 'Running') { Berhenti 'Belum berhasil masuk ke Tailscale. Buka aplikasi Tailscale (ikon di pojok kanan bawah), Log in, lalu jalankan perintah ini lagi.' }
    }
    # Tetap tersambung walau tidak ada yang login ke Windows (mis. komputer toko baru dinyalakan).
    try { & $ts set --unattended=true | Out-Null } catch { }
    Kuning 'Bila muncul tautan "Funnel is not enabled" / "To enable", buka tautan itu, klik Enable, lalu kembali ke sini.'
    & $ts funnel --bg $PORT
    $dns = ''
    try { $st = (& $ts status --json) | Out-String | ConvertFrom-Json; $dns = ([string]$st.Self.DNSName).TrimEnd('.') } catch { }
    if (-not $dns) { Berhenti 'Tidak bisa membaca alamat Tailscale. Jalankan perintah ini lagi.' }
    $alamat = "https://$dns"
    Set-Content -Path (Join-Path $ROOT 'ALAMAT-SERVER.txt') -Value $alamat -Encoding ASCII

    # ---------------------------------------------------------------- 6. Selesai
    Info '6/6 Memeriksa alamat internet'
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
      try { $r = Invoke-WebRequest "$alamat/api/status" -UseBasicParsing -TimeoutSec 8; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { }
      Start-Sleep -Seconds 3
    }
    Write-Host ''
    if ($ok) { Write-Host 'SELESAI! Rich Gallery POS sudah online:' -ForegroundColor Green }
    else { Kuning 'Hampir selesai. Alamat di bawah mungkin butuh 1-5 menit sampai bisa dibuka (sertifikat HTTPS sedang dibuat):' }
    Write-Host ''
    Write-Host "    $alamat" -ForegroundColor Cyan
    Write-Host ''
    Write-Host "Alamat ini juga disimpan di $ROOT\ALAMAT-SERVER.txt"
    Write-Host 'Langkah berikutnya: buka alamat itu, buat akun admin, lalu pulihkan cadangan dari HP (Pengaturan -> Pulihkan).'
    Write-Host 'Komputer ini harus tetap menyala & tersambung internet selama toko buka.'
  }
  catch {
    Write-Host ''
    Write-Host "GAGAL: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Kirim tangkapan layar pesan ini untuk dibantu.'
  }
}
