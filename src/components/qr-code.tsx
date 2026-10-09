import Image from "next/image";
import { cn } from "@/lib/utils";

/** Side of the codes drawn by src/server/qr.ts, in pixels. */
const QR_SIZE = 224;

type QrCodeProps = { dataUrl: string; alt: string; className?: string; /** Side in pixels, when the code was drawn bigger. */ size?: number };

/** A QR code drawn on the server (a PNG data URL), always on white so any phone reads it, also in dark mode. */
export function QrCode({ dataUrl, alt, className, size = QR_SIZE }: QrCodeProps) {
  return <Image src={dataUrl} alt={alt} width={size} height={size} unoptimized className={cn("rounded-lg border bg-white p-2", className)} />;
}
