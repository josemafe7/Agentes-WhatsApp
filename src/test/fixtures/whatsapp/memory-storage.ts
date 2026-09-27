// An in-memory FileStorage for tests that store and read files (media downloads, uploads before sending).
import type { FileStorage } from "@/server/adapters/file-storage";

export function memoryFileStorage() {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage: FileStorage = {
    kind: "disk",
    put: async (key, data, contentType) => {
      files.set(key, { bytes: data, contentType });
      return { key, size: data.byteLength };
    },
    get: async (key) => {
      const file = files.get(key);
      if (!file) return null;
      return { stream: new Response(file.bytes.slice()).body as ReadableStream<Uint8Array>, contentType: file.contentType, size: file.bytes.byteLength };
    },
    delete: async (key) => {
      files.delete(key);
    },
    exists: async (key) => files.has(key),
  };
  return { storage, files };
}
