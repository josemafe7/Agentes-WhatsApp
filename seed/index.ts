// Loads the demo of a sector ([ARR-06], [ARR-10]) into the database of DATABASE_URL, all or nothing: every step
// writes inside one transaction, which first checks again that the installation may receive the demo.
import "server-only";
import { db } from "@/db";
import type { Sector } from "@/lib/enums";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { DEFAULT_SECTOR, getSectorPreset } from "@/lib/sectors";
import { clearAllData } from "@/server/demo/clear-data";
import {
  DEMO_MARKER_KEY,
  FRESH_MARKER_KEY,
  getInstallState,
  type DemoMarker,
  type InstallState,
} from "@/server/demo/install-state";
import { deleteKv, setKv } from "@/server/kv";
import { DEMO_BUSINESSES } from "./businesses";
import { SEED_STEPS } from "./steps";
import type { DemoUserSummary, SeedContext, SeedWrites } from "./types";
import { DEMO_PASSWORD, DEMO_USERS } from "./users";

export { DEMO_PASSWORD, DEMO_USERS } from "./users";

/** The demo cannot go into this installation; nothing was written. */
export class DemoRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoRefusedError";
  }
}

export type LoadDemoOptions = {
  sector?: Sector;
  /** Replace a demo that is already loaded (`pnpm seed`; setup never does). Real data is never replaced. */
  replaceDemo?: boolean;
  now?: Date;
};

export type LoadDemoResult = {
  sector: Sector;
  businessName: string;
  password: string;
  users: readonly DemoUserSummary[];
  replaced: boolean;
};

function refusalFor(state: InstallState, replaceDemo: boolean): string | null {
  if (state.kind === "real") {
    return "Esta base de datos tiene los datos de un negocio real (no es la demo): la demo no se carga y no se ha tocado nada.";
  }
  if (state.kind === "demo" && !replaceDemo) {
    const which = state.sector ? ` (${getSectorPreset(state.sector).label})` : "";
    return `Ya hay una demo cargada${which}. Para sustituirla usa pnpm seed --sector=… o pnpm db:reset.`;
  }
  return null;
}

export async function loadDemo(options: LoadDemoOptions = {}): Promise<LoadDemoResult> {
  const sector = options.sector ?? DEFAULT_SECTOR;
  const replaceDemo = options.replaceDemo ?? false;
  const now = options.now ?? new Date();
  const context: SeedContext = {
    sector,
    preset: getSectorPreset(sector),
    business: DEMO_BUSINESSES[sector],
    now,
    timeZone: DEFAULT_TIMEZONE,
    refs: { userIds: new Map(), serviceIds: new Map(), resourceIds: new Map() },
  };

  // Early answer before the slow preparation; the transaction checks again.
  const early = refusalFor(await getInstallState(), replaceDemo);
  if (early) throw new DemoRefusedError(early);

  const writes: SeedWrites[] = [];
  for (const step of SEED_STEPS) writes.push(await step.prepare(context));

  let replaced = false;
  await db.transaction(async (tx) => {
    const state = await getInstallState(tx);
    const refusal = refusalFor(state, replaceDemo);
    if (refusal) throw new DemoRefusedError(refusal);
    if (state.kind === "demo") {
      await clearAllData(tx);
      replaced = true;
    }
    for (const write of writes) await write(tx);
    const marker: DemoMarker = { sector, loadedAt: now.toISOString() };
    await setKv(DEMO_MARKER_KEY, marker, { executor: tx });
    await deleteKv(FRESH_MARKER_KEY, tx);
  });

  return { sector, businessName: context.business.name, password: DEMO_PASSWORD, users: DEMO_USERS, replaced };
}
