// The email adapters in the common registry ([CAN-02], [CAN-14], [ARR-11]).
import { describe, expect, it } from "vitest";
import { demoAdapter } from "../demo-adapter";
import { getChannelAdapter, getSendAdapter } from "../registry";
import type { ChannelRecord } from "../types";
import { gmailAdapter, imapAdapter, outlookAdapter } from "./adapter";

const channel = { config: {} } as unknown as ChannelRecord;

describe("adaptadores de correo", () => {
  it("[CAN-02] Gmail, Outlook e IMAP/SMTP están registrados; los de demo y lo simulado van por DemoAdapter", () => {
    expect(getChannelAdapter({ type: "email_gmail", isDemo: false })).toBe(gmailAdapter);
    expect(getChannelAdapter({ type: "email_outlook", isDemo: false })).toBe(outlookAdapter);
    expect(getChannelAdapter({ type: "email_imap", isDemo: false })).toBe(imapAdapter);
    expect(getChannelAdapter({ type: "email_gmail", isDemo: true })).toBe(demoAdapter);
    expect(getSendAdapter({ type: "email_imap", isDemo: false }, true)).toBe(demoAdapter);
  });

  it("[CAN-14] el correo admite borradores, HTML y archivos; ni plantillas ni ventana de 24 h", () => {
    for (const adapter of [gmailAdapter, outlookAdapter, imapAdapter]) {
      expect(adapter.capabilities(channel)).toMatchObject({ drafts: true, html: true, images: true, documents: true, audio: true, templates: false, window24h: false, typing: false, readReceipts: false });
    }
  });

  it("el correo no recibe avisos (se lee por sondeo) ni descarga adjuntos después", async () => {
    await expect(gmailAdapter.handleWebhook(channel, { body: {} })).resolves.toEqual([]);
    await expect(imapAdapter.downloadMedia(channel, { externalMediaId: "x" })).rejects.toThrow(/ya están guardados/);
  });
});
