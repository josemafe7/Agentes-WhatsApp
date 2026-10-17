// anotar_permiso_avisos(acepta) ([HER-15], [CTO-09]): after booking by WhatsApp or Telegram, the agent asks a customer
// without «Avisos de sus citas» whether the business may remind them, and records a clear yes. What is kept as proof
// comes from the stored conversation, never from the model: the question is the agent's last message and the answer
// the customer's newest one, with the date and «en la conversación». A «no» records nothing and is not insisted on.
// The AI never records «Novedades y publicidad». Only for the conversation's contact ([HER-04]); in «Probar agente»
// nothing changes. On and off with the booking tools, only in WhatsApp and Telegram conversations.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/data/audit";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { hasPermission } from "@/lib/consents";
import { appendConsent, loadConsentState } from "@/server/compliance/consent-state";
import { defineTool } from "./registry";

const MAX_EVIDENCE = 1_000;

async function lastText(conversationId: string, direction: "inbound" | "outbound"): Promise<string | null> {
  const [row] = await db
    .select({ text: messages.text })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, direction), eq(messages.senderType, direction === "inbound" ? "contact" : "ai")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.text?.trim().slice(0, MAX_EVIDENCE) || null;
}

export const anotarPermisoAvisos = defineTool({
  name: "anotar_permiso_avisos",
  description:
    "Anota si el cliente quiere que le avisemos antes de sus citas. Úsala solo con una respuesta clara a la pregunta que le hiciste al confirmar la cita: acepta=true si dice que sí, false si dice que no. Si la respuesta es dudosa, vuelve a preguntarle en vez de usarla.",
  parameters: z.object({ acepta: z.boolean({ error: "Di si acepta (true) o no (false)." }).describe("true si el cliente dice claramente que sí; false si dice que no.") }),
  async execute(args, context) {
    if (context.mode === "test") return { result: { ok: true, prueba: true, anotado: args.acepta } };
    const { contactId, conversationId } = context;
    if (!contactId || !conversationId) return { result: { ok: false, error: "No hay cliente en esta conversación." } };
    if (!args.acepta) return { result: { ok: true, anotado: false, indicacion: "No insistas en esta reserva." } };
    if (hasPermission(await loadConsentState(contactId), "reminders")) return { result: { ok: true, anotado: true, ya_lo_tenia: true } };
    const [question, answer] = await Promise.all([lastText(conversationId, "outbound"), lastText(conversationId, "inbound")]);
    if (!question || !answer) return { result: { ok: false, error: "No encuentro tu pregunta o su respuesta: vuelve a preguntárselo." } };
    await db.transaction(async (tx) => {
      await appendConsent(
        tx,
        {
          contactId,
          channelId: context.channelId,
          type: "reminders_granted",
          source: "ai",
          method: "conversation",
          actorType: "ai",
          evidence: { question, answer },
        },
        context.now,
      );
      await writeAudit(
        { actor: "ai", action: "consent.permission_changed", targetType: "contact", targetId: contactId, metadata: { permission: "reminders", granted: true, how: "conversation" } },
        tx,
      );
    });
    return { result: { ok: true, anotado: true } };
  },
});
