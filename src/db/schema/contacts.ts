// Customers, their per-channel identities and consents ([CTO-*], [CUM-03], [CUM-13]).
// The phone is data, never a key: identities are unique by channel type + external id ([CAN-13]).
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { BOOKING_ACTOR_TYPES, CHANNEL_KINDS, CHANNEL_TYPES, CONSENT_METHODS, CONSENT_TYPES } from "@/lib/enums";
import { user } from "./auth";
import { channels } from "./channels";
import { bool, EMPTY_JSON_ARRAY, EMPTY_ORDERED_JSON_OBJECT, id, json, orderedJson, timestamp, timestamps } from "./columns";

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
    /** Created by the demo: never gets anything through a channel that is not a demo one ([ENV-14]). */
    isDemo: bool("is_demo").notNull().default(false),
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
    /**
     * Since when it waits for a person to confirm it: made by the app, not by the contact writing first (a first
     * WhatsApp to the phone of the contact, [WA-63]; an answer to a reminder of the system mail, [AGD-24]). Null: confirmed.
     */
    unconfirmedSince: timestamp("unconfirmed_since"),
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
    /**
     * The kind a baja or its lifting applies to ([CTO-09]); null on the permissions, which are for the contact, and on
     * rows written before phase 12, whose kind comes from channel_type.
     */
    channelKind: text("channel_kind", { enum: CHANNEL_KINDS }),
    /** Where it came from: keyword («BAJA»), widget, person, ai, template_button, whatsapp_app… */
    source: text("source").notNull(),
    /** How the customer gave it or asked for it ([CTO-09]). */
    method: text("method", { enum: CONSENT_METHODS }),
    /** When the customer gave it, if not when it was recorded (a permission given earlier, in person). */
    givenAt: timestamp("given_at"),
    /** The question and the answer when the AI recorded it in the conversation ([HER-15]). */
    evidence: json<{ question: string; answer: string }>("evidence"),
    actorType: text("actor_type", { enum: BOOKING_ACTOR_TYPES }),
    recordedByUserId: text("recorded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    recordedByName: text("recorded_by_name"),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [index("consents_contact_channel_idx").on(t.contactId, t.channelId)],
).enableRLS();
