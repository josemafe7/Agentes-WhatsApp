// Contract of a demo seed step. Each step prepares its slow or non-database work first (password hashes,
// fixtures) and returns the writes, which all run in one transaction, in the order of seed/steps/index.ts.
import type { Transaction } from "@/db";
import type { Role, Sector } from "@/lib/enums";
import type { SectorPreset } from "@/lib/sectors";
import type { DemoBusiness } from "./businesses";

/** Database ids created by earlier steps, for the steps that link to them. Later phases add their own maps. */
export type SeedRefs = {
  /** By email. */
  userIds: Map<string, string>;
  /** By preset key. */
  serviceIds: Map<string, string>;
  resourceIds: Map<string, string>;
  /** By demo agent key (recepcion, correo, fuera-de-horario); set by the agents step. */
  agentIds?: Map<string, string>;
};

export type SeedContext = {
  sector: Sector;
  preset: SectorPreset;
  business: DemoBusiness;
  /** «Today» for dates relative to the day the demo is loaded ([ARR-07]). */
  now: Date;
  timeZone: string;
  refs: SeedRefs;
};

export type SeedWrites = (tx: Transaction) => Promise<void>;

export type SeedStep = {
  name: string;
  /** Runs before the transaction and returns what to write inside it. */
  prepare: (ctx: SeedContext) => Promise<SeedWrites>;
};

export type DemoUserSummary = { name: string; email: string; role: Role };
