// Draws the icon of the installed app and of its push notices ([PWA-01]) with next/og: the business logo (PNG or JPG)
// on white, or its initials on the business colour. A logo the renderer cannot draw (WebP, damaged) or cannot find
// gives the initials instead of a broken icon. Each size and look is drawn once per business look in this process,
// so the public route costs a settings read, not a drawing.
import "server-only";
import { ImageResponse } from "next/og";
import { appIconSpec, type AppIconQuery } from "@/components/pwa/app-icon";
import { detectLogoFormat } from "@/data/business";
import { getFileStorage, readAll, type FileStorage } from "@/server/adapters/file-storage";
import { safeErrorMessage } from "@/server/redact";

/** What the renderer (satori) can draw: WebP logos, which the app accepts, are not among them. */
const DRAWABLE_LOGO_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg"]);
const MAX_DRAWN = 12;
const drawn = new Map<string, Uint8Array<ArrayBuffer>>();

export type IconBusiness = { name: string; color: string; logoFileKey: string | null };

/** The stored logo as a data URL the renderer can draw, or null. */
async function drawableLogo(key: string | null, storage: FileStorage): Promise<string | null> {
  if (!key) return null;
  const file = await storage.get(key);
  if (!file) return null;
  const bytes = await readAll(file.stream);
  const format = detectLogoFormat(bytes);
  if (!format || !DRAWABLE_LOGO_TYPES.has(format.contentType)) return null;
  return `data:${format.contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function draw(business: IconBusiness, query: AppIconQuery, logo: string | null): Promise<Uint8Array<ArrayBuffer>> {
  const spec = appIconSpec(business, query.size, query.purpose, logo !== null);
  const image = new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: spec.background }}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/og draws plain <img>; next/image does not exist there.
        <img src={logo} alt="" width={spec.logoSize} height={spec.logoSize} style={{ objectFit: "contain" }} />
      ) : (
        <div style={{ display: "flex", color: spec.foreground, fontSize: spec.fontSize, letterSpacing: "-0.02em" }}>{spec.initials}</div>
      )}
    </div>,
    { width: query.size, height: query.size },
  );
  return new Uint8Array(await image.arrayBuffer());
}

/** The PNG of the icon for `query` (size and look). */
export async function renderAppIcon(business: IconBusiness, query: AppIconQuery, storage: FileStorage = getFileStorage()): Promise<Uint8Array<ArrayBuffer>> {
  const key = [query.size, query.purpose, business.name, business.color, business.logoFileKey ?? ""].join("|");
  const known = drawn.get(key);
  if (known) return known;
  let icon: Uint8Array<ArrayBuffer>;
  try {
    icon = await draw(business, query, await drawableLogo(business.logoFileKey, storage));
  } catch (error) {
    console.warn(`[push] No se ha podido dibujar el logo en el icono de la app; se usan las iniciales: ${safeErrorMessage(error)}`);
    icon = await draw(business, query, null);
  }
  if (drawn.size >= MAX_DRAWN) drawn.clear();
  drawn.set(key, icon);
  return icon;
}
