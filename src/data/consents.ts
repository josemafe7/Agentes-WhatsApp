// Consentimientos de un contacto ([CUM-13], [CTO-08]–[CTO-10]). Its two permissions, «Avisos de sus citas» and
// «Novedades y publicidad», are marked or withdrawn by «Contactos: marcar permisos y dar de baja» (owner, admin,
// supervisor, and an agent on the contacts of their channels), saying how the customer gave them. A baja the customer
// asks for by another way (by phone, at the counter) is recorded by the same people, for one kind of channel or for
// all, of everything or of novedades y publicidad only. Lifting a baja is for «fusionar duplicados y quitar una baja»
// (owner, admin and supervisor), only when the customer asks. Every change is a new record with who, when and how,
// and a line in the activity log without personal data. «BAJA» or «STOP» opts out on its own
// (src/server/compliance/opt-out.ts).
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, contacts } from "@/db/schema";
import { CHANNEL_KIND_LABELS, hasPermission, optOutTypes, OPT_OUT_KINDS, permissionTypes, type ConsentState, type OptOutScope } from "@/lib/consents";
import { CHANNEL_KINDS, CONSENT_METHODS, CONTACT_PERMISSIONS, type ChannelKind, type ConsentMethod, type ContactPermission } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { instantToLocal, isLocalDate } from "@/server/booking/time";
import { isEmailChannelType } from "@/server/channels/email/config";
import { replyRecipientContactId } from "@/server/channels/email/reply-context";
import { appendConsent, loadConsentState, loadConsentStates } from "@/server/compliance/consent-state";
import { isOptedOut } from "@/server/compliance/opt-out";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { contactDisplayName, contactListWhere, loadContactFor } from "./contacts";
import { loadConversationFor } from "./conversation-scope";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

const MAX_NOTE = 300;
const noteSchema = z.string().trim().max(MAX_NOTE, `Como mucho ${MAX_NOTE} caracteres.`).optional();
const scopeSchema = z.enum(["all", "marketing"]);

/** A date the customer gave it on (yyyy-mm-dd), never in the future; kept at midday UTC, so it reads the same day. */
const givenOnSchema = z.string().refine(isLocalDate, "Pon una fecha válida.").optional();

/** «Cuándo lo dio» can be today in the business's time zone, never later (not the UTC day: at 01:00 in Madrid it is still yesterday there). */
async function assertGivenOnNotFuture(givenOn: string | undefined): Promise<void> {
  if (!givenOn) return;
  const { timezone } = await loadBusinessSettings();
  if (givenOn > instantToLocal(new Date(), timezone).date) throw new ValidationError(undefined, { givenOn: ["La fecha no puede ser futura."] });
}

export function givenAtOf(date: string | undefined): Date | null {
  return date ? new Date(`${date}T12:00:00.000Z`) : null;
}

export const contactPermissionSchema = z
  .object({
    contactId: idSchema,
    permission: z.enum(CONTACT_PERMISSIONS),
    granted: z.boolean(),
    method: z.enum(CONSENT_METHODS, "Di cómo lo dio el cliente."),
    givenOn: givenOnSchema,
    note: noteSchema,
  })
  .strict();

/** Marks or withdraws one of the contact's permissions ([CTO-09]). Marking does not lift a baja. */
export async function setContactPermission(actor: Actor, input: unknown): Promise<{ consentId: string }> {
  const data = parseInput(contactPermissionSchema, input);
  const contact = await loadContactFor(actor, PERMISSIONS.contacts.consents, data.contactId);
  await assertGivenOnNotFuture(data.givenOn);
  return recordPermission(actor, contact.id, data);
}

export const conversationPermissionSchema = z
  .object({
    conversationId: idSchema,
    permission: z.enum(CONTACT_PERMISSIONS),
    method: z.enum(CONSENT_METHODS, "Di cómo lo dio el cliente."),
    note: noteSchema,
  })
  .strict();

/**
 * From the inbox, before sending a template ([WA-61]): records the permission of the conversation's customer, saying
 * how they gave it. For whoever may mark permissions in that channel.
 */
