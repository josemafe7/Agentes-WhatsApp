// Contactos, basic part ([CTO-01]–[CTO-03], [CTO-08]): list with search and filters, the contact's card (data,
// identities by channel, labels, custom fields, consents and conversation history), and creating and editing by
// hand. The phone and the email are data, never keys ([CAN-13]). An Agent only sees the contacts with a conversation
// in their channels, and only those conversations ([PER-02]). Merging is in contacts-merge.ts, exporting in
// contacts-export.ts and erasing in contacts-erase.ts.
import "server-only";
import { and, asc, count, eq, exists, inArray, isNotNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations } from "@/db/schema";
import { consentStateOf, type ConsentRecord, type ConsentState } from "@/lib/consents";
import { CHANNEL_KIND_OF, CHANNEL_TYPES, type ChannelType, type ConversationStatus } from "@/lib/enums";
import { channelFilter, PERMISSIONS, type Action, type Actor } from "@/lib/permissions";
import { emailSchema, idSchema, labelSchema, MAX_LABELS, optionalText } from "@/lib/validation";
import { loadConsentRows, type ConsentRow } from "@/server/compliance/consent-state";
import { AuthError, parseInput, ValidationError } from "@/server/errors";
import { ascNullsFirst, descNullsLast, jsonTextContains } from "@/server/sql-helpers";
import { writeAudit } from "./audit";
import { contactSearchCondition, contactSearchText } from "./contacts-search";
import { assertCan } from "./guard";

export const CONTACTS_PAGE_SIZE = 25;
export const MAX_CUSTOM_FIELDS = 30;

export const contactFiltersSchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    label: labelSchema.optional(),
    channelType: z.enum(CHANNEL_TYPES).optional(),
    channelId: idSchema.optional(),
    page: z.number().int().min(1).default(1),
  })
  .strict();

export type ContactListItem = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  labels: string[];
  /** Channel types where it has an identity (icons in the list). */
  channelTypes: ChannelType[];
  lastConversationAt: Date | null;
};

const NO_NAME = "Sin nombre";

/**
 * How a contact is called on screen: its name, else its email or its phone; never blank (web visitors often have
 * none). Also what a person types to confirm erasing it (contacts-erase.ts).
 */
export function contactDisplayName(contact: { name: string | null; email: string | null; phone: string | null }): string {
  return contact.name?.trim() || contact.email || contact.phone || NO_NAME;
}

/** The conversations an actor may see of a contact: all, or those of an Agent's channels. */
function conversationScope(actor: Actor): SQL[] | null {
  const scoped = channelFilter(actor);
  if (scoped && scoped.length === 0) return null;
  return [eq(conversations.isTest, false), isNotNull(conversations.channelId), ...(scoped ? [inArray(conversations.channelId, [...scoped])] : [])];
}

const visibleThrough = (scope: SQL[]) =>
  exists(db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.contactId, contacts.id), ...scope)));

export type ContactListFilters = Omit<z.output<typeof contactFiltersSchema>, "page">;

/**
 * The contacts `actor` may see that match the filters, as a where clause for any query on `contacts`, or null when
 * none can match ([CTO-01], [PER-02]). Shared by the list and its CSV export (contacts-export.ts). The caller checks
 * the permission first.
 */
export function contactListWhere(actor: Actor, filters: ContactListFilters): { where: SQL | undefined } | null {
  const scope = conversationScope(actor);
  const scoped = channelFilter(actor);
  // An agent filtering by a channel that is not theirs sees nothing (and learns nothing about it).
  if (!scope || (filters.channelId && scoped && !scoped.includes(filters.channelId))) return null;
  const conditions: SQL[] = [];
  if (scoped) conditions.push(visibleThrough(scope));
  // Without accents or case: «jose» finds «José» (contacts-search.ts).
  if (filters.search) conditions.push(contactSearchCondition(filters.search));
  conditions.push(...labelAndChannel(filters));
  if (filters.channelType) {
    conditions.push(
      exists(
        db
          .select({ id: contactIdentities.id })
          .from(contactIdentities)
          .where(and(eq(contactIdentities.contactId, contacts.id), eq(contactIdentities.channelType, filters.channelType))),
      ),
    );
  }
  return { where: conditions.length > 0 ? and(...conditions) : undefined };
}

