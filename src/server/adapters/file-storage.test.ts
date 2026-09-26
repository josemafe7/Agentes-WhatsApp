import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  head: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));
vi.mock("@vercel/blob", () => blob);

import {
  DiskStorage,
  generateFileKey,
  InvalidFileKeyError,
  isValidFileKey,
  readAll,
  safeExtension,
  VercelBlobStorage,
} from "./file-storage";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-files-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const bytes = (text: string) => new TextEncoder().encode(text);

describe("file keys [SEG-13]", () => {
  it("generates random keys that never contain the original name", () => {
    const key = generateFileKey("media", safeExtension("Factura Ñoña.PDF"), new Date("2026-09-26T10:00:00Z"));
    expect(key).toMatch(/^media\/2026\/09\/[0-9a-f-]{36}\.pdf$/);
    expect(generateFileKey("media")).not.toBe(generateFileKey("media"));
  });

  it("accepts only plain keys", () => {
    for (const bad of ["../x", "a/../../b", "/abs", "C:/x", "a\\b", "a//b", "a/b.meta.json", "Mayus/x", "a/.env", ""]) {
      expect(isValidFileKey(bad), bad).toBe(false);
    }
    expect(isValidFileKey("kb/2026/09/abc-123.pdf")).toBe(true);
  });

  it("extracts only short plain extensions", () => {
    expect(safeExtension("foto.JPG")).toBe(".jpg");
    expect(safeExtension("sin-extension")).toBe("");
    expect(safeExtension("raro.ext;rm")).toBe("");
  });
});

describe("DiskStorage", () => {
  const storage = new DiskStorage(root);

  it("stores, reads, checks and deletes a file with its content type", async () => {
    const key = generateFileKey("test", ".txt");
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.put(key, bytes("hola"), "text/plain")).toEqual({ key, size: 4 });
    expect(await storage.exists(key)).toBe(true);
    const file = await storage.get(key);
    expect(file).not.toBeNull();
    expect(file?.contentType).toBe("text/plain");
    expect(file?.size).toBe(4);
    expect(new TextDecoder().decode(await readAll(file!.stream))).toBe("hola");
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it("never reads or writes outside its folder", async () => {
    await expect(storage.put("../escape.txt", bytes("x"), "text/plain")).rejects.toThrow(InvalidFileKeyError);
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(InvalidFileKeyError);
    expect(fs.existsSync(path.join(path.dirname(root), "escape.txt"))).toBe(false);
  });
});

describe("VercelBlobStorage [decision 0010]", () => {
  const storage = new VercelBlobStorage();
  beforeEach(() => vi.clearAllMocks());

  it("uploads to the private store without random suffix", async () => {
    blob.put.mockResolvedValue({ pathname: "media/2026/09/a.png" });
    await storage.put("media/2026/09/a.png", bytes("img"), "image/png");
    expect(blob.put).toHaveBeenCalledWith(
      "media/2026/09/a.png",
      expect.any(Buffer),
      expect.objectContaining({ access: "private", contentType: "image/png", addRandomSuffix: false }),
    );
  });

  it("reads privately and maps a missing blob to null", async () => {
    const stream = new Blob([bytes("abc")]).stream();
    blob.get.mockResolvedValueOnce({ statusCode: 200, stream, blob: { contentType: "text/plain", size: 3 } });
    const file = await storage.get("kb/x.txt");
    expect(blob.get).toHaveBeenCalledWith("kb/x.txt", expect.objectContaining({ access: "private" }));
    expect(file?.size).toBe(3);
    blob.get.mockResolvedValueOnce(null);
    expect(await storage.get("kb/y.txt")).toBeNull();
  });

  it("exists uses head() and treats BlobNotFoundError as missing", async () => {
    blob.head.mockResolvedValueOnce({ size: 1 });
    expect(await storage.exists("kb/x.txt")).toBe(true);
    blob.head.mockRejectedValueOnce(new blob.BlobNotFoundError("nope"));
    expect(await storage.exists("kb/y.txt")).toBe(false);
  });

  it("rejects invalid keys before calling Blob", async () => {
    await expect(storage.delete("../x")).rejects.toThrow(InvalidFileKeyError);
    expect(blob.del).not.toHaveBeenCalled();
  });
});
