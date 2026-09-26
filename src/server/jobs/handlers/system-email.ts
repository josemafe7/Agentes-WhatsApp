// Job "system_email.send": emails that must not be sent inside a request, such as password resets (sending
// inline would reveal by timing whether an email has an account, [USU-10]).
import "server-only";
import { z } from "zod";
import { getEmailBrand } from "@/data/business";
import { passwordResetEmail } from "@/server/email-templates";
import { sendSystemEmail } from "@/server/mailer";
import { PermanentJobError, registerJobHandler } from "../registry";

export const SYSTEM_EMAIL_JOB = "system_email.send";

export const systemEmailJobPayload = z.discriminatedUnion("template", [
  z.object({
    template: z.literal("password_reset"),
    to: z.email(),
    name: z.string().max(200).nullable(),
    url: z.url({ protocol: /^https?$/ }),
  }),
]);
export type SystemEmailJobPayload = z.infer<typeof systemEmailJobPayload>;

registerJobHandler(
  SYSTEM_EMAIL_JOB,
  async (payload) => {
    const content = passwordResetEmail({ brand: await getEmailBrand(), name: payload.name, link: payload.url });
    const result = await sendSystemEmail({ kind: "password_reset", to: payload.to, ...content });
    if (result.ok) return;
    // Without system mail, retrying will not help until someone configures it.
    if (result.reason === "not_configured") throw new PermanentJobError(result.message);
    throw new Error(result.message);
  },
  { payload: systemEmailJobPayload },
);
