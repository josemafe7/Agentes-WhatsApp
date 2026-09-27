// Models in use that announce a retirement date or left OpenRouter's list ([MOD-06], docs/integracion-openrouter.md
// §2.5): the warnings shown in the agent and in Ajustes › IA, and the notice «Modelo de IA que se retira» ([AJU-08]).
// After every download of the list, the models in use (principal and fallback of each agent, and the defaults of
// Ajustes › IA) are checked and the people of Ajustes › Notificaciones (owner and admins by default, each through the
// channels chosen in Mi cuenta) hear once about each flagged model. It warns again only when its state changes: another
// date, gone from the list, or flagged again after it stopped being flagged (or used).
import "server-only";
import { asc } from "drizzle-orm";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/format";
import { getKv, releaseLease, setKv, tryAcquireLease } from "@/server/kv";
import { notify } from "@/server/notifications/notify";
import type { ModelInfo } from "./models";
import { resolveDefaultModels } from "./openrouter";

/** The state each flagged model was last warned about: «expiring:2026-09-28» or «missing». */
export const MODEL_NOTICES_KV_KEY = "ai.model_notices";
const NOTICES_LEASE_KEY = "ai.model_notices.lease";
/** Two downloads at once never warn twice: only one check at a time (a dead process frees it after this). */
const NOTICES_LEASE_MS = 60_000;
/** The defaults checked, as Ajustes › IA does (the rerank model has its own warning there). */
const CHECKED_DEFAULTS = ["chat", "fallback", "transcription", "embeddings", "imageDescription"] as const;
const AI_SETTINGS_PATH = "/ajustes/ia";
const AGENTS_PATH = "/agentes";

const listFormat = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

/** «28 sep 2026» in the business time zone. */
export function formatExpiration(date: string, timeZone: string): string {
  return formatDateTime(`${date}T12:00:00Z`, timeZone, { preset: "date" });
}

export type ModelWarning = { modelId: string; kind: "expiring" | "missing"; expirationDate: string | null; message: string };

/** Models in use that announce a retirement date or left the list ([MOD-06]). Pure. */
export function modelWarnings(models: readonly ModelInfo[], inUse: readonly string[], timeZone: string = DEFAULT_TIMEZONE): ModelWarning[] {
  const warnings: ModelWarning[] = [];
  for (const id of new Set(inUse.filter(Boolean))) {
    const model = models.find((candidate) => candidate.id === id);
    if (!model) {
      warnings.push({ modelId: id, kind: "missing", expirationDate: null, message: `El modelo ${id} ya no aparece en la lista de OpenRouter. Elige otro.` });
    } else if (model.expirationDate) {
      warnings.push({
        modelId: id,
        kind: "expiring",
        expirationDate: model.expirationDate,
        message: `El modelo ${model.name} se retira a partir del ${formatExpiration(model.expirationDate, timeZone)}. Elige otro antes.`,
      });
    }
  }
  return warnings;
}

// ─── Notices to the team ────────────────────────────────────────────────────────────────────────────────

type ModelUse = { agents: { id: string; name: string }[]; inDefaults: boolean };
type NoticeState = Record<string, string>;

/** Where each model is used: principal or fallback of an agent, or a default of Ajustes › IA. */
async function modelsInUse(): Promise<Map<string, ModelUse>> {
  const uses = new Map<string, ModelUse>();
  const entryFor = (modelId: string): ModelUse => {
    const use = uses.get(modelId) ?? { agents: [], inDefaults: false };
    uses.set(modelId, use);
    return use;
  };
  const defaults = await resolveDefaultModels();
  for (const field of CHECKED_DEFAULTS) entryFor(defaults[field]).inDefaults = true;
  const rows = await db.select({ id: agents.id, name: agents.name, model: agents.model, fallbackModel: agents.fallbackModel }).from(agents).orderBy(asc(agents.name));
  for (const agent of rows) {
    for (const modelId of new Set([agent.model, agent.fallbackModel])) {
      if (modelId) entryFor(modelId).agents.push({ id: agent.id, name: agent.name });
    }
  }
  return uses;
}

const stateOf = (warning: ModelWarning): string => (warning.kind === "expiring" ? `expiring:${warning.expirationDate}` : "missing");

function sameState(stored: NoticeState | null, current: NoticeState): boolean {
  const before = stored ?? {};
  const keys = Object.keys(current);
  return keys.length === Object.keys(before).length && keys.every((modelId) => before[modelId] === current[modelId]);
}

/** «Se usa en el agente «Recepción» y los modelos por defecto de Ajustes › IA.» */
function usedIn(use: ModelUse): string {
  const places = use.agents.map((agent) => `el agente «${agent.name}»`);
  if (use.inDefaults) places.push("los modelos por defecto de Ajustes › IA");
  return `Se usa en ${listFormat.format(places)}.`;
}

/** Where to change it: Ajustes › IA for a default (it also lists the agents), else the agent's Modelo tab or the list. */
function linkFor(use: ModelUse): string {
  if (use.inDefaults) return AI_SETTINGS_PATH;
  const [only, ...others] = use.agents;
  return only && others.length === 0 ? `${AGENTS_PATH}/${only.id}/modelo` : AGENTS_PATH;
}

function titleFor(warning: ModelWarning, models: readonly ModelInfo[]): string {
  if (warning.kind === "missing") return `Modelo que ya no está en OpenRouter: ${warning.modelId}`;
  const name = models.find((model) => model.id === warning.modelId)?.name ?? warning.modelId;
  return `Modelo que se retira: ${name}`;
}

/**
 * System: after a download of the list, tells the team once about each model in use that announces a retirement date
 * or left the list ([MOD-06], [AJU-08]). Who hears it and how is Ajustes › Notificaciones and each person's choice.
 */
export async function warnAboutModelsInUse(models: readonly ModelInfo[]): Promise<void> {
  const [uses, { timezone }] = await Promise.all([modelsInUse(), loadBusinessSettings()]);
  const warnings = modelWarnings(models, [...uses.keys()], timezone);
  const current: NoticeState = Object.fromEntries(warnings.map((warning) => [warning.modelId, stateOf(warning)]));
  if (sameState(await getKv<NoticeState>(MODEL_NOTICES_KV_KEY), current)) return;
  const holder = crypto.randomUUID();
  // Another check is telling the same news right now.
  if (!(await tryAcquireLease(NOTICES_LEASE_KEY, holder, NOTICES_LEASE_MS))) return;
  try {
    const warned = (await getKv<NoticeState>(MODEL_NOTICES_KV_KEY)) ?? {};
    for (const warning of warnings) {
      const use = uses.get(warning.modelId);
      if (!use || warned[warning.modelId] === current[warning.modelId]) continue;
      await notify({ event: "model_deprecated", title: titleFor(warning, models), body: `${warning.message} ${usedIn(use)}`, link: linkFor(use) });
    }
    // A model no longer flagged is forgotten: flagged again later, it is news again.
    await setKv(MODEL_NOTICES_KV_KEY, current);
  } finally {
    await releaseLease(NOTICES_LEASE_KEY, holder);
  }
}
