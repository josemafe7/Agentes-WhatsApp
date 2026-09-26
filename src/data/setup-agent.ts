// Step 5 of the setup wizard, «Primer agente» ([ASI-08], [ASI-11]): the first agent from the sector template kept by
// step 2, with its name, tone and instructions editable, or with a draft that the AI writes from the business website
// or a description (only with an OpenRouter key; nothing is saved until «Crear agente»). Only the owner continues the
// wizard. The agent's id stays in the setup progress (app_kv), so step 6 (web chat) activates it and going back to
// this step edits that agent instead of creating another one. The FAQs the draft proposes wait there too, for the
// knowledge base (phase 4), like the sector FAQs that step 2 keeps.
import "server-only";
import { z } from "zod";
import { db } from "@/db";
import type { AgentInstructions } from "@/db/schema";
import { agentCreateSchema } from "@/lib/agent-input";
import type { Sector } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { faqSchema, getSectorPreset, type AgentTemplate, type Faq } from "@/lib/sectors";
import { generateAgentDraft, MAX_DRAFT_FAQS, type AgentDraftInstructions } from "@/server/ai/draft";
import { enforceAiRateLimit } from "@/server/ai/limits";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { getKv, setKv } from "@/server/kv";
import { createAgentFromTemplate, getAgent, updateAgent, type Agent } from "./agents";
import { isAiConfigured, loadBusinessSettings } from "./settings";
import { assertSetupOwner, completeStep, getSetupSectorTemplate, openStep, SETUP_STEP } from "./setup";

/** app_kv key of what step 5 saved; step 6 (web chat) reads the agent with getSetupFirstAgent. */
export const SETUP_FIRST_AGENT_KEY = "setup.first_agent";
type FirstAgentProgress = {
  agentId: string;
  /** FAQs proposed by «Generar desde la web» and kept by the owner, for the knowledge base. */
  faqs: Faq[];
};

const FALLBACK_SECTOR: Sector = "otro";
export const NO_KEY_FOR_DRAFT_MESSAGE =
  "Para generarlo desde tu web hace falta la clave de OpenRouter (paso 4). Mientras tanto, seguimos con la plantilla de tu sector.";

/** What this step can set: the rest of the agent (models, hand-off, tools…) comes from the template and Settings › IA. */
export const agentStepSchema = agentCreateSchema.pick({ name: true, tone: true, instructions: true }).extend({
  faqs: z.array(faqSchema, { error: "Preguntas frecuentes no válidas." }).max(MAX_DRAFT_FAQS, `Como mucho ${MAX_DRAFT_FAQS} preguntas.`).optional(),
});
export type AgentStepInput = z.input<typeof agentStepSchema>;

/** Errors keyed by their full path ("instructions.role"), like the agent editor, so each shows next to its field. */
function parseStepInput(input: unknown): z.output<typeof agentStepSchema> {
  const result = agentStepSchema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError(undefined, fieldErrors);
}

/** The sector whose template this step uses: the one step 2 loaded, else the business sector, else «Otro». */
async function stepSector(actor: Actor): Promise<Sector> {
  const loaded = await getSetupSectorTemplate(actor);
  if (loaded) return loaded.sector;
  const settings = await loadBusinessSettings();
  return settings.sector ?? FALLBACK_SECTOR;
}

async function loadProgress(): Promise<FirstAgentProgress | null> {
  const saved = await getKv<Partial<FirstAgentProgress>>(SETUP_FIRST_AGENT_KEY);
  return saved?.agentId ? { agentId: saved.agentId, faqs: saved.faqs ?? [] } : null;
}

