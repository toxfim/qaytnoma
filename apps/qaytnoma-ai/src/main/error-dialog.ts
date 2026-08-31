/**
 * Xato sababini modal oynada ko'rsatish.
 *
 * NEGA BILDIRISHNOMA YETARLI EMAS: Windows bildirishnomasi «Diqqatni jamlash»
 * (Focus assist) yoqilgan yoki bildirishnomalar o'chirilgan kompyuterda
 * UMUMAN ko'rinmaydi va bir necha soniyadan keyin yo'qoladi. Tray menyusidagi
 * qator esa 60 belgida kesiladi — «Skaner topilmadi — USB ulanishini...» dan
 * keyingi qismi yo'qoladi. Natijada foydalanuvchi nima bo'lganini hech
 * qayerdan to'liq o'qiy olmasdi: ikonka qizarardi, sabab esa noma'lum qolardi.
 *
 * Modal oyna bir vaqtda bittadan ortiq ochilmaydi — kuzatilayotgan papkada
 * ketma-ket bir necha fayl xato bersa, ekran oynalar bilan to'lib ketmasin.
 */
import { app, clipboard, dialog } from 'electron';

let open = false;

/**
 * @param heading qisqa sarlavha, masalan «Skanerlash bajarilmadi»
 * @param message xatoning to'liq matni — kesilmaydi
 */
export async function showErrorDialog(heading: string, message: string): Promise<void> {
  if (open) return;
  open = true;

  const stamp = `Qaytnoma AI ${app.getVersion()} · ${new Date().toLocaleString('uz-UZ')}`;

  try {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Qaytnoma AI',
      message: heading,
      detail: `${message}\n\n${stamp}`,
      buttons: ['Yopish', 'Matnni nusxalash'],
      defaultId: 0,
      cancelId: 0,
      // Windows tugmalarni «command link» ko'rinishida chizmasin.
      noLink: true,
    });

    // Yordam so'rashda xatoni qo'lda ko'chirib yozish shart bo'lmasin.
    if (response === 1) clipboard.writeText(`${heading}\n\n${message}\n\n${stamp}`);
  } finally {
    open = false;
  }
}
