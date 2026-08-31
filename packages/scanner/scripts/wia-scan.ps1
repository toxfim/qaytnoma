<#
.SYNOPSIS
  Epson DS-530 II (yoki boshqa WIA skaner) dan ADF orqali sahifalarni skanerlaydi.

.DESCRIPTION
  UI-siz, to'liq dasturiy WIA 2.0 skanerlash. Har bir sahifa alohida faylga
  saqlanadi. Natija stdout'ga bitta JSON qatori sifatida chiqadi.
  Jarayon xabarlari stderr'ga yoziladi, shuning uchun stdout toza JSON bo'ladi.

  Node tomondan chaqiriladi:
    powershell -NoProfile -ExecutionPolicy Bypass -File wia-scan.ps1 -Dpi 300 -OutDir ...

.OUTPUTS
  {"ok":true,"pages":["...page_001.bmp"],"dpi":300,"device":"EPSON DS-530II","elapsedMs":1234}
  {"ok":false,"error":"...","code":"NO_DEVICE","pages":[]}
  {"ok":false,"error":"...","code":"DEVICE_BUSY","pages":[]}
#>
[CmdletBinding()]
param(
  [int]    $Dpi        = 300,
  [string] $OutDir     = "$env:TEMP\wia-scan",
  # BMP | PNG | JPEG | TIFF  (qurilma qo'llab-quvvatlasa)
  [string] $Format     = 'BMP',
  # 3 = RGB rang (ko'k siyohni ajratish uchun SHART), 2 = kulrang, 0 = 1-bit
  [int]    $DataType   = 3,
  [int]    $MaxPages   = 200,
  # Qurilmani nom bo'yicha filtrlash (bo'sh bo'lsa birinchi skaner olinadi)
  [string] $DeviceName = '',
  # A4 o'lchami (dyuym)
  [double] $PageWidthIn  = 8.27,
  [double] $PageHeightIn = 11.70,
  # Qurilma band bo'lsa umumiy kutish byudjeti (soniya). O'lchangan: uzilgan
  # seansdan keyin DS-530II ~82 s davomida "busy" qaytardi, keyin o'zi bo'shadi.
  [int]    $BusyWaitSec = 120,
  [switch] $ListOnly
)

$ErrorActionPreference = 'Stop'

# ---------- WIA konstantalari ----------
$WIA_DPS_DOCUMENT_HANDLING_SELECT = 3088
$WIA_DPS_DOCUMENT_HANDLING_STATUS = 3087
$WIA_DPS_PAGES                    = 3096
$WIA_IPS_PAGE_SIZE                = 3097
$WIA_IPS_PAGE_WIDTH               = 3098
$WIA_IPS_PAGE_HEIGHT              = 3099
$WIA_IPS_XRES                     = 6147
$WIA_IPS_YRES                     = 6148
$WIA_IPS_XPOS                     = 6149
$WIA_IPS_YPOS                     = 6150
$WIA_IPS_XEXTENT                  = 6151
$WIA_IPS_YEXTENT                  = 6152
$WIA_IPA_DATATYPE                 = 4103

$FEEDER      = 1     # WIA_DPS_DOCUMENT_HANDLING_SELECT
$FEED_READY  = 1     # WIA_DPS_DOCUMENT_HANDLING_STATUS biti
$PAPER_JAM   = 32
$PAGE_CUSTOM = 2
$TYPE_SCANNER = 65537

$FORMATS = @{
  'BMP'  = '{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}'
  'JPEG' = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
  'PNG'  = '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}'
  'TIFF' = '{B96B3CB1-0728-11D3-9D7B-0000F81EF32E}'
}

$script:logClock = [System.Diagnostics.Stopwatch]::StartNew()
function Write-Log([string] $msg) {
  # Vaqt belgisi — WIA ulanish, sozlash va har bir Transfer qancha olishini
  # ko'rish uchun (skaner tezligini baholashda kerak bo'ldi).
  [Console]::Error.WriteLine(('[wia {0,6:N1}s] ' -f $script:logClock.Elapsed.TotalSeconds) + $msg)
}

function Emit-Json($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
}

function Get-Prop($propColl, [int] $id) {
  foreach ($p in $propColl) { if ($p.PropertyID -eq $id) { return $p } }
  return $null
}