/** The agent this step already created, if it still exists (it may have been deleted from Agentes). */
async function firstAgent(actor: Actor, progress: FirstAgentProgress | null): Promise<Agent | null> {
  if (!progress) return null;
  try {
    return await getAgent(actor, progress.agentId);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

function cleanInstructions(value: Record<string, string | null | undefined>): AgentInstructions {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
}

function sameInstructions(a: AgentInstructions, b: AgentInstructions): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof AgentInstructions>;
  return [...keys].every((key) => (a[key] ?? "") === (b[key] ?? ""));
}

// ─── Read ───────────────────────────────────────────────────────────────────────────────────────────────

export type AgentStepData = {
  sector: Sector;
  sectorLabel: string;
  template: Pick<AgentTemplate, "name" | "description" | "tone">;
  /** What the form starts with: what this step already saved, or the template. */
  values: { name: string; tone: string; instructions: AgentInstructions; faqs: Faq[] };
  /** Set when the owner comes back to this step: saving edits that agent. */
  agentId: string | null;
  /** «Generar desde la web del negocio» needs an OpenRouter key ([ARR-14]). */
  aiConfigured: boolean;
  /** The business website, if known, to start the address field with. */
  website: string | null;
};

/** Step 5 form. Owner only ([ASI-11]). */
export async function getSetupAgentStepData(actor: Actor): Promise<AgentStepData> {
  assertSetupOwner(actor);
  const sector = await stepSector(actor);
  const preset = getSectorPreset(sector);
  const template = preset.agentTemplate;
  const progress = await loadProgress();
  const [existing, aiConfigured, settings] = await Promise.all([firstAgent(actor, progress), isAiConfigured(), loadBusinessSettings()]);
  return {
    sector,
    sectorLabel: preset.label,
    template: { name: template.name, description: template.description, tone: template.tone },
    values: existing
      ? { name: existing.name, tone: existing.tone ?? "", instructions: existing.instructions, faqs: progress?.faqs ?? [] }
      : { name: template.name, tone: template.tone, instructions: { ...template.instructions }, faqs: [] },
    agentId: existing?.id ?? null,
    aiConfigured,
    website: settings.website,
  };
}

/** For step 6 (web chat): the agent created in step 5, or null if it was skipped or deleted. Owner only. */
export async function getSetupFirstAgent(actor: Actor): Promise<{ id: string; name: string } | null> {
  assertSetupOwner(actor);
  const agent = await firstAgent(actor, await loadProgress());
  return agent ? { id: agent.id, name: agent.name } : null;
}

// ─── Save ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «Crear agente y continuar» ([ASI-08]): creates the first agent from the sector template with the values of the form
 * (name, tone and, if sent, instructions), or edits it if this step already created it (a new version only when
 * something changed). Keeps its id (and the kept FAQs of a draft) in the setup progress and marks the step done.
 */
export async function saveSetupAgentStep(actor: Actor, input: unknown): Promise<{ agentId: string; created: boolean }> {
  assertSetupOwner(actor);
  const { faqs, ...parsed } = parseStepInput(input);
  // A field sent as undefined must not hide the template's value when spread over it.
  const fields = Object.fromEntries(Object.entries(parsed).filter((entry) => entry[1] !== undefined)) as typeof parsed;
  await openStep(db, SETUP_STEP.agent);

  const progress = await loadProgress();
  const existing = await firstAgent(actor, progress);
  let agentId: string;
  if (existing) {
    // Only what was sent counts (a missing field keeps its value): going back and forth adds no empty versions.
    const changed =
      existing.name !== fields.name ||
      (fields.tone !== undefined && (existing.tone ?? null) !== (fields.tone ?? null)) ||
      (fields.instructions !== undefined && !sameInstructions(existing.instructions, cleanInstructions(fields.instructions)));
    if (changed) await updateAgent(actor, existing.id, fields);
    agentId = existing.id;
  } else {
    // The agents layer validates again, fills models (Settings › IA), hand-off rules and tools, and saves version 1.
    const created = await createAgentFromTemplate(actor, await stepSector(actor), fields);
    agentId = created.id;
  }
  // Kept before completing the step: if that fails, trying again edits this agent instead of creating another.
  const kept: FirstAgentProgress = { agentId, faqs: faqs ?? (existing ? (progress?.faqs ?? []) : []) };
  await setKv(SETUP_FIRST_AGENT_KEY, kept);
  await completeStep(actor, SETUP_STEP.agent, existing ? "setup.agent_updated" : "setup.agent_created");
  return { agentId, created: !existing };
}

// ─── «Generar desde la web del negocio» ─────────────────────────────────────────────────────────────────

/** Where the draft comes from, already validated by the action (draftRequestSchema of the agents screens). */
export type SetupDraftSource = { url: string } | { description: string };

/** What the form shows, editable: nothing of it is saved yet ([AGE-05]). */
export type SetupAgentDraft = { name: string; tone: string; instructions: AgentDraftInstructions; faqs: Faq[] };

/**
 * A draft from the business website or a description ([ASI-08], [AGE-05]), adapted from the sector template. Without
 * a key it says so and calls nothing; a web that cannot be read throws its own Spanish message (the form keeps the
 * template). Limited per person ([SEG-07]); the cost is recorded in ai_runs by the generator.
 */
export async function generateSetupAgentDraft(actor: Actor, source: SetupDraftSource): Promise<SetupAgentDraft> {
  assertSetupOwner(actor);
  const settings = await openStep(db, SETUP_STEP.agent);
  if (!(await isAiConfigured())) throw new ConflictError(NO_KEY_FOR_DRAFT_MESSAGE);
  await enforceAiRateLimit("generate", actor.userId);
  const [sector, existing] = await Promise.all([stepSector(actor), loadProgress().then((progress) => firstAgent(actor, progress))]);
  const draft = await generateAgentDraft({
    source,
    sector,
    business: { name: settings.name, terminology: settings.terminology },
    // Coming back to the step: the cost is linked to the agent it already created.
    agentId: existing?.id ?? null,
  });
  return { name: draft.name, tone: draft.tone, instructions: draft.instructions, faqs: draft.faqs };
}