/** A label (exactly that one) and a channel the contact wrote by. */
function labelAndChannel(filters: { label?: string | null; channelId?: string | null }): SQL[] {
  const conditions: SQL[] = [];
  // Labels are a JSON array of strings: the label in quotes inside it is exactly that label.
  if (filters.label) conditions.push(jsonTextContains(contacts.labels, JSON.stringify(filters.label)));
  if (filters.channelId) {
    conditions.push(
      exists(db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.contactId, contacts.id), eq(conversations.channelId, filters.channelId)))),
    );
  }
  return conditions;
}

/**
 * Contactos' filter by label and channel for the system, without anyone's scope: the contacts of a repeated envío at
 * its time ([ENV-16]). Without label nor channel, every contact.
 */
export function contactFilterWhere(filters: { label: string | null; channelId: string | null }): SQL | undefined {
  const conditions = labelAndChannel(filters);
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Contactos: one page with search by name, phone or email and filters by label and channel ([CTO-01]). */
export async function listContacts(actor: Actor, input: unknown = {}): Promise<{ items: ContactListItem[]; total: number; page: number; pageCount: number }> {
  assertCan(actor, PERMISSIONS.contacts.view);
  const { page: requestedPage, ...filters } = parseInput(contactFiltersSchema, input);
  const visible = contactListWhere(actor, filters);
  const scope = conversationScope(actor);
  if (!visible || !scope) return { items: [], total: 0, page: 1, pageCount: 1 };
  const { where } = visible;
  const [{ total }] = await db.select({ total: count() }).from(contacts).where(where);
  const pageCount = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const rows = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, labels: contacts.labels })
    .from(contacts)
    .where(where)
    .orderBy(ascNullsFirst(contacts.name), asc(contacts.id))
    .limit(CONTACTS_PAGE_SIZE)
    .offset((page - 1) * CONTACTS_PAGE_SIZE);
  return { items: await withListDetails(rows, scope), total, page, pageCount };
}

/** Ids per query when looking up the details of many contacts at once (the CSV export). */
const IDS_PER_QUERY = 500;

/** The channel types and the last visible conversation of each contact, as the list shows them ([CTO-01]). */
async function withListDetails<T extends { id: string }>(rows: T[], scope: SQL[]): Promise<(T & Pick<ContactListItem, "channelTypes" | "lastConversationAt">)[]> {
  const identities: { contactId: string; channelType: ChannelType }[] = [];
  const lastConversations: { contactId: string | null; lastMessageAt: Date | null }[] = [];
  for (let start = 0; start < rows.length; start += IDS_PER_QUERY) {
    const ids = rows.slice(start, start + IDS_PER_QUERY).map((row) => row.id);
    const [identityRows, conversationRows] = await Promise.all([
      db.select({ contactId: contactIdentities.contactId, channelType: contactIdentities.channelType }).from(contactIdentities).where(inArray(contactIdentities.contactId, ids)),
      db
        .select({ contactId: conversations.contactId, lastMessageAt: conversations.lastMessageAt })
        .from(conversations)
        .where(and(inArray(conversations.contactId, ids), ...scope))
        .orderBy(descNullsLast(conversations.lastMessageAt)),
    ]);
    identities.push(...identityRows);
    lastConversations.push(...conversationRows);
  }
  return rows.map((row) => ({
    ...row,
    channelTypes: [...new Set(identities.filter((identity) => identity.contactId === row.id).map((identity) => identity.channelType))],
    lastConversationAt: lastConversations.find((conversation) => conversation.contactId === row.id)?.lastMessageAt ?? null,
  }));
}

export type ContactExportRow = ContactListItem & { customFields: Record<string, string>; notes: string | null; createdAt: Date };

/**
 * Every contact `actor` may see that matches the filters (or, with `ids`, those of them), without pages, for the CSV
 * export (contacts-export.ts, which checks the export permission first).
 */
export async function listContactsForExport(actor: Actor, filters: ContactListFilters, ids?: readonly string[]): Promise<ContactExportRow[]> {
  const visible = contactListWhere(actor, filters);
  const scope = conversationScope(actor);
  if (!visible || !scope) return [];
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      labels: contacts.labels,
      customFields: contacts.customFields,
      notes: contacts.notes,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .where(and(visible.where, ...(ids ? [inArray(contacts.id, [...ids])] : [])))
    .orderBy(ascNullsFirst(contacts.name), asc(contacts.id));
  return withListDetails(rows, scope);
}