function Get-PropValue($propColl, [int] $id) {
  $p = Get-Prop $propColl $id
  if ($null -eq $p) { return $null }
  try { return $p.Value } catch { return $null }
}

# Xususiyatni o'rnatishga urinadi; qo'llab-quvvatlanmasa jim o'tadi.
function Try-SetProp($propColl, [int] $id, $value, [string] $label) {
  $p = Get-Prop $propColl $id
  if ($null -eq $p) { Write-Log ("prop {0} ({1}) yo'q - o'tkazib yuborildi" -f $label, $id); return $false }
  try {
    $p.Value = $value
    return $true
  } catch {
    Write-Log ("prop {0} ({1}) = {2} o'rnatilmadi: {3}" -f $label, $id, $value, $_.Exception.Message)
    return $false
  }
}

# COM xatosidan HRESULT ni oladi. PowerShell uni ba'zan tashqi
# `COMException` ga, ba'zan `MethodInvocationException` ning ichiga o'raydi.
function Get-Hr($err) {
  $hr = 0
  if ($null -ne $err.Exception.InnerException) { $hr = $err.Exception.InnerException.HResult }
  if ($hr -eq 0) { $hr = $err.Exception.HResult }
  return ('0x{0:X8}' -f $hr)
}

# Skanerni ushlab turishi mumkin bo'lgan dasturlar. Xabarda nomma-nom
# ko'rsatiladi: "qurilma band" o'z-o'zicha foydalanuvchiga hech nima
# tushuntirmaydi, "Windows Skanerlash ochiq" esa bitta harakatga olib keladi.
#
# Qaytnoma va Qaytnoma AI bu ro'yxatda YO'Q: ikkalasi ham tray dasturi bo'lib
# doim ishlab turadi, shunchaki ochiqligi qurilmani band qilmaydi. Ular
# to'sqinlik qilishi mumkin bo'lgan yagona payt — ayni damda skanerlashi;
# u alohida, aniqroq tekshiriladi (Test-SiblingScan).
$SCANNER_APPS = [ordered]@{
  'ScanApp'          = 'Windows Skanerlash'
  'WFS'              = 'Windows Faks va skanerlash'
  'wiaacmgr'         = 'Windows skanerlash ustasi'
  'EEventManager'    = 'Epson Event Manager'
  'Escndv'           = 'Epson Scan'
  'epsonscan2'       = 'Epson Scan 2'
  'EPSON Scan 2'     = 'Epson Scan 2'
  'DocumentCapture'  = 'Epson Document Capture'
  'CapturePro'       = 'Epson Document Capture Pro'
}

function Get-BlockingApps() {
  $names = New-Object System.Collections.Generic.List[string]
  foreach ($key in $SCANNER_APPS.Keys) {
    if (Get-Process -Name $key -ErrorAction SilentlyContinue) {
      $label = $SCANNER_APPS[$key]
      if (-not $names.Contains($label)) { $names.Add($label) | Out-Null }
    }
  }
  return $names.ToArray()
}

# Ikkinchi Qaytnoma ilovasi ham shu skriptni ishga tushirganmi? Ikkala ilova
# bir vaqtda o'rnatilishi ko'zda tutilgan (natijalarni solishtirish uchun),
# shuning uchun "boshqasi hozir skanerlamoqda" — kutilgan holat, xato emas.
function Test-SiblingScan() {
  try {
    $others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*wia-scan.ps1*' })
    return $others.Count -gt 0
  } catch { return $false }
}

function Busy-Message([string] $action) {
  $text = "Skaner band (WIA_ERROR_BUSY) - {0}." -f $action
  if (Test-SiblingScan) {
    return $text + " Ikkinchi Qaytnoma ilovasi ayni damda skanerlamoqda - u tugashini kuting."
  }
  $apps = Get-BlockingApps
  if ($apps.Count -gt 0) {
    return $text + " Ochiq turgan skaner dasturlari: " + ($apps -join ', ') + ". Ularni yoping va qayta urinib ko'ring."
  }
  return $text + " Boshqa dastur ko'rinmayapti - oldingi skanerlash uzilib qolgan bo'lsa, drayver qurilmani yana ~1-2 daqiqa band deb ko'rsatadi."
}

