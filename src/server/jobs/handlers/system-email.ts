// Job "system_email.send": emails that must not be sent inside a request, such as password resets (sending
// inline would reveal by timing whether an email has an account, [USU-10]).
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEmailBrand } from "@/data/business";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { passwordResetEmail } from "@/server/email-templates";
import { sendSystemEmail } from "@/server/mailer";
import { PermanentJobError, registerJobHandler } from "../registry";

export const SYSTEM_EMAIL_JOB = "system_email.send";

export const systemEmailJobPayload = z.discriminatedUnion("template", [
  z.object({
    template: z.literal("password_reset"),
    to: z.email(),
    name: z.string().max(200).nullable(),
    /** The one-time link; null once the job is over: a finished job never keeps it ([USU-10], [SEG-02]). */
    url: z.url({ protocol: /^https?$/ }).nullable(),
  }),
]);
export type SystemEmailJobPayload = z.infer<typeof systemEmailJobPayload>;

/** Drops the link from the stored payload once it has been sent, or will never be (whoever needs it asks again). */
async function forgetLink(jobId: string, payload: SystemEmailJobPayload): Promise<void> {
  await db.update(jobs).set({ payload: { ...payload, url: null } }).where(eq(jobs.id, jobId));
}

registerJobHandler(
  SYSTEM_EMAIL_JOB,
  async (payload, { job }) => {
    // Already sent (or given up): the link is gone, nothing to send again.
    if (payload.url === null) return;
    const content = passwordResetEmail({ brand: await getEmailBrand(), name: payload.name, link: payload.url });
    const result = await sendSystemEmail({ kind: "password_reset", to: payload.to, ...content });
    if (result.ok) {
      await forgetLink(job.id, payload);
      return;
    }
    // Without system mail, retrying will not help until someone configures it.
    const lastTry = result.reason === "not_configured" || job.attempts >= job.maxAttempts;
    if (lastTry) await forgetLink(job.id, payload);
    if (result.reason === "not_configured") throw new PermanentJobError(result.message);
    throw new Error(result.message);
  },
  { payload: systemEmailJobPayload },
);
