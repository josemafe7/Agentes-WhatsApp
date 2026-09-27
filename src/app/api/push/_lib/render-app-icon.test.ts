import { describe, expect, it } from "vitest";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { renderAppIcon } from "./render-app-icon";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A 1 × 1 red PNG, as a business logo. */
const RED_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/** A 1 × 1 WebP: the app accepts WebP logos, but the icon renderer cannot draw them. */
const WEBP = Buffer.from("52494646240000005745425056503820180000003001009d012a0100010002003425a400037000feff94000000", "hex");

const business = { name: "Peluquería Aurora", color: "#b4235a" };
const any192 = { size: 192, purpose: "any" } as const;

describe("drawing the app icon [PWA-01]", () => {
  it("draws the business logo when there is one", async () => {
    const { storage } = memoryFileStorage();
    await storage.put("logos/2026/09/logo.png", RED_PNG, "image/png");

    const withLogo = await renderAppIcon({ ...business, logoFileKey: "logos/2026/09/logo.png" }, any192, storage);
    const initials = await renderAppIcon({ ...business, logoFileKey: null }, any192, storage);

    expect(Array.from(withLogo.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    expect(Array.from(initials.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    expect(Buffer.compare(Buffer.from(withLogo), Buffer.from(initials))).not.toBe(0);
  });

  it("a logo it cannot draw (WebP) or that is gone from storage gives the initials instead of a broken icon", async () => {
    const { storage } = memoryFileStorage();
    await storage.put("logos/2026/09/logo.webp", WEBP, "image/webp");

    const initials = await renderAppIcon({ ...business, logoFileKey: null }, any192, storage);
    const webp = await renderAppIcon({ ...business, logoFileKey: "logos/2026/09/logo.webp" }, any192, storage);
    const missing = await renderAppIcon({ ...business, logoFileKey: "logos/2026/09/borrado.png" }, any192, storage);

    expect(Buffer.from(webp).equals(Buffer.from(initials))).toBe(true);
    expect(Buffer.from(missing).equals(Buffer.from(initials))).toBe(true);
  });

  it("draws the size asked for", async () => {
    const { storage } = memoryFileStorage();
    const icon = await renderAppIcon({ ...business, logoFileKey: null }, { size: 512, purpose: "maskable" }, storage);
    // IHDR: width and height, big-endian, right after the signature and the chunk header.
    const view = new DataView(icon.buffer, icon.byteOffset, icon.byteLength);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([512, 512]);
  });
});
