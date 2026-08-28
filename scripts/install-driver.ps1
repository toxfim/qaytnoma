<#
.SYNOPSIS
  Epson skaner drayverini rasmiy Epson saytidan yuklab olib o'rnatadi.

.DESCRIPTION
  Qaytnoma o'rnatgichi (NSIS, `scripts/installer.nsh`) shu skriptni chaqiradi.
  Avval `-CheckOnly` bilan: drayver allaqachon bor bo'lsa foydalanuvchi umuman
  bezovta qilinmaydi. Yo'q bo'lsa o'rnatgich ruxsat so'raydi va skriptni
  ikkinchi marta, bu safar to'liq rejimda ishga tushiradi.

  NEGA QADOQLAMAYMIZ, YUKLAB OLAMIZ: Epson to'plamini o'z o'rnatgichimiz ichiga
  kiritish uni qayta tarqatish demak (EULA tekshirilishi kerak) va hajmni ~70 MB
  oshiradi. Rasmiy manzildan olish esa har doim eng oxirgi versiyani beradi.

  XAVFSIZLIK: yuklab olingan fayl ISHGA TUSHIRILISHDAN OLDIN Authenticode
  imzosi tekshiriladi va imzo egasi EPSON ekaniga ishonch hosil qilinadi.
  Hash bilan bog'lash yaramaydi — Epson faylni yangilaganda buziladi; imzo esa
  yangilanishdan keyin ham to'g'ri qoladi.

  Drayver o'rnatish Windows'da HAR DOIM administrator huquqini talab qiladi,
  shuning uchun Epson o'rnatgichi `RunAs` bilan chaqiriladi va foydalanuvchi
  UAC oynasini ko'radi. Buni chetlab o'tishning yo'li yo'q.

.OUTPUTS
  stdout — bitta JSON qatori. stderr — jarayon xabarlari.
  Chiqish kodlari:
    0  drayver bor (CheckOnly) yoki muvaffaqiyatli o'rnatildi
    1  drayver yo'q (faqat CheckOnly)
    2  yuklab olinmadi (internet yo'q yoki manzil o'zgargan)
    3  imzo tekshiruvidan o'tmadi — fayl ishga tushirilmadi
    4  Epson o'rnatgichi xato bilan tugadi
    5  foydalanuvchi bekor qildi (UAC rad etildi)
#>
[CmdletBinding()]
param(
  # Faqat tekshirish: hech narsa yuklab olinmaydi, o'rnatilmaydi.
  [switch] $CheckOnly,
  # Yuklab olib, imzoni tekshiradi, lekin o'rnatmaydi (sinov uchun).
  [switch] $DownloadOnly,
  # Drayver bor bo'lsa ham o'rnatishni davom ettiradi.
  [switch] $Force,
  # Rasmiy "Drivers and Utilities Combo Package Installer" (DS-530 II).
  [string] $Url = 'https://ftp.epson.com/drivers/DS530II_Lite_AM.exe',
  # Imzo egasi shu matnni o'z ichiga olishi shart.
  [string] $Publisher = 'EPSON'
)

$ErrorActionPreference = 'Stop'
$TYPE_SCANNER = 65537
$PROP_NAME    = 7
$PROP_TYPE    = 5

function Write-Log([string] $msg) {
  [Console]::Error.WriteLine('[drayver] ' + $msg)
}

function Emit-Json($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
}

# --- Ulangan WIA skanerlar ---
# Bu faqat AYNI PAYTDA ulangan qurilmalarni ko'rsatadi: skaner rozetkadan
# uzilgan bo'lsa ro'yxat bo'sh chiqadi, drayver joyida bo'lsa ham.
function Get-WiaScanners {
  $names = New-Object System.Collections.Generic.List[string]
  try {
    $dm = New-Object -ComObject WIA.DeviceManager
    foreach ($info in $dm.DeviceInfos) {
      $type = $null; $name = $null
      foreach ($p in $info.Properties) {
        if ($p.PropertyID -eq $PROP_TYPE) { $type = $p.Value }
        if ($p.PropertyID -eq $PROP_NAME) { $name = $p.Value }
      }
      if ($type -eq $TYPE_SCANNER) { $names.Add([string]$name) | Out-Null }
    }
  } catch {
    Write-Log ('WIA ro`yxatini olib bo`lmadi: ' + $_.Exception.Message)
  }
  return $names.ToArray()
}

