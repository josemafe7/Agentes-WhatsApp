// anotar_permiso_avisos(acepta) ([HER-15], [CTO-09]): «Avisos de sus citas» se da por hecho (decision 0030), so the
// agent never asks; when the customer says in their own words that they do not want reminders, it records the «no»
// (from then on no reminder goes by WhatsApp or Telegram), and a later «sí» gives it back. What is kept as proof comes
// from the stored conversation, never from the model: the agent's last message and the customer's newest one, with
// the date and «en la conversación». A «no» is recorded even without that proof: an opt-out is never lost; a «sí»
// needs it. The AI never records «Novedades y publicidad». Only for the conversation's contact ([HER-04]); in
// «Probar agente» nothing changes. On and off with the booking tools, only in WhatsApp and Telegram conversations.
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
    "Los avisos antes de sus citas se dan por hecho: no preguntes por ellos. Úsala solo cuando el cliente diga con sus palabras que no quiere avisos de sus citas (acepta=false) o, si ya los había quitado, que vuelve a quererlos (acepta=true). Si no está claro, pregúntaselo antes.",
  parameters: z.object({
    acepta: z.boolean({ error: "Di si los quiere (true) o no (false)." }).describe("false si el cliente dice claramente que no quiere avisos de sus citas; true si dice que vuelve a quererlos."),
  }),
  async execute(args, context) {
    if (context.mode === "test") return { result: { ok: true, prueba: true, anotado: args.acepta } };
    const { contactId, conversationId } = context;
    if (!contactId || !conversationId) return { result: { ok: false, error: "No hay cliente en esta conversación." } };
    if (hasPermission(await loadConsentState(contactId), "reminders") === args.acepta) return { result: { ok: true, anotado: args.acepta, ya_estaba: true } };
    const [question, answer] = await Promise.all([lastText(conversationId, "outbound"), lastText(conversationId, "inbound")]);
    if (args.acepta && (!question || !answer)) return { result: { ok: false, error: "No encuentro lo que dijo el cliente: pregúntale si quiere volver a recibir los avisos." } };
    await db.transaction(async (tx) => {
      await appendConsent(
        tx,
        {
          contactId,
          channelId: context.channelId,
          type: args.acepta ? "reminders_granted" : "reminders_withdrawn",
          source: "ai",
          method: "conversation",
          actorType: "ai",
          evidence: question && answer ? { question, answer } : null,
        },
        context.now,
      );
      await writeAudit(
        { actor: "ai", action: "consent.permission_changed", targetType: "contact", targetId: contactId, metadata: { permission: "reminders", granted: args.acepta, how: "conversation" } },
        tx,
      );
    });
    return {
      result: {
        ok: true,
        anotado: args.acepta,
        indicacion: args.acepta
          ? "Confírmale que volverá a recibir los avisos antes de sus citas."
          : "Confírmale que ya no le enviaremos avisos antes de sus citas por WhatsApp ni por Telegram.",
      },
    };
  },
});
