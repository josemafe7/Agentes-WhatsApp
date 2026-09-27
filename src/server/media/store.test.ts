import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DiskStorage } from "@/server/adapters/file-storage";
import { MEDIA_LIMITS } from "./limits";
import { MediaRejectedError, readStoredMedia, safeFileName, storeInboundMedia } from "./store";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-media-store-"));
const storage = new DiskStorage(dir);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const OGG = new TextEncoder().encode("OggS-fake-voice-note");
const NOW = new Date("2026-09-30T10:00:00Z");

describe("storing inbound media [MED-07] [SEG-04]", () => {
  it("stores the bytes under a generated key with type, size, sha256, name and duration", async () => {
    const media = await storeInboundMedia(
      { bytes: OGG, mimeType: "Audio/OGG; codecs=opus", fileName: "nota de voz.ogg", durationSec: 4.2 },
      { storage, now: NOW },
    );
    expect(media.fileKey).toMatch(/^media\/2026\/09\/[0-9a-f-]{36}\.ogg$/);
    expect(media).toMatchObject({
      mimeType: "audio/ogg; codecs=opus",
      size: OGG.byteLength,
      sha256: createHash("sha256").update(OGG).digest("hex"),
      fileName: "nota de voz.ogg",
      durationSec: 4.2,
      downloadStatus: "done",
    });
    const read = await readStoredMedia(media.fileKey, MEDIA_LIMITS.audioBytes, storage);
    expect(read).toEqual({ ok: true, bytes: OGG, contentType: "audio/ogg; codecs=opus" });
  });

  it("never uses the customer's file name in the key, and cleans it for display", async () => {
    const media = await storeInboundMedia({ bytes: OGG, mimeType: "text/html", fileName: "../../etc/pass\u0000wd.html" }, { storage, now: NOW });
    expect(media.fileKey).toMatch(/^media\/2026\/09\/[0-9a-f-]{36}$/);
    expect(media.fileName).toBe("passwd.html");
    expect(safeFileName("  \u0007  ")).toBeUndefined();
    expect(safeFileName("C:\\Users\\ana\\Factura  marzo.PDF")).toBe("Factura marzo.PDF");
  });

  it("a channel may keep its files under its own prefix", async () => {
    const media = await storeInboundMedia({ bytes: OGG, mimeType: "audio/webm" }, { storage, now: NOW, prefix: "webchat" });
    expect(media.fileKey).toMatch(/^webchat\/2026\/09\/[0-9a-f-]{36}\.webm$/);
  });

  it("stores a malformed type as a generic binary", async () => {
    const media = await storeInboundMedia({ bytes: OGG, mimeType: "image/png\r\nX-Evil: 1" }, { storage, now: NOW });
    expect(media.mimeType).toBe("application/octet-stream");
    const other = await storeInboundMedia({ bytes: OGG, mimeType: "no es un tipo" }, { storage, now: NOW });
    expect(other.mimeType).toBe("application/octet-stream");
  });

  it("rejects empty files and files over the size limit without storing them", async () => {
    await expect(storeInboundMedia({ bytes: new Uint8Array(), mimeType: "image/png" }, { storage })).rejects.toBeInstanceOf(MediaRejectedError);
    const big = new Uint8Array(MEDIA_LIMITS.storedBytes + 1);
    await expect(storeInboundMedia({ bytes: big, mimeType: "video/mp4" }, { storage })).rejects.toMatchObject({ code: "media_too_large", status: 413 });
  });

  it("reading says when a file is missing or too big for the use", async () => {
    const media = await storeInboundMedia({ bytes: OGG, mimeType: "audio/ogg" }, { storage, now: NOW });
    expect(await readStoredMedia(media.fileKey, 5, storage)).toEqual({ ok: false, reason: "too_large" });
    expect(await readStoredMedia("media/2026/09/00000000-0000-4000-8000-000000000000.ogg", 1_000, storage)).toEqual({ ok: false, reason: "missing" });
    expect(await readStoredMedia("../../.env", 1_000, storage)).toEqual({ ok: false, reason: "missing" });
  });
});
