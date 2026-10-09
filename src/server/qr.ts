// QR codes drawn on the server as a PNG data URL (the pages' Content-Security-Policy allows `data:` images): the 2FA
// secret of Mi cuenta, and the links of the channels a phone opens by scanning (a Telegram bot, the WhatsApp linking code).
import "server-only";
import QRCode from "qrcode";

/** Side of the image, in pixels. */
export const QR_CODE_SIZE = 224;
/** The WhatsApp linking code carries much more than a link: drawn bigger, a phone reads it at once. */
export const QR_CODE_LARGE_SIZE = 288;
const QR_CODE_OPTIONS = { errorCorrectionLevel: "M", margin: 1 } as const;

export function qrCodeDataUrl(text: string, size: number = QR_CODE_SIZE): Promise<string> {
  return QRCode.toDataURL(text, { ...QR_CODE_OPTIONS, width: size });
}