<#
.SYNOPSIS
  WIA amalini bajaradi; qurilma band bo'lsa byudjet tugaguncha qayta uradi.

.DESCRIPTION
  NEGA KERAK: 0x80210006 (WIA_ERROR_BUSY) qurilma haqiqatan ishlayotganini
  BILDIRMAYDI. Uzilgan seansdan keyin (jarayon o'ldirilgan, ilova yopilgan,
  boshqa skaner dasturi ochilib-yopilgan) drayver bo'sh turgan qurilmani ham
  band deb ko'rsatadi. O'lchangan: DS-530II shu holatda 82 soniya "busy"
  qaytardi va keyin hech qanday aralashuvsiz o'zi bo'shadi. Bitta urinishda
  taslim bo'lish foydalanuvchiga "The device is busy" degan inglizcha drayver
  xabarini ko'rsatadi va butun skanerlashni bekor qiladi - holbuki bir daqiqa
  kutish yetardi.

  Band bo'lish - Transfer BOSHLANMAGANI demak, shuning uchun qayta urinish
  qog'ozni ikki marta tortib olmaydi.
#>
$script:busyExhausted = $false
function Invoke-WiaBusy([scriptblock] $action, [string] $label) {
  $deadline = (Get-Date).AddSeconds($BusyWaitSec)
  $delay = 3
  for ($attempt = 1; ; $attempt++) {
    try {
      return & $action
    } catch {
      if ((Get-Hr $_) -ne '0x80210006') { throw }
      if ((Get-Date) -ge $deadline) {
        # Bayroq: pastdagi `catch` lar buni oddiy Transfer xatosi deb
        # o'ramasin, xabar va `DEVICE_BUSY` kodi shundayligicha yetib borsin.
        $script:busyExhausted = $true
        throw (Busy-Message $label)
      }
      Write-Log ("{0}: qurilma band, {1} s dan keyin qayta ({2}-urinish)" -f $label, $delay, $attempt)
      # Tray ikonkasi nima kutayotganini ko'rsatsin - aks holda dastur
      # bir daqiqaga sababsiz "bajarilmoqda" holatida qotib turadi.
      Emit-Json @{ event = 'status'; message = ("Skaner band - kutilmoqda ({0}-urinish)" -f $attempt) }
      Start-Sleep -Seconds $delay
      if ($delay -lt 10) { $delay += 2 }
    }
  }
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$pages = New-Object System.Collections.Generic.List[string]

try {
  if (-not $FORMATS.ContainsKey($Format)) {
    throw ("Noma'lum format: {0}. Mumkin: {1}" -f $Format, ($FORMATS.Keys -join ', '))
  }

  $dm = New-Object -ComObject WIA.DeviceManager

  # --- Qurilmani topish ---
  $target = $null
  $found  = New-Object System.Collections.Generic.List[string]
  foreach ($info in $dm.DeviceInfos) {
    $type = Get-PropValue $info.Properties 5
    $name = Get-PropValue $info.Properties 7
    if ($type -ne $TYPE_SCANNER) { continue }
    $found.Add([string]$name) | Out-Null
    if ($DeviceName -eq '' -or ([string]$name) -like ('*' + $DeviceName + '*')) {
      if ($null -eq $target) { $target = $info }
    }
  }

  if ($ListOnly) {
    Emit-Json @{ ok = $true; devices = $found.ToArray() }
    exit 0
  }

  if ($null -eq $target) {
    Emit-Json @{ ok = $false; code = 'NO_DEVICE'; error = ('Skaner topilmadi. Mavjud: ' + ($found -join ', ')); pages = @() }
    exit 2
  }

  $deviceName = [string](Get-PropValue $target.Properties 7)
  Write-Log ('qurilma: ' + $deviceName)

  $dev = Invoke-WiaBusy { $target.Connect() } 'ulanish'

  # --- ADF ni tanlash ---
  $caps = Get-PropValue $dev.Properties 3086
  Write-Log ('handling caps = ' + $caps)
  Try-SetProp $dev.Properties $WIA_DPS_DOCUMENT_HANDLING_SELECT $FEEDER 'HANDLING_SELECT' | Out-Null
  # Pages = 1 -> har Transfer bitta sahifa qaytaradi (ADF loop shu bilan boshqariladi)
  Try-SetProp $dev.Properties $WIA_DPS_PAGES 1 'PAGES' | Out-Null

  # ADF sensori holati.
  #
  # NEGA BU YERDA DARHOL TO'XTAMAYMIZ: DS-530II drayveri qog'oz solingandan
  # keyin FEED_READY bitini darhol yangilamaydi. Foydalanuvchi qog'ozni qayta
  # solib Skanerlash bosganda skript "ADF bosh" deb chiqib ketardi, holbuki
  # qog'oz joyida edi. Shuning uchun status bir necha marta qayta o'qiladi,
  # keyin esa BARIBIR Transfer ga urinib ko'riladi — qog'oz haqiqatan yo'q
  # bo'lsa drayver WIA_ERROR_PAPER_EMPTY (0x80210003) qaytaradi va biz uni
  # loop oxirida aniq aniqlaymiz. Sensor holatiga ishonishdan ko'ra bu
  # ishonchliroq: noto'g'ri "qog'oz yo'q" xabari — foydalanuvchi uchun
  # tushunarsiz nosozlik, ortiqcha Transfer urinishi esa bepul.
  $status = Get-PropValue $dev.Properties $WIA_DPS_DOCUMENT_HANDLING_STATUS
  Write-Log ('handling status = ' + $status)
  for ($try = 1; $try -le 3; $try++) {
    if ($null -eq $status -or (($status -band $FEED_READY) -ne 0)) { break }
    Start-Sleep -Milliseconds 400
    $status = Get-PropValue $dev.Properties $WIA_DPS_DOCUMENT_HANDLING_STATUS
    Write-Log ('handling status (qayta {0}) = {1}' -f $try, $status)
  }
  if ($null -ne $status -and (($status -band $FEED_READY) -eq 0)) {
    Write-Log 'FEED_READY yoq - baribir Transfer ga urinamiz'
  }

  $item = $dev.Items.Item(1)

  # --- Skanerlash parametrlari (tartib muhim: avval DPI, keyin extent) ---
  Try-SetProp $item.Properties $WIA_IPA_DATATYPE $DataType 'DATATYPE' | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_XRES $Dpi 'XRES' | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_YRES $Dpi 'YRES' | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_PAGE_SIZE $PAGE_CUSTOM 'PAGE_SIZE' | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_PAGE_WIDTH  ([int]([math]::Round($PageWidthIn  * 1000))) 'PAGE_WIDTH'  | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_PAGE_HEIGHT ([int]([math]::Round($PageHeightIn * 1000))) 'PAGE_HEIGHT' | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_XPOS 0 'XPOS' | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_YPOS 0 'YPOS' | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_XEXTENT ([int]([math]::Round($PageWidthIn  * $Dpi))) 'XEXTENT' | Out-Null
  Try-SetProp $item.Properties $WIA_IPS_YEXTENT ([int]([math]::Round($PageHeightIn * $Dpi))) 'YEXTENT' | Out-Null

  $effXRes = Get-PropValue $item.Properties $WIA_IPS_XRES
  $effYRes = Get-PropValue $item.Properties $WIA_IPS_YRES
  $effXExt = Get-PropValue $item.Properties $WIA_IPS_XEXTENT
  $effYExt = Get-PropValue $item.Properties $WIA_IPS_YEXTENT
  $effType = Get-PropValue $item.Properties $WIA_IPA_DATATYPE
  Write-Log ('haqiqiy: {0}x{1} dpi, {2}x{3} px, datatype={4}' -f $effXRes, $effYRes, $effXExt, $effYExt, $effType)

  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

  $fmtGuid = $FORMATS[$Format]
  $ext     = $Format.ToLower()
  if ($ext -eq 'jpeg') { $ext = 'jpg' }

  # --- ADF loop ---
  for ($i = 1; $i -le $MaxPages; $i++) {
    $st = Get-PropValue $dev.Properties $WIA_DPS_DOCUMENT_HANDLING_STATUS
    if ($null -ne $st -and (($st -band $PAPER_JAM) -ne 0)) {
      throw "Qogoz tiqilib qoldi (PAPER_JAM)"
    }
    if ($i -gt 1 -and $null -ne $st -and (($st -band $FEED_READY) -eq 0)) {
      Write-Log ("ADF boshadi ({0} sahifa)" -f ($i - 1))
      break
    }

    $img = $null
    try {
      # Band bo'lish shu yerda ham uchraydi: boshqa dastur to'plam o'rtasida
      # qurilmaga yopishsa. Invoke-WiaBusy uni kutadi, qolgan xatolar o'tadi.
      $img = Invoke-WiaBusy { $item.Transfer($fmtGuid) } ("sahifa {0}" -f $i)
    } catch {
      $hex = Get-Hr $_
      # 0x80210003 = WIA_ERROR_PAPER_EMPTY -> normal tugash
      if ($hex -eq '0x80210003') {
        Write-Log ("PAPER_EMPTY - tugadi ({0} sahifa)" -f ($i - 1))
        break
      }
      if ($hex -eq '0x80210006' -or $script:busyExhausted) { throw }
      throw ("Transfer xatosi (sahifa {0}, HRESULT={1}): {2}" -f $i, $hex, $_.Exception.Message)
    }

    $path = Join-Path $OutDir ('page_{0:D3}.{1}' -f $i, $ext)
    if (Test-Path $path) { Remove-Item $path -Force }
    $img.SaveFile($path)
    $pages.Add($path) | Out-Null
    Write-Log ('sahifa {0}: {1}x{2} -> {3} ({4:N1} MB)' -f $i, $img.Width, $img.Height, (Split-Path $path -Leaf), ((Get-Item $path).Length / 1MB))

    # Sahifa tayyor bo'lishi bilan Node'ga xabar beramiz — u qayta ishlashni
    # skaner keyingi varaqni o'qiyotgan paytda boshlaydi. Yakuniy JSON dan
    # farqi: `event` maydoni bor va `ok` yo'q.
    Emit-Json @{ event = 'page'; index = ($i - 1); path = $path }

    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($img)
    $img = $null
    [System.GC]::Collect()
  }

  $sw.Stop()

  # Birorta sahifa olinmadi — demak ADF haqiqatan bo'sh edi. Bu yagona
  # ishonchli tekshiruv: yuqoridagi sensor holati eskirgan bo'lishi mumkin,
  # Transfer ning javobi esa yo'q.
  if ($pages.Count -eq 0) {
    Emit-Json @{ ok = $false; code = 'NO_PAPER'; error = 'ADF bosh - qogoz soling'; pages = @(); device = $deviceName }
    exit 3
  }

  Emit-Json @{
    ok        = $true
    device    = $deviceName
    dpi       = $Dpi
    format    = $Format
    dataType  = $effType
    width     = $effXExt
    height    = $effYExt
    pages     = $pages.ToArray()
    elapsedMs = $sw.ElapsedMilliseconds
  }
  exit 0

} catch {
  $sw.Stop()
  $busy = $script:busyExhausted -or ((Get-Hr $_) -eq '0x80210006')
  $code = 'SCAN_FAILED'
  $text = $_.Exception.Message
  if ($busy) {
    $code = 'DEVICE_BUSY'
    if (-not $script:busyExhausted) { $text = Busy-Message 'ulanish' }
  }
  Emit-Json @{
    ok        = $false
    code      = $code
    error     = $text
    pages     = $pages.ToArray()
    elapsedMs = $sw.ElapsedMilliseconds
  }
  if ($busy) { exit 4 }
  exit 1

} finally {
  # COM obyektlarini QO'LDA bo'shatamiz.
  #
  # NEGA: WIA seansi ochiq qolsa, drayver bo'sh turgan qurilmani ham keyingi
  # ulanishlarga "busy" deb ko'rsatadi (o'lchangan: 82 s). Jarayon tugashida
  # RCW lar yig'ilishiga ishonish yetarli emas - PowerShell chiqishda GC ni
  # kafolatlamaydi, va aynan tez ketma-ket ikkinchi skanerlash shundan
  # yiqilardi.
  foreach ($com in @($item, $dev, $dm)) {
    if ($null -ne $com) {
      try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($com) } catch {}
    }
  }
  $item = $null; $dev = $null; $dm = $null
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
