@echo off
REM Barcodeer tray dasturini ishga tushiradi.
REM Ikki marta bosing yoki: start.cmd
REM
REM Dastur oyna ochmaydi - soat yonidagi tray'da ikonka paydo bo'ladi.
REM Ikonka ustiga bosing: Yoqilgan / Skanerlash / Sozlamalar / Chiqish.

cd /d "%~dp0"

echo Barcodeer qurilmoqda...
call npx tsc -b
if errorlevel 1 (
  echo.
  echo Build bajarilmadi. Avval "pnpm install" ni ishlating.
  pause
  exit /b 1
)

echo Ishga tushirilmoqda...
cd apps\tray
start "" npx electron .