/** Labels in use on the contacts the actor may see, for the label filter and suggestions ([CTO-01], [PER-02]). */
export async function listContactLabels(actor: Actor): Promise<string[]> {
  assertCan(actor, PERMISSIONS.contacts.view);
  const scope = conversationScope(actor);
  if (!scope) return [];
  const rows = await db
    .select({ labels: contacts.labels })
    .from(contacts)
    .where(channelFilter(actor) ? visibleThrough(scope) : undefined);
  return [...new Set(rows.flatMap((row) => row.labels))].sort((a, b) => a.localeCompare(b, "es"));
}

export type ContactDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  labels: string[];
  customFields: Record<string, string>;
  notes: string | null;
  identities: { id: string; channelType: ChannelType; externalId: string; phone: string | null; displayName: string | null }[];
  /** Newest first. */
  consents: (ConsentRecord & { channelName: string | null })[];
  /** Its permissions and the bajas in force ([CTO-09]). */
  consentState: ConsentState;
  conversations: { id: string; channel: { id: string; name: string; type: ChannelType }; status: ConversationStatus; lastMessageAt: Date | null }[];
  createdAt: Date;
};

async function contactChannelIds(contactId: string): Promise<string[]> {
  const rows = await db
    .select({ channelId: conversations.channelId })
    .from(conversations)
    .where(and(eq(conversations.contactId, contactId), eq(conversations.isTest, false), isNotNull(conversations.channelId)));
  return [...new Set(rows.map((row) => row.channelId).filter((id): id is string => id !== null))];
}

/** The contact, if the person may do `action` on it: an Agent only through a conversation in their channels ([PER-02]). */
export async function loadContactFor(actor: Actor, action: Action, contactId: unknown) {
  assertCan(actor, action);
  const id = idSchema.safeParse(contactId);
  if (!id.success) throw new AuthError("forbidden");
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id.data));
  if (!row) throw new AuthError("forbidden");
  if (channelFilter(actor)) assertCan(actor, action, { channelIds: await contactChannelIds(row.id) });
  return row;
}

/** The contact's card ([CTO-02]). Appointments are added by the agenda phase. */
export async function getContact(actor: Actor, contactId: string): Promise<ContactDetail> {
  const contact = await loadContactFor(actor, PERMISSIONS.contacts.view, contactId);
  const scope = conversationScope(actor) ?? [];
  // An Agent limited to some channels sees only what belongs to them: identities of their channels' types and, of the
  // consents, the permissions (which are for the contact) and the bajas of their channels' kinds ([PER-02]).
  const scopedChannels = channelFilter(actor);
  const scopedTypes = scopedChannels
    ? [...new Set((await db.select({ type: channels.type }).from(channels).where(inArray(channels.id, [...scopedChannels]))).map((row) => row.type))]
    : null;
  const [identities, consentRows, conversationRows] = await Promise.all([
    db
      .select({ id: contactIdentities.id, channelType: contactIdentities.channelType, externalId: contactIdentities.externalId, phone: contactIdentities.phone, displayName: contactIdentities.displayName })
      .from(contactIdentities)
      .where(and(eq(contactIdentities.contactId, contact.id), ...(scopedTypes ? [inArray(contactIdentities.channelType, scopedTypes)] : [])))
      .orderBy(asc(contactIdentities.createdAt)),
    loadConsentRows([contact.id]),
    db
      .select({ id: conversations.id, channelId: channels.id, channelName: channels.name, channelType: channels.type, status: conversations.status, lastMessageAt: conversations.lastMessageAt })
      .from(conversations)
      .innerJoin(channels, eq(channels.id, conversations.channelId))
      .where(and(eq(conversations.contactId, contact.id), ...scope))
      .orderBy(descNullsLast(conversations.lastMessageAt)),
  ]);
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    labels: contact.labels,
    customFields: contact.customFields,
    notes: contact.notes,
    identities,
    ...visibleConsents(consentRows, scopedTypes),
    conversations: conversationRows.map((row) => ({ id: row.id, channel: { id: row.channelId, name: row.channelName, type: row.channelType }, status: row.status, lastMessageAt: row.lastMessageAt })),
    createdAt: contact.createdAt,
  };
}

function consentRecordOf(row: ConsentRow): ConsentRecord {
  const { id, type, kind, createdAt, givenAt, method, source, recordedByName, note, evidence } = row;
  return { id, type, kind, createdAt, givenAt, method, source, recordedByName, note, evidence };
}

