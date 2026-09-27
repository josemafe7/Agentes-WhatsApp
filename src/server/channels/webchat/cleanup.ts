// Files a visitor uploaded but never sent in a message ([WEB-07], [WEB-09], [SEG-13]). An upload only gives a receipt
// that lasts an hour (tokens.ts), so each upload schedules this job for after it expires: unless a message uses the
// file by then, the file is deleted. Registered with the jobs in src/server/jobs/handlers/index.ts.
import "server-only";
import { like } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getFileStorage, isValidFileKey, type FileStorage } from "@/server/adapters/file-storage";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { registerJobHandler } from "@/server/jobs/registry";
import { UPLOAD_RECEIPT_TTL_MS } from "./tokens";

export const WIDGET_UPLOAD_CLEANUP_JOB = "webchat.upload_cleanup";
/** Key prefix of the files visitors send: webchat/<yyyy>/<mm>/<uuid>.<ext>. */
export const WIDGET_UPLOAD_PREFIX = "webchat";
/** After the receipt expires, a margin for a message sent in its last seconds. */
export const UPLOAD_CLEANUP_DELAY_MS = UPLOAD_RECEIPT_TTL_MS + 15 * 60_000;

const cleanupPayload = z.object({
  fileKey: z
    .string()
    .max(300)
    .refine((key) => isValidFileKey(key) && key.startsWith(`${WIDGET_UPLOAD_PREFIX}/`), "Clave de archivo no válida."),
});

/** Schedules the check of one uploaded file for after its receipt has expired. */
export async function scheduleUploadCleanup(fileKey: string, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  await (options.queue ?? getJobQueue()).enqueue({
    type: WIDGET_UPLOAD_CLEANUP_JOB,
    payload: { fileKey },
    runAt: new Date(now.getTime() + UPLOAD_CLEANUP_DELAY_MS),
    maxAttempts: 3,
  });
}

/** Whether some message has this file (LIKE only narrows the search; the key must be exactly the message's file). */
async function isInAMessage(fileKey: string): Promise<boolean> {
  const rows = await db
    .select({ media: messages.media })
    .from(messages)
    .where(like(messages.media, `%${JSON.stringify(fileKey)}%`));
  return rows.some((row) => row.media?.fileKey === fileKey);
}

/** The job: deletes the file unless a message uses it. Running it twice changes nothing. */
export async function cleanUpWidgetUpload(fileKey: string, storage: FileStorage = getFileStorage()): Promise<"kept" | "deleted"> {
  if (await isInAMessage(fileKey)) return "kept";
  await storage.delete(fileKey);
  return "deleted";
}

registerJobHandler(
  WIDGET_UPLOAD_CLEANUP_JOB,
  async ({ fileKey }) => {
    await cleanUpWidgetUpload(fileKey);
  },
  { payload: cleanupPayload },
);
