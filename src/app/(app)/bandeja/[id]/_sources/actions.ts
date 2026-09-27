"use server";
// «¿Por qué respondió esto?» and «Convertir en FAQ» of the conversation screen ([BAN-07], [CON-20], [CON-22]). Thin:
// session and the area permission here; src/data validates the input with Zod and checks the conversation's channel
// and the knowledge permission again ([SEG-04], [PER-02]). Nothing on the conversation changes, so no refresh. A FAQ
// is content added to a base like any other: the same limit per person (each one costs AI, [SEG-07]) and its
// processing starts right after answering ([MOT-15]).
import { enforceKnowledgeAddLimit, startKnowledgeWork } from "@/app/(app)/conocimiento/_lib/work";
import { listKnowledgeBases } from "@/data/knowledge";
import { createFaqFromMessage, faqFromMessageSchema, getFaqDraftFromMessage } from "@/data/knowledge-faq";
import { getMessageReason, type MessageReason } from "@/data/message-reason";
import { fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

/** The fragments and tools of one AI answer, read when its panel opens. */
export async function loadWhyAnswerAction(input: unknown): Promise<ActionResult<MessageReason>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.view);
    return ok(await getMessageReason(actor, input));
  } catch (error) {
    return toActionFailure(error);
  }
}

export type KnowledgeBaseOption = { id: string; name: string };
export type FaqDraftView = { question: string; answer: string; bases: KnowledgeBaseOption[] };

/** The editable draft (the customer's question, the person's answer) and the bases it can be saved in. */
export async function loadFaqDraftAction(input: unknown): Promise<ActionResult<FaqDraftView>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.convertFaq);
    const draft = await getFaqDraftFromMessage(actor, input);
    const bases = await listKnowledgeBases(actor);
    return ok({ question: draft.question, answer: draft.answer, bases: bases.map(({ id, name }) => ({ id, name })) });
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Saves the (edited) draft as a FAQ of the chosen base; it is processed in the background like any other, at once. */
export async function convertToFaqAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.convertFaq);
    const parsed = faqFromMessageSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await enforceKnowledgeAddLimit(actor.userId);
    const { id } = await createFaqFromMessage(actor, parsed.data);
    startKnowledgeWork();
    return ok({ id }, "Pregunta frecuente guardada. La IA podrá usarla en cuanto termine de procesarse.");
  } catch (error) {
    return toActionFailure(error);
  }
}
