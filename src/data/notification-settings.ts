// Notifications: which events notify and which roles by default (Ajustes › Notificaciones, [AJU-08]), and how
// each person wants to hear about them: in the app, push, email ([USU-18], [PWA-07]). The sending itself comes
// with the notification engine; it reads these settings with resolveNotificationSettings/-Preferences.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { userRoles, type NotificationPreferences, type NotificationSettings } from "@/db/schema";
import { ROLES, type Role } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { AuthError, parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { loadBusinessSettings, updateBusinessSettings } from "./settings";

export const NOTIFICATION_EVENTS = [
  "handoff",
  "new_conversation",
  "conversation_assigned",
  "channel_error",
  "whatsapp_quality",
  "model_deprecated",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** roles = the roles chosen in Ajustes; assignee = only the person the conversation is assigned to. */
export type NotificationAudience = "roles" | "assignee";

export type EventSetting = { enabled: boolean; roles: Role[] };
export type ChannelPreference = { inApp: boolean; push: boolean; email: boolean };

type EventDefinition = { audience: NotificationAudience; defaults: EventSetting; channels: ChannelPreference };

const TEAM: Role[] = ["owner", "admin", "supervisor", "agent"];
const MANAGERS: Role[] = ["owner", "admin"];

/** Defaults: hand-offs reach the whole team (agents only for their channels, [PWA-08]); system problems, managers. */
export const NOTIFICATION_EVENT_DEFINITIONS: Record<NotificationEvent, EventDefinition> = {
  handoff: { audience: "roles", defaults: { enabled: true, roles: TEAM }, channels: { inApp: true, push: true, email: true } },
  new_conversation: {
    audience: "roles",
    defaults: { enabled: false, roles: TEAM },
    channels: { inApp: true, push: true, email: false },
  },
  conversation_assigned: {
    audience: "assignee",
    defaults: { enabled: true, roles: [] },
    channels: { inApp: true, push: true, email: false },
  },
  channel_error: { audience: "roles", defaults: { enabled: true, roles: MANAGERS }, channels: { inApp: true, push: true, email: true } },
  whatsapp_quality: {
    audience: "roles",
    defaults: { enabled: true, roles: MANAGERS },
    channels: { inApp: true, push: true, email: true },
  },
  model_deprecated: {
    audience: "roles",
    defaults: { enabled: true, roles: MANAGERS },
    channels: { inApp: true, push: false, email: true },
  },
};

function isEvent(key: string): key is NotificationEvent {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(key);
}

/** The effective settings of every event: what is stored, or the default. Unknown stored keys are ignored. */
export function resolveNotificationSettings(stored: NotificationSettings): Record<NotificationEvent, EventSetting> {
  const result = {} as Record<NotificationEvent, EventSetting>;
  for (const event of NOTIFICATION_EVENTS) {
    const saved = stored[event];
    const defaults = NOTIFICATION_EVENT_DEFINITIONS[event].defaults;
    result[event] = saved
      ? { enabled: saved.enabled, roles: saved.roles.filter((role): role is Role => (ROLES as readonly string[]).includes(role)) }
      : { enabled: defaults.enabled, roles: [...defaults.roles] };
  }
  return result;
}

/** A person's effective channels per event: what they chose, or the event's default. */
export function resolveNotificationPreferences(stored: NotificationPreferences): Record<NotificationEvent, ChannelPreference> {
  const result = {} as Record<NotificationEvent, ChannelPreference>;
  for (const event of NOTIFICATION_EVENTS) {
    result[event] = { ...NOTIFICATION_EVENT_DEFINITIONS[event].channels, ...stored[event] };
  }
  return result;
}

// ─── Business level (owner and admin) ────────────────────────────────────────────────────────────────────

const eventSettingSchema = z.object({
  enabled: z.boolean(),
  roles: z.array(z.enum(ROLES, { error: "Rol no válido." })).max(ROLES.length),
});

const notificationSettingsInputSchema = z
  .object({ events: z.partialRecord(z.enum(NOTIFICATION_EVENTS, { error: "Aviso no válido." }), eventSettingSchema) })
  .strict();

export async function getNotificationSettings(actor: Actor): Promise<Record<NotificationEvent, EventSetting>> {
  assertCan(actor, PERMISSIONS.settings.business);
  const { notificationSettings } = await loadBusinessSettings();
  return resolveNotificationSettings(notificationSettings);
}

/** Saves which events notify and to which roles. An enabled role-based event needs at least one role. */
export async function updateNotificationSettings(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.business);
  const { events } = parseInput(notificationSettingsInputSchema, input);
  const errors: Record<string, string[]> = {};
  const next: NotificationSettings = { ...(await loadBusinessSettings()).notificationSettings };
  for (const [event, setting] of Object.entries(events)) {
    if (!isEvent(event) || !setting) continue;
    const { audience } = NOTIFICATION_EVENT_DEFINITIONS[event];
    const roles = audience === "assignee" ? [] : [...new Set(setting.roles)];
    if (audience === "roles" && setting.enabled && roles.length === 0) {
      errors[event] = ["Elige al menos un rol o desactiva este aviso."];
    }
    next[event] = { enabled: setting.enabled, roles };
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(undefined, errors);
  // Keys that are not events (from older versions) are dropped when saving.
  for (const key of Object.keys(next)) if (!isEvent(key)) delete next[key];
  await updateBusinessSettings(actor, { notificationSettings: next });
}

// ─── Per person (any signed-in role, only their own) ─────────────────────────────────────────────────────

const channelPreferenceSchema = z.object({ inApp: z.boolean(), push: z.boolean(), email: z.boolean() }).partial().strict();

const myPreferencesInputSchema = z.partialRecord(z.enum(NOTIFICATION_EVENTS, { error: "Aviso no válido." }), channelPreferenceSchema);

export type MyNotificationEvent = { key: NotificationEvent; audience: NotificationAudience; enabled: boolean; reachesMe: boolean };

async function loadOwnPreferences(actor: Actor): Promise<NotificationPreferences> {
  const [row] = await db
    .select({ preferences: userRoles.notificationPreferences })
    .from(userRoles)
    .where(eq(userRoles.userId, actor.userId));
  if (!row) throw new AuthError("unauthenticated");
  return row.preferences;
}

/** The signed-in person's channels per event, and which events the business sends to their role. */
export async function getMyNotificationPreferences(actor: Actor) {
  assertCan(actor, PERMISSIONS.account.self);
  const stored = await loadOwnPreferences(actor);
  const settings = resolveNotificationSettings((await loadBusinessSettings()).notificationSettings);
  const events: MyNotificationEvent[] = NOTIFICATION_EVENTS.map((key) => {
    const { audience } = NOTIFICATION_EVENT_DEFINITIONS[key];
    const { enabled, roles } = settings[key];
    return { key, audience, enabled, reachesMe: enabled && (audience === "assignee" || roles.includes(actor.role)) };
  });
  return { preferences: resolveNotificationPreferences(stored), events };
}

/** Saves the signed-in person's own channels per event; nobody changes someone else's. */
export async function updateMyNotificationPreferences(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.account.self);
  const changes = parseInput(myPreferencesInputSchema, input);
  const stored = await loadOwnPreferences(actor);
  const next: NotificationPreferences = { ...stored };
  for (const [event, preference] of Object.entries(changes)) {
    if (preference) next[event] = { ...next[event], ...preference };
  }
  await db.update(userRoles).set({ notificationPreferences: next, updatedAt: new Date() }).where(eq(userRoles.userId, actor.userId));
  await writeAudit({
    actor,
    action: "account.notification_preferences_updated",
    targetType: "user",
    targetId: actor.userId,
    metadata: { events: Object.keys(changes) },
  });
}