export async function setConversationContactPermission(actor: Actor, input: unknown): Promise<{ consentId: string }> {
  const data = parseInput(conversationPermissionSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.contacts.consents, data.conversationId);
  if (!conversation.contactId) throw new ConflictError("Esta conversación no tiene contacto.");
  return recordPermission(actor, conversation.contactId, { ...data, granted: true, givenOn: undefined });
}

async function recordPermission(
  actor: Actor,
  contactId: string,
  data: { permission: ContactPermission; granted: boolean; method: ConsentMethod; givenOn?: string; note?: string },
): Promise<{ consentId: string }> {
  const contact = { id: contactId };
  const types = permissionTypes(data.permission);
  return db.transaction(async (tx) => {
    const row = await appendConsent(
      tx,
      {
        contactId: contact.id,
        type: data.granted ? types.granted : types.withdrawn,
        source: "person",
        method: data.method,
        givenAt: data.granted ? givenAtOf(data.givenOn) : null,
        actorType: "user",
        recordedByUserId: actor.userId,
        recordedByName: actor.name,
        note: data.note || null,
      },
      new Date(),
    );
    await writeAudit(
      {
        actor,
        action: "consent.permission_changed",
        targetType: "contact",
        targetId: contact.id,
        metadata: { permission: data.permission, granted: data.granted, how: data.method },
      },
      tx,
    );
    return { consentId: row.id };
  });
}

const MAX_BULK = 500;

export const bulkPermissionSchema = z
  .object({
    ids: z.array(idSchema).min(1, "Elige al menos un contacto.").max(MAX_BULK, `Como mucho ${MAX_BULK} contactos a la vez.`),
    permission: z.enum(CONTACT_PERMISSIONS),
    method: z.enum(CONSENT_METHODS, "Di cómo lo dieron."),
    givenOn: givenOnSchema,
    note: noteSchema,
    confirmed: z.literal(true, "Confirma que lo han dado."),
  })
  .strict();

export type BulkPermissionResult = { marked: number; already: number; skipped: { id: string; displayName: string; reason: string }[] };

/**
 * Marks a permission on several contacts at once, saying how they gave it ([CTO-09]): only on the contacts the person
 * sees (an Agent, those of their channels), skipping and listing whoever has a baja in force ([CTO-10]); whoever has it
 * already is left as is. One line in the activity log, with counts only.
 */
export async function markPermissionForContacts(actor: Actor, input: unknown): Promise<BulkPermissionResult> {
  assertCan(actor, PERMISSIONS.contacts.consents);
  const data = parseInput(bulkPermissionSchema, input);
  await assertGivenOnNotFuture(data.givenOn);
  const visible = contactListWhere(actor, {});
  if (!visible) return { marked: 0, already: 0, skipped: [] };
  const rows = await db
    .select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone })
    .from(contacts)
    .where(and(inArray(contacts.id, data.ids), visible.where));
  const states = await loadConsentStates(rows.map((row) => row.id));
  const skipped: BulkPermissionResult["skipped"] = [];
  const toMark: string[] = [];
  let already = 0;
  for (const row of rows) {
    const state = states.get(row.id);
    if (!state) continue;
    const optOuts = activeOptOutKinds(state);
    if (optOuts.length) skipped.push({ id: row.id, displayName: contactDisplayName(row), reason: `Dado de baja en ${optOuts.join(", ")}` });
    else if (hasPermission(state, data.permission)) already += 1;
    else toMark.push(row.id);
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const contactId of toMark) {
      await appendConsent(
        tx,
        {
          contactId,
          type: permissionTypes(data.permission).granted,
          source: "bulk",
          method: data.method,
          givenAt: givenAtOf(data.givenOn),
          actorType: "user",
          recordedByUserId: actor.userId,
          recordedByName: actor.name,
          note: data.note || null,
        },
        now,
      );
    }
    await writeAudit(
      {
        actor,
        action: "consents.permissions_marked",
        targetType: "contact",
        metadata: { permission: data.permission, how: data.method, marked: toMark.length, already, skipped: skipped.length },
      },
      tx,
    );
  });
  return { marked: toMark.length, already, skipped };
}

function activeOptOutKinds(state: ConsentState): string[] {
  return (Object.entries(state.optOuts) as [ChannelKind, ConsentState["optOuts"][ChannelKind]][])
    .filter(([, scopes]) => scopes.all || scopes.marketing)
    .map(([kind]) => CHANNEL_KIND_LABELS[kind]);
}

