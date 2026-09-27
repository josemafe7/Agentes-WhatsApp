import { describe, expect, it } from "vitest";
import { detectWidgetMedia, readBodyWithLimit } from "./upload";

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(32).fill(0)]);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

describe("widget file types [SEG-13] [WEB-07]", () => {
  it("recognises images and voice notes by their content, never by the declared type", () => {
    expect(detectWidgetMedia(bytes(0xff, 0xd8, 0xff, 0xe0))).toMatchObject({ kind: "image", mimeType: "image/jpeg" });
    expect(detectWidgetMedia(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(detectWidgetMedia(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP")))).toMatchObject({ kind: "image", mimeType: "image/webp" });
    expect(detectWidgetMedia(bytes(0x1a, 0x45, 0xdf, 0xa3))).toMatchObject({ kind: "audio", mimeType: "audio/webm" });
    expect(detectWidgetMedia(bytes(...ascii("OggS")))).toMatchObject({ kind: "audio", mimeType: "audio/ogg" });
    expect(detectWidgetMedia(bytes(0, 0, 0, 0x20, ...ascii("ftypM4A ")))).toMatchObject({ kind: "audio", mimeType: "audio/mp4" });
    expect(detectWidgetMedia(bytes(...ascii("ID3"), 4))).toMatchObject({ kind: "audio", mimeType: "audio/mpeg" });
    expect(detectWidgetMedia(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")))).toMatchObject({ kind: "audio", mimeType: "audio/wav" });
  });

  it("refuses anything else (SVG and HTML can run code, PDFs and videos are not offered)", () => {
    expect(detectWidgetMedia(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectWidgetMedia(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectWidgetMedia(bytes(...ascii("%PDF-1.7")))).toBeNull();
    expect(detectWidgetMedia(new Uint8Array())).toBeNull();
  });
});

describe("upload size [WEB-09]", () => {
  const request = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://localhost:3000/upload", { method: "POST", body, headers, duplex: "half" } as RequestInit);

  it("reads a body within the limit", async () => {
    const result = await readBodyWithLimit(request(new Uint8Array(10)), 10);
    expect(result?.byteLength).toBe(10);
  });

  it("refuses a body over the limit by its declared length before reading it", async () => {
    expect(await readBodyWithLimit(request(new Uint8Array(4), { "content-length": "11" }), 10)).toBeNull();
  });

  it("refuses a streamed body that goes over the limit without a declared length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    expect(await readBodyWithLimit(request(stream), 10)).toBeNull();
  });
});