function visibleConsents(rows: ConsentRow[], scopedTypes: ChannelType[] | null): Pick<ContactDetail, "consents" | "consentState"> {
  const kinds = scopedTypes ? new Set(scopedTypes.map((type) => CHANNEL_KIND_OF[type])) : null;
  const visible = kinds ? rows.filter((row) => row.kind === null || kinds.has(row.kind)) : rows;
  // The two permissions are the contact's whatever channel they were recorded in ([CTO-09]): an Agent of other
  // channels sees them as they are, without what was said in a conversation they cannot open.
  const { permissions } = consentStateOf(rows);
  const shown = (record: ConsentRecord | null) => (record && kinds && record.kind && !kinds.has(record.kind) ? { ...record, evidence: null } : record);
  return {
    consents: visible
      .map((row) => ({ ...consentRecordOf(row), channelName: row.channelName }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    consentState: { permissions: { reminders: shown(permissions.reminders), marketing: shown(permissions.marketing) }, optOuts: consentStateOf(visible).optOuts },
  };
}

const phoneSchema = z
  .string()
  .trim()
  .max(32, "Como mucho 32 caracteres.")
  .regex(/^[+\d][\d\s().-]*$/, "Escribe un teléfono válido.")
  .nullable()
  .optional();

export const contactInputSchema = z
  .object({
    name: optionalText(100),
    phone: z.union([z.literal("").transform(() => null), phoneSchema]),
    email: z.union([z.literal("").transform(() => null), emailSchema.nullable().optional()]),
    notes: optionalText(4_000),
    labels: z.array(labelSchema).max(MAX_LABELS, `Como mucho ${MAX_LABELS} etiquetas.`).optional(),
    customFields: z
      .record(z.string().trim().min(1).max(40, "El nombre del campo es demasiado largo."), z.string().trim().max(500, "Como mucho 500 caracteres."))
      .refine((value) => Object.keys(value).length <= MAX_CUSTOM_FIELDS, `Como mucho ${MAX_CUSTOM_FIELDS} campos.`)
      .optional(),
  })
  .strict();
export type ContactInput = z.input<typeof contactInputSchema>;

function contactValues(data: z.output<typeof contactInputSchema>) {
  return {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.phone !== undefined ? { phone: data.phone } : {}),
    ...(data.email !== undefined ? { email: data.email } : {}),
    ...(data.notes !== undefined ? { notes: data.notes } : {}),
    ...(data.labels !== undefined ? { labels: [...new Set(data.labels)] } : {}),
    ...(data.customFields !== undefined ? { customFields: data.customFields } : {}),
  };
}

/** A contact created by hand ([CTO-01]): at least a name, a phone or an email. */
export async function createContact(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.contacts.edit);
  // An Agent limited to some channels only reaches contacts with a conversation in them ([PER-02]); a contact made
  // by hand has none yet, so they could never see it again. The screen hides «Nuevo contacto» for them too.
  if (channelFilter(actor) !== null) throw new AuthError("forbidden");
  const data = parseInput(contactInputSchema, input);
  if (!data.name && !data.phone && !data.email) throw new ValidationError(undefined, { name: ["Escribe al menos el nombre, el teléfono o el email."] });
  const values = contactValues(data);
  const [row] = await db
    .insert(contacts)
    .values({ ...values, searchText: contactSearchText(values) })
    .returning({ id: contacts.id });
  await writeAudit({ actor, action: "contact.created", targetType: "contact", targetId: row.id });
  return row;
}

/** Edits data, labels and custom fields ([CTO-01], [CTO-02]); only the fields sent change. */
export async function updateContact(actor: Actor, contactId: string, input: unknown): Promise<void> {
  const contact = await loadContactFor(actor, PERMISSIONS.contacts.edit, contactId);
  const data = parseInput(contactInputSchema, input);
  const values = contactValues(data);
  if (Object.keys(values).length === 0) return;
  await db
    .update(contacts)
    .set({ ...values, searchText: contactSearchText({ ...contact, ...values }), updatedAt: new Date() })
    .where(eq(contacts.id, contact.id));
  await writeAudit({ actor, action: "contact.updated", targetType: "contact", targetId: contact.id, metadata: { fields: Object.keys(values) } });
}