export const optOutRequestSchema = z
  .object({
    contactId: idSchema,
    /** One kind of channel, or «all» of them. */
    kind: z.enum([...CHANNEL_KINDS, "all"]),
    scope: scopeSchema,
    method: z.enum(CONSENT_METHODS, "Di cómo lo pidió el cliente."),
    note: noteSchema,
  })
  .strict();

/**
 * Records a baja the customer asked for by another way ([CTO-10]): of everything or of novedades y publicidad, on one
 * kind of channel or on all. The kinds where it is already in force are left as they are; no message is sent.
 */
export async function recordOptOutByRequest(actor: Actor, input: unknown): Promise<{ kinds: ChannelKind[] }> {
  const data = parseInput(optOutRequestSchema, input);
  const contact = await loadContactFor(actor, PERMISSIONS.contacts.consents, data.contactId);
  const wanted = data.kind === "all" ? OPT_OUT_KINDS : [data.kind];
  return db.transaction(async (tx) => {
    const state = await loadConsentState(contact.id, tx);
    const kinds = wanted.filter((kind) => !state.optOuts[kind].all && !(data.scope === "marketing" && state.optOuts[kind].marketing));
    const now = new Date();
    for (const kind of kinds) {
      await appendConsent(
        tx,
        {
          contactId: contact.id,
          channelKind: kind,
          type: optOutTypes(data.scope).out,
          source: "person",
          method: data.method,
          actorType: "user",
          recordedByUserId: actor.userId,
          recordedByName: actor.name,
          note: data.note || null,
        },
        now,
      );
    }
    if (kinds.length) {
      await writeAudit(
        { actor, action: "consent.opted_out", targetType: "contact", targetId: contact.id, metadata: { channelKinds: kinds, scope: data.scope, source: "person" } },
        tx,
      );
    }
    return { kinds };
  });
}

export const liftOptOutSchema = z
  .object({
    contactId: idSchema,
    kind: z.enum(CHANNEL_KINDS),
    scope: scopeSchema,
    /** How the customer asked for it ([CUM-13]): the screen always asks. */
    method: z.enum(CONSENT_METHODS).optional(),
    /** In their words, or what they said (by phone, at the counter…). */
    note: noteSchema,
  })
  .strict();

/** Lifts the contact's baja of that kind and scope, when the customer asks for it ([CTO-08]). */
export async function liftOptOut(actor: Actor, input: unknown): Promise<{ consentId: string }> {
  assertCan(actor, PERMISSIONS.contacts.merge);
  const data = parseInput(liftOptOutSchema, input);
  return db.transaction(async (tx) => {
    const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, data.contactId));
    if (!contact) throw new NotFoundError("No se ha encontrado el contacto.");
    const state = await loadConsentState(contact.id, tx);
    const scope: OptOutScope = data.scope;
    if (!state.optOuts[data.kind][scope]) throw new ConflictError("Este cliente no está dado de baja en ese canal.");
    const row = await appendConsent(
      tx,
      {
        contactId: contact.id,
        channelKind: data.kind,
        type: optOutTypes(scope).back,
        source: "person",
        method: data.method ?? null,
        actorType: "user",
        recordedByUserId: actor.userId,
        recordedByName: actor.name,
        note: data.note || null,
      },
      new Date(),
    );
    await writeAudit(
      { actor, action: "consent.opt_out_lifted", targetType: "contact", targetId: contact.id, metadata: { channelKind: data.kind, scope } },
      tx,
    );
    return { consentId: row.id };
  });
}

/**
 * Whether the customer a reply of this conversation reaches opted out of its kind of channel ([CUM-03]): in email, the
 * sender of the newest email of the thread. For the warning over the composer; whoever sees the conversation may know.
 */
export async function isConversationOptedOut(actor: Actor, conversationId: unknown): Promise<boolean> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, conversationId);
  const [channel] = await db.select({ type: channels.type }).from(channels).where(eq(channels.id, conversation.channelId));
  const contactId = channel && isEmailChannelType(channel.type) ? await replyRecipientContactId(conversation.id, channel.type, conversation.contactId) : conversation.contactId;
  return isOptedOut(contactId, conversation.channelId);
}
