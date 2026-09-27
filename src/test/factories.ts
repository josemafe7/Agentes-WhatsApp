// Test data builders. Each test file has its own empty database (src/test/setup.ts): create only what you need.
import { eq } from "drizzle-orm";
import { ensureSettingsRows, loadBusinessSettings, type BusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { agents, businessSettings, channels, contactIdentities, contacts, conversations, messages, userRoles } from "@/db/schema";
import type { ChannelType, Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { createUserWithPassword } from "@/server/accounts";
import { messageSearchText } from "@/server/inbound/message-search";

export const TEST_PASSWORD = "contraseña-de-prueba-123";

let sequence = 0;
const nextNumber = () => ++sequence;

/** An actor without database rows, for pure permission checks. */
export function actorFor(role: Role, overrides: Partial<Actor> = {}): Actor {
  return { userId: crypto.randomUUID(), role, name: `Usuario ${role}`, channelIds: null, ...overrides };
}

export type TestUser = { userId: string; email: string; password: string; name: string; actor: Actor };

/** A real user (Better Auth tables + role) able to sign in with TEST_PASSWORD. */
export async function createUser(
  role: Role = "agent",
  options: { name?: string; email?: string; password?: string; channelIds?: string[]; isDemo?: boolean; disabled?: boolean } = {},
): Promise<TestUser> {
  const n = nextNumber();
  const name = options.name ?? `Usuario ${role} ${n}`;
  const email = options.email ?? `${role}-${n}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = options.password ?? TEST_PASSWORD;
  const channelIds = options.channelIds ?? [];
  const { userId, email: stored } = await createUserWithPassword({ name, email, password, role, channelIds, isDemo: options.isDemo });
  if (options.disabled) await db.update(userRoles).set({ disabledAt: new Date() }).where(eq(userRoles.userId, userId));
  const actor: Actor = { userId, role, name, channelIds: role === "agent" && channelIds.length > 0 ? channelIds : null };
  return { userId, email: stored, password, name, actor };
}

/** Settings rows with a named business (setup finished) plus overrides. */
export async function createBusiness(overrides: Partial<typeof businessSettings.$inferInsert> = {}): Promise<BusinessSettings> {
  await ensureSettingsRows();
  const current = await loadBusinessSettings();
  const [row] = await db
    .update(businessSettings)
    .set({ name: "Peluquería Prueba", sector: "peluqueria", setupCompletedAt: new Date(), ...overrides })
    .where(eq(businessSettings.id, current.id))
    .returning();
  return row;
}

export async function createChannel(overrides: Partial<typeof channels.$inferInsert> & { type?: ChannelType } = {}) {
  const [row] = await db
    .insert(channels)
    .values({ type: "webchat", name: `Canal ${nextNumber()}`, status: "connected", ...overrides })
    .returning();
  return row;
}

/** An agent row with a model and hand-off settings (no version history: enough for the reply engine). */
export async function createAgentRow(overrides: Partial<typeof agents.$inferInsert> = {}) {
  const [row] = await db
    .insert(agents)
    .values({
      name: `Agente ${nextNumber()}`,
      model: "openai/gpt-5.6-luna",
      fallbackModel: "google/gemini-3.1-flash-lite",
      instructions: { role: "Eres el asistente de la peluquería." },
      handoff: {},
      systemTools: ["transferir_a_humano"],
      ...overrides,
    })
    .returning();
  return row;
}

/** A contact with one identity in `channelType` (never keyed by phone). */
export async function createContactWithIdentity(channelType: ChannelType, overrides: { name?: string | null; externalId?: string; phone?: string | null; email?: string | null } = {}) {
  const [contact] = await db
    .insert(contacts)
    .values({ name: overrides.name === undefined ? `Cliente ${nextNumber()}` : overrides.name, phone: overrides.phone ?? null, email: overrides.email ?? null })
    .returning();
  const [identity] = await db
    .insert(contactIdentities)
    .values({ contactId: contact.id, channelType, externalId: overrides.externalId ?? crypto.randomUUID(), phone: overrides.phone ?? null })
    .returning();
  return { contact, identity };
}

/** A conversation of a channel with its contact, plus overrides. */
export async function createConversation(channelId: string, contactId: string | null, overrides: Partial<typeof conversations.$inferInsert> = {}) {
  const now = new Date();
  const [row] = await db
    .insert(conversations)
    .values({ channelId, contactId, lastMessageAt: now, lastInboundAt: now, ...overrides })
    .returning();
  return row;
}

/** A message in a conversation (inbound from the customer by default), with its search text as the app writes it. */
export async function createMessage(conversation: { id: string; channelId: string | null }, overrides: Partial<typeof messages.$inferInsert> = {}) {
  const text = overrides.text === undefined ? "Hola" : overrides.text;
  const [row] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      channelId: conversation.channelId,
      direction: "inbound",
      senderType: "contact",
      externalId: crypto.randomUUID(),
      text,
      searchText: messageSearchText(text),
      status: "received",
      ...overrides,
    })
    .returning();
  return row;
}