# --- O'rnatilgan Epson dasturlari ---
# Skaner uzilgan bo'lsa ham drayver borligini shu bilan bilamiz. Reyestrning
# uchala shoxi ham ko'riladi: 64-bit, 32-bit va joriy foydalanuvchi.
function Get-EpsonDriverEntries {
  $roots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $found = New-Object System.Collections.Generic.List[string]
  foreach ($root in $roots) {
    try {
      foreach ($item in Get-ItemProperty $root -ErrorAction SilentlyContinue) {
        $name = [string]$item.DisplayName
        if ($name -eq '') { continue }
        if ($name -match 'Epson Scan|EPSON Scan|DS-530|DS530') { $found.Add($name) | Out-Null }
      }
    } catch { }
  }
  return ($found | Select-Object -Unique)
}

$scanners = Get-WiaScanners
$entries  = @(Get-EpsonDriverEntries)
$present  = ($scanners.Count -gt 0) -or ($entries.Count -gt 0)

Write-Log ('ulangan skanerlar: ' + $(if ($scanners.Count) { $scanners -join ', ' } else { 'yo`q' }))
Write-Log ('o`rnatilgan Epson dasturlari: ' + $(if ($entries.Count) { $entries -join ', ' } else { 'yo`q' }))

if ($CheckOnly) {
  Emit-Json @{ ok = $true; present = $present; scanners = $scanners; entries = $entries }
  if ($present) { exit 0 } else { exit 1 }
}

if ($present -and -not $Force) {
  Emit-Json @{ ok = $true; skipped = $true; reason = 'ALREADY_PRESENT'; scanners = $scanners; entries = $entries }
  exit 0
}

# --- Yuklab olish ---
$target = Join-Path $env:TEMP 'qaytnoma-epson-driver.exe'
try {
  if (Test-Path $target) { Remove-Item $target -Force }
  # Eski Windows PowerShell standart holatda TLS 1.0 ni tanlashi mumkin, Epson
  # esa uni qabul qilmaydi — protokolni ochiq ko'rsatamiz.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  # Progress chizig'i Invoke-WebRequest ni bir necha barobar sekinlashtiradi.
  $ProgressPreference = 'SilentlyContinue'
  Write-Log ('yuklab olinmoqda: ' + $Url)
  Invoke-WebRequest -Uri $Url -OutFile $target -UseBasicParsing -TimeoutSec 300
  $size = (Get-Item $target).Length
  Write-Log ('yuklandi: {0:N1} MB' -f ($size / 1MB))
  if ($size -lt 100KB) { throw "Fayl juda kichik ($size bayt) - manzil noto'g'ri bo'lishi mumkin" }
} catch {
  Emit-Json @{ ok = $false; code = 'DOWNLOAD_FAILED'; error = $_.Exception.Message; url = $Url }
  exit 2
}

# --- Imzo tekshiruvi (ishga tushirishdan OLDIN) ---
try {
  $sig = Get-AuthenticodeSignature -FilePath $target
  $subject = [string]$sig.SignerCertificate.Subject
  Write-Log ('imzo: ' + $sig.Status + ' / ' + $subject)
  if ($sig.Status -ne 'Valid') { throw "Imzo yaroqsiz: $($sig.Status)" }
  if ($subject -notmatch $Publisher) { throw "Imzo egasi kutilganidek emas: $subject" }
} catch {
  Remove-Item $target -Force -ErrorAction SilentlyContinue
  Emit-Json @{ ok = $false; code = 'SIGNATURE_INVALID'; error = $_.Exception.Message }
  exit 3
}

if ($DownloadOnly) {
  Emit-Json @{ ok = $true; downloaded = $target; installed = $false }
  exit 0
}

# --- O'rnatish (administrator huquqi bilan) ---
try {
  Write-Log 'Epson o`rnatgichi ishga tushirilmoqda (UAC oynasi chiqadi)…'
  $proc = Start-Process -FilePath $target -Verb RunAs -Wait -PassThru
  $code = $proc.ExitCode
  Write-Log ('Epson o`rnatgichi tugadi, kod = ' + $code)
  if ($code -ne 0) {
    Emit-Json @{ ok = $false; code = 'INSTALLER_FAILED'; exitCode = $code }
    exit 4
  }
} catch {
  # RunAs rad etilganda 0x800704C7 (operatsiya bekor qilindi) keladi.
  Emit-Json @{ ok = $false; code = 'CANCELLED'; error = $_.Exception.Message }
  exit 5
}

$after = Get-WiaScanners
Emit-Json @{ ok = $true; installed = $true; scanners = $after }
exit 0
