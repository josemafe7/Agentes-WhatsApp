"use server";
// Server Actions of step 5 «Primer agente» ([ASI-08], [ASI-11]). Thin: they read the form, check who asks
// (requireActor) and call src/data/setup-agent.ts, which checks the owner role and the step, and validates.
// «Saltar este paso» is skipStepAction of ../actions, bound to step 5.
import { redirect } from "next/navigation";
import { draftRequestSchema } from "@/app/(app)/agentes/_lib/requests";
import { SETUP_STEP } from "@/data/setup";
import { generateSetupAgentDraft, saveSetupAgentStep, type SetupAgentDraft } from "@/data/setup-agent";
import type { AgentInstructions } from "@/db/schema";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { agentInstructionsSchema } from "@/lib/agent-input";
import { isOpenRouterError } from "@/lib/openrouter/errors";
import { toActionFailure } from "@/server/errors";
import { requireActor } from "@/server/session";
import type { SetupFormState } from "../actions";
import { setupStepHref } from "../_lib/view";

/** Guided instruction fields; the form sends each as `instructions.<key>`. */
const INSTRUCTION_KEYS = Object.keys(agentInstructionsSchema.shape) as (keyof AgentInstructions)[];
/** The kept FAQs travel as JSON in `faqs`; anything bigger than this is not a real form (8 FAQs of ~2,300 chars). */
const MAX_FAQS_PAYLOAD_CHARS = 30_000;

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Only the fields this step sets; instructions and FAQs only if the form sent them. */
function agentStepInput(formData: FormData): Record<string, unknown> {
  const input: Record<string, unknown> = { name: text(formData, "name") };
  const tone = text(formData, "tone");
  if (tone !== undefined) input.tone = tone;
  const instructions: Partial<Record<keyof AgentInstructions, string>> = {};
  for (const key of INSTRUCTION_KEYS) {
    const value = text(formData, `instructions.${key}`);
    if (value !== undefined) instructions[key] = value;
  }
  if (Object.keys(instructions).length > 0) input.instructions = instructions;
  const faqs = text(formData, "faqs");
  if (faqs !== undefined) {
    let parsed: unknown = null;
    if (faqs.length <= MAX_FAQS_PAYLOAD_CHARS) {
      try {
        parsed = JSON.parse(faqs);
      } catch {
        // Not JSON: the data layer rejects `null` with its validation message.
      }
    }
    input.faqs = parsed;
  }
  return input;
}

/** «Crear agente y continuar»: creates (or, coming back, edits) the first agent and goes to step 6. */
export async function saveAgentStepAction(_previous: SetupFormState, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await saveSetupAgentStep(actor, agentStepInput(formData));
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(setupStepHref(SETUP_STEP.webchat));
}

/**
 * «Generar desde la web del negocio» (or from a description when the web cannot be read): returns an editable draft
 * and saves nothing ([ASI-08], [AGE-05]). Without a key, or when the web cannot be read, it says so.
 */
export async function generateAgentDraftAction(input: unknown): Promise<ActionResult<SetupAgentDraft>> {
  try {
    const actor = await requireActor();
    const parsed = draftRequestSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const request = parsed.data;
    const draft = await generateSetupAgentDraft(actor, request.source === "url" ? { url: request.url } : { description: request.description });
    return ok(draft, "Borrador listo. Revísalo y cámbialo si hace falta antes de crear el agente.");
  } catch (error) {
    // OpenRouter failures carry a generic Spanish message (no credits, time-out…), never details ([SEG-14]).
    if (isOpenRouterError(error)) return fail(error.userMessage);
    return toActionFailure(error);
  }
}
