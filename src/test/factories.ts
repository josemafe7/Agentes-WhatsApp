// Test data builders. Each test file has its own empty database (src/test/setup.ts): create only what you need.
import { eq } from "drizzle-orm";
import { ensureSettingsRows, loadBusinessSettings, type BusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { businessSettings, channels, userRoles } from "@/db/schema";
import type { ChannelType, Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { createUserWithPassword } from "@/server/accounts";

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
