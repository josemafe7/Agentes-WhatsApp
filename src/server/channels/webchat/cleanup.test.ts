// Files a visitor uploaded and never sent are deleted once their receipt expires ([WEB-07], [WEB-09], [SEG-13]).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { DiskStorage, type FileStorage } from "@/server/adapters/file-storage";
import { getJobRegistration } from "@/server/jobs/registry";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import type { ChannelRecord } from "../types";
import { cleanUpWidgetUpload, UPLOAD_CLEANUP_DELAY_MS, WIDGET_UPLOAD_CLEANUP_JOB } from "./cleanup";
import { UPLOAD_RECEIPT_TTL_MS } from "./tokens";
import { storeWidgetUpload } from "./upload";

const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

let storageDir: string;
let storage: FileStorage;
let channel: ChannelRecord;
const visitor = () => ({ channelId: channel.id, visitorId: crypto.randomUUID() });

beforeAll(async () => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-widget-cleanup-"));
  storage = new DiskStorage(storageDir);
  await createBusiness();
  channel = await createChannel({ type: "webchat", name: "Web", config: { allowedDomains: [], imagesEnabled: true } });
});

afterAll(() => fs.rmSync(storageDir, { recursive: true, force: true }));

beforeEach(async () => {
  await db.delete(jobs);
});

afterEach(() => vi.useRealTimers());

/** The key of a file a visitor uploaded (from the stored cleanup job). */
async function upload(now = new Date()): Promise<{ fileKey: string; runAt: Date }> {
  await storeWidgetUpload(channel, visitor(), PNG, { storage, now });
  const [job] = await db.select().from(jobs).where(eq(jobs.type, WIDGET_UPLOAD_CLEANUP_JOB));
  return { fileKey: (job.payload as { fileKey: string }).fileKey, runAt: job.runAt };
}

describe("orphan uploads of the web chat [WEB-07] [SEG-13]", () => {
  it("each upload schedules its check for after the receipt has expired", async () => {
    const now = new Date("2026-09-27T10:00:00Z");
    const { fileKey, runAt } = await upload(now);
    expect(fileKey).toMatch(/^webchat\//);
    expect(await storage.exists(fileKey)).toBe(true);
    expect(UPLOAD_CLEANUP_DELAY_MS).toBeGreaterThan(UPLOAD_RECEIPT_TTL_MS);
    expect(runAt.getTime()).toBe(now.getTime() + UPLOAD_CLEANUP_DELAY_MS);
  });

  it("a file never sent in a message is deleted; running the job again changes nothing", async () => {
    const { fileKey } = await upload();
    expect(await cleanUpWidgetUpload(fileKey, storage)).toBe("deleted");
    expect(await storage.exists(fileKey)).toBe(false);
    expect(await cleanUpWidgetUpload(fileKey, storage)).toBe("deleted");
  });

  it("a file a message uses stays", async () => {
    const { fileKey } = await upload();
    const { contact } = await createContactWithIdentity("webchat");
    const conversation = await createConversation(channel.id, contact.id);
    await createMessage(conversation, { contentType: "image", media: { fileKey, mimeType: "image/png", size: PNG.byteLength, downloadStatus: "done" } });
    expect(await cleanUpWidgetUpload(fileKey, storage)).toBe("kept");
    expect(await storage.exists(fileKey)).toBe(true);
  });

  it("is a registered job that only accepts web chat upload keys", async () => {
    await import("@/server/jobs/handlers");
    const registration = getJobRegistration(WIDGET_UPLOAD_CLEANUP_JOB);
    expect(registration).toBeDefined();
    expect(registration?.payload?.safeParse({ fileKey: "webchat/2026/09/0f0f0f0f-aaaa-4bbb-8ccc-123456789abc.png" }).success).toBe(true);
    for (const fileKey of ["media/2026/09/0f0f0f0f-aaaa-4bbb-8ccc-123456789abc.png", "logos/x.png", "webchat/../../data/local.db", ""]) {
      expect(registration?.payload?.safeParse({ fileKey }).success, fileKey).toBe(false);
    }
  });
});
