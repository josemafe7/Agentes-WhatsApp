// Customers, their per-channel identities and consents ([CTO-*], [CUM-03], [CUM-13]).
// The phone is data, never a key: identities are unique by channel type + external id ([CAN-13]).
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { CHANNEL_TYPES, CONSENT_TYPES } from "@/lib/enums";
import { user } from "./auth";
import { channels } from "./channels";
import { EMPTY_JSON_ARRAY, EMPTY_ORDERED_JSON_OBJECT, id, json, orderedJson, timestamps } from "./columns";

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    labels: json<string[]>("labels").notNull().default(EMPTY_JSON_ARRAY),
    /** Shown in the order they were written: json, not jsonb. */
    customFields: orderedJson<Record<string, string>>("custom_fields").notNull().default(EMPTY_ORDERED_JSON_OBJECT),
    notes: text("notes"),
    /**
     * Name, phone and email in lower case and without accents, for the searches of Contactos and the Bandeja («jose»
     * finds «José», [CTO-01], [BAN-02]). Written with every change of those fields (src/data/contacts-search.ts);
     * null until then. A copy of personal data: whoever clears those fields clears it too.
     */
    searchText: text("search_text"),
    ...timestamps(),
  },
  (t) => [
    // Duplicate hints only ([CTO-04]), never identity.
    index("contacts_email_idx").on(t.email),
    index("contacts_phone_idx").on(t.phone),
  ],
).enableRLS();

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    channelType: text("channel_type", { enum: CHANNEL_TYPES }).notNull(),
    /** WhatsApp BSUID (or wa_id as provisional id), email address, web visitor id or Telegram id. */
    externalId: text("external_id").notNull(),
    /** Digits only; optional, as WhatsApp may not share it ([WA-39]). */
    phone: text("phone"),
    /** Name shown by the channel (WhatsApp profile name, email display name). */
    displayName: text("display_name"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("contact_identities_channel_type_external_id_uq").on(t.channelType, t.externalId),
    index("contact_identities_contact_id_idx").on(t.contactId),
    index("contact_identities_phone_idx").on(t.phone),
  ],
).enableRLS();

export const consents = pgTable(
  "consents",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
    channelType: text("channel_type", { enum: CHANNEL_TYPES }),
    type: text("type", { enum: CONSENT_TYPES }).notNull(),
    /** Where it came from: keyword («BAJA»), widget, person, import… */
    source: text("source").notNull(),
    recordedByUserId: text("recorded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    recordedByName: text("recorded_by_name"),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [index("consents_contact_channel_idx").on(t.contactId, t.channelId)],
).enableRLS();
