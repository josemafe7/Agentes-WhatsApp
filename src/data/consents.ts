// Consentimientos de un contacto ([CUM-13], [CTO-08]): «Quitar la baja» when the customer asks for it, by the roles of
// «Contactos: fusionar duplicados y quitar una baja» (owner, admin and supervisor, [PER-03]). It is recorded as an
// «alta» in that channel with who, when and why, after the baja it lifts, and in the activity log without personal
// data. Opting out happens when the customer writes «BAJA» or «STOP» (src/server/compliance/opt-out.ts).
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, consents, contacts } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { latestOptChoice } from "@/server/compliance/opt-out";
import { ConflictError, NotFoundError, parseInput } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

const MAX_NOTE = 300;

export const liftOptOutSchema = z
  .object({
    contactId: idSchema,
    channelId: idSchema,
    /** How the customer asked for it (by phone, at the counter…). */
    note: z.string().trim().max(MAX_NOTE, `Como mucho ${MAX_NOTE} caracteres.`).optional(),
  })
  .strict();

/** Lifts the contact's opt-out of a channel: from then on the business may write there again. */
export async function liftOptOut(actor: Actor, input: unknown): Promise<{ consentId: string }> {
  assertCan(actor, PERMISSIONS.contacts.merge);
  const data = parseInput(liftOptOutSchema, input);
  const now = new Date();
  return db.transaction(async (tx) => {
    const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, data.contactId));
    if (!contact) throw new NotFoundError("No se ha encontrado el contacto.");
    const latest = await latestOptChoice(contact.id, data.channelId, tx);
    if (latest?.type !== "opt_out") throw new ConflictError("Este cliente no está dado de baja en ese canal.");
    const [channel] = await tx.select({ type: channels.type }).from(channels).where(eq(channels.id, data.channelId));
    // Always after the baja it lifts, so it is the newest choice even if the baja's time is ahead of this clock.
    const at = new Date(Math.max(now.getTime(), latest.createdAt.getTime() + 1));
    const [row] = await tx
      .insert(consents)
      .values({
        contactId: contact.id,
        channelId: data.channelId,
        channelType: channel?.type ?? null,
        type: "opt_in",
        source: "person",
        recordedByUserId: actor.userId,
        recordedByName: actor.name,
        note: data.note || null,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: consents.id });
    await writeAudit({ actor, action: "consent.opt_out_lifted", targetType: "contact", targetId: contact.id, metadata: { channelId: data.channelId } }, tx);
    return { consentId: row.id };
  });
}
