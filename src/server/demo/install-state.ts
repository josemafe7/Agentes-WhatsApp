// What the installation holds: nothing yet, the demo, or a real business. The seed and the setup read it to
// load the demo only where it belongs and never over real data ([ARR-18], [ARR-19]).
import "server-only";
import { count } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { businessSettings, user } from "@/db/schema";
import { SECTORS, type Sector } from "@/lib/enums";
import { getKv } from "@/server/kv";

/** Written by the seed in the same transaction as the demo data. */
export const DEMO_MARKER_KEY = "demo.installation";
/** Written by `pnpm db:fresh`: the owner chose an empty installation, so setup must not load the demo in it. */
export const FRESH_MARKER_KEY = "install.fresh";

const demoMarkerSchema = z.object({ sector: z.enum(SECTORS), loadedAt: z.string() });
export type DemoMarker = z.infer<typeof demoMarkerSchema>;

export type InstallState =
  /** No users and no business data. `fresh`: emptied on purpose with `pnpm db:fresh`. */
  | { kind: "empty"; fresh: boolean }
  /** Loaded by the seed; `sector` is null if the marker cannot be read. */
  | { kind: "demo"; sector: Sector | null; loadedAt: string | null }
  /** Anything else: a business that is being set up or already works. Never touched by the seed. */
  | { kind: "real" };

export async function getInstallState(executor: Executor = db): Promise<InstallState> {
  const marker = await getKv<unknown>(DEMO_MARKER_KEY, executor);
  if (marker !== null) {
    const parsed = demoMarkerSchema.safeParse(marker);
    return parsed.success
      ? { kind: "demo", sector: parsed.data.sector, loadedAt: parsed.data.loadedAt }
      : { kind: "demo", sector: null, loadedAt: null };
  }
  const [{ users }] = await executor.select({ users: count() }).from(user);
  const [settings] = await executor
    .select({ name: businessSettings.name, setupCompletedAt: businessSettings.setupCompletedAt })
    .from(businessSettings)
    .limit(1);
  const hasBusiness = settings !== undefined && (settings.name.trim() !== "" || settings.setupCompletedAt !== null);
  if (users > 0 || hasBusiness) return { kind: "real" };
  return { kind: "empty", fresh: (await getKv<unknown>(FRESH_MARKER_KEY, executor)) === true };
}
