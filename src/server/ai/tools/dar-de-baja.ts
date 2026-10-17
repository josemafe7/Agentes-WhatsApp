// dar_de_baja(de) ([HER-16], [CUM-03], [CTO-10]): when the customer asks in their own words not to be written again,
// the agent records it on the conversation's kind of channel: of novedades y publicidad only, or of everything (as
// «BAJA» does). Of everything, the app sends its one confirmation and the AI says nothing more there; of publicidad,
// the agent confirms it itself and the reminders of their bookings go on. Only for the conversation's contact
// ([HER-04]); in «Probar agente» nothing changes. Always on for the agents that answer customers.
import "server-only";
import { z } from "zod";
import { writeAudit } from "@/data/audit";
import { db } from "@/db";
import { CHANNEL_KIND_OF } from "@/lib/enums";
import { appendConsent, channelKindOf, loadConsentState } from "@/server/compliance/consent-state";
import { enqueueOptOutConfirmation } from "@/server/compliance/opt-out";
import { channels } from "@/db/schema";
import { eq } from "drizzle-orm";
import { defineTool } from "./registry";

export const darDeBaja = defineTool({
  name: "dar_de_baja",
  description:
    "Da de baja al cliente cuando pide con sus palabras que no le escribáis más (de = «todo») o que no le mandéis novedades ni publicidad (de = «publicidad»), en este canal. Si no está claro cuál de las dos quiere, pregúntaselo antes.",
  parameters: z.object({ de: z.enum(["publicidad", "todo"], { error: "Di «publicidad» o «todo»." }).describe("«publicidad»: solo novedades y publicidad; «todo»: no escribirle más por este canal.") }),
  async execute(args, context) {
    if (context.mode === "test") return { result: { ok: true, prueba: true, de: args.de } };
    if (!context.contactId || !context.conversationId || !context.channelId) return { result: { ok: false, error: "No hay cliente en esta conversación." } };
    const kind = await channelKindOf(context.channelId);
    if (!kind) return { result: { ok: false, error: "No se encuentra el canal." } };
    const contactId = context.contactId;
    const state = await loadConsentState(contactId);
    const scope = args.de === "todo" ? "all" : "marketing";
    if (state.optOuts[kind].all || (scope === "marketing" && state.optOuts[kind].marketing)) return { result: { ok: true, ya_estaba: true } };
    const [channel] = await db.select({ type: channels.type }).from(channels).where(eq(channels.id, context.channelId));
    const consent = await db.transaction(async (tx) => {
      const row = await appendConsent(
        tx,
        {
          contactId,
          channelId: context.channelId,
          channelType: channel?.type ?? null,
          channelKind: channel ? CHANNEL_KIND_OF[channel.type] : kind,
          type: scope === "all" ? "opt_out" : "marketing_opt_out",
          source: "ai",
          method: "conversation",
          actorType: "ai",
        },
        context.now,
      );
      await writeAudit({ actor: "ai", action: "consent.opted_out", targetType: "contact", targetId: contactId, metadata: { channelKinds: [kind], scope, source: "ai" } }, tx);
      return row;
    });
    if (scope === "all") {
      // The one confirmation goes through the queue, as with «BAJA»; nothing else of the AI reaches them here.
      await enqueueOptOutConfirmation({ consentId: consent.id, conversationId: context.conversationId }, { now: context.now });
      return { result: { ok: true, de: "todo", indicacion: "La app le envía ya la confirmación. No escribas nada más." } };
    }
    return { result: { ok: true, de: "publicidad", indicacion: "Confírmale que no recibirá más novedades ni publicidad por aquí; los avisos de sus citas seguirán llegando." } };
  },
});
