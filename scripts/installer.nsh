; Qaytnoma o'rnatgichining qo'shimchasi: skaner drayveri.
;
; electron-builder buildResources papkasidagi `installer.nsh` ni o'zi topib
; qo'shadi (bizda u `build/resources`). `build/` git'da kuzatilmaydi, shuning
; uchun asl nusxa `scripts/` da turadi va uni `scripts/build-installer.mjs`
; yig'ish oldidan ko'chiradi.
;
; MANTIQ: avval `-CheckOnly` bilan tekshiramiz. Drayver allaqachon bor bo'lsa
; foydalanuvchi umuman bezovta qilinmaydi va hech narsa yuklanmaydi. Faqat
; topilmagan holatda ruxsat so'raymiz. Rad etilsa o'rnatish odatdagidek davom
; etadi - drayver ilovaning ishlashi uchun kerak, lekin uni keyin ham
; o'rnatish mumkin va biz o'rnatishni to'xtatmaymiz.
;
; Barcha matnlar ATAYIN faqat ASCII belgilardan iborat (o' va g' oddiy
; apostrof bilan): makensis manba faylni Unicode rejimida o'qiydi va BOM'siz
; UTF-8 dagi harflar o'rnatgichda buzilib chiqadi.

!include LogicLib.nsh

!macro customInstall
  DetailPrint "Skaner drayveri tekshirilmoqda..."

  InitPluginsDir
  File "/oname=$PLUGINSDIR\install-driver.ps1" "${BUILD_RESOURCES_DIR}\install-driver.ps1"

  ; Chiqish kodi: 0 - drayver bor, 1 - yo'q. Boshqa qiymat (yoki "error")
  ; kelsa ham so'rab ko'ramiz: ortiqcha savol drayversiz qolishdan yaxshiroq.
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-driver.ps1" -CheckOnly'
  Pop $0
  Pop $1

  ${If} $0 == 0
    DetailPrint "Skaner drayveri allaqachon o'rnatilgan - o'tkazib yuborildi."
  ${Else}
    ; Jimjit rejimda (`/S`) savol bermaymiz: standart javob - yo'q.
    StrCpy $2 "no"
    MessageBox MB_YESNO|MB_ICONQUESTION "Kompyuterda skaner drayveri topilmadi. Ilova drayversiz skanerlay olmaydi.$\n$\nEpson'ning rasmiy drayverini hozir yuklab olib o'rnatamizmi?$\n$\nBuning uchun internet aloqasi va administrator ruxsati (UAC oynasi) kerak bo'ladi." /SD IDNO IDNO +2
    StrCpy $2 "yes"

    ${If} $2 == "yes"
      DetailPrint "Epson drayveri yuklab olinmoqda va o'rnatilmoqda..."
      DetailPrint "Epson oynasi ochilganda uning ko'rsatmalariga amal qiling."
      nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-driver.ps1"'
      Pop $0

      ${If} $0 == 0
        DetailPrint "Skaner drayveri o'rnatildi."
      ${ElseIf} $0 == 2
        DetailPrint "Drayverni yuklab bo'lmadi."
        MessageBox MB_OK|MB_ICONEXCLAMATION "Drayverni yuklab bo'lmadi - internet aloqasini tekshiring.$\n$\nUni keyinroq qo'lda o'rnatishingiz mumkin:$\nhttps://epson.com/Support/Scanners/DS-Series/Epson-DS-530-II/s/SPT_B11B261202$\n$\nQaytnoma o'rnatildi va drayver paydo bo'lgach ishlaydi." /SD IDOK
      ${ElseIf} $0 == 3
        DetailPrint "Yuklangan faylning imzosi tasdiqlanmadi - ishga tushirilmadi."
        MessageBox MB_OK|MB_ICONSTOP "Yuklangan faylning raqamli imzosi Epson'niki emas, shuning uchun u ishga tushirilmadi.$\n$\nDrayverni Epson saytidan qo'lda yuklab oling." /SD IDOK
      ${ElseIf} $0 == 5
        DetailPrint "Drayver o'rnatish bekor qilindi."
      ${Else}
        DetailPrint "Epson o'rnatgichi xato bilan tugadi (kod $0)."
        MessageBox MB_OK|MB_ICONEXCLAMATION "Epson o'rnatgichi tugallanmadi.$\n$\nDrayverni keyinroq qo'lda o'rnatib ko'ring." /SD IDOK
      ${EndIf}
    ${Else}
      DetailPrint "Drayver o'rnatish o'tkazib yuborildi."
    ${EndIf}
  ${EndIf}
!macroend
