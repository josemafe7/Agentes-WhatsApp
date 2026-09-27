// Team roles and invitations ([PER-*], [USU-*]). Roles live here, never in fields the user can edit.
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { INVITABLE_ROLES, ROLES } from "@/lib/enums";
import { user } from "./auth";
import { bool, EMPTY_JSON_ARRAY, EMPTY_JSON_OBJECT, id, json, timestamp, timestamps } from "./columns";

/** Per event: where the user wants to hear about it ([USU-18], [AJU-08]). Missing keys use the defaults. */
export type NotificationPreferences = Record<string, { inApp?: boolean; push?: boolean; email?: boolean }>;

export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id),
    role: text("role", { enum: ROLES }).notNull(),
    /** Set when the user is deactivated: no access from the next request ([USU-14]). */
    disabledAt: timestamp("disabled_at"),
    /** Demo test users, removable with «Borrar usuarios de prueba» ([ARR-20]). */
    isDemo: bool("is_demo").notNull().default(false),
    notificationPreferences: json<NotificationPreferences>("notification_preferences")
      .notNull()
      .default(EMPTY_JSON_OBJECT),
    ...timestamps(),
  },
  (t) => [index("user_roles_role_idx").on(t.role)],
).enableRLS();

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    /** Lower-case email of the invitee. */
    email: text("email").notNull(),
    role: text("role", { enum: INVITABLE_ROLES }).notNull(),
    /** Channels for the Agent role; empty = all channels ([PER-02]). */
    channelIds: json<string[]>("channel_ids").notNull().default(EMPTY_JSON_ARRAY),
    /** SHA-256 of the one-time link token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    /** Copy of the inviter's name, kept if that user is deleted. */
    invitedByName: text("invited_by_name"),
    acceptedAt: timestamp("accepted_at"),
    acceptedUserId: text("accepted_user_id").references(() => user.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at"),
    lastSentAt: timestamp("last_sent_at"),
    sendCount: integer("send_count").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    // One pending invitation per email: creating a new one revokes the previous one in the same transaction.
    uniqueIndex("invitations_pending_email_uq")
      .on(t.email)
      .where(sql`accepted_at IS NULL AND revoked_at IS NULL`),
  ],
).enableRLS();
