// What a «Probar agente» send must look like ([SEG-05]). The browser is not trusted: size and number of messages
// are checked here again, whatever the page did.
import { z } from "zod";
import { formatNumber } from "@/lib/format";
import { idSchema } from "@/lib/validation";
import { SIMULATED_CHANNELS } from "@/server/ai/prompt";
import { TEST_CHAT_LIMITS } from "./transcript";

export const INVALID_TEST_MESSAGE = "No se ha podido enviar: el mensaje está vacío o es demasiado largo.";

const messageSchema = z
  .object({
    role: z.enum(["contact", "ai"], { error: "Mensaje no válido." }),
    text: z
      .string({ error: "Mensaje no válido." })
      .trim()
      .min(1, "El mensaje está vacío.")
      .max(TEST_CHAT_LIMITS.maxMessageChars, `Como mucho ${formatNumber(TEST_CHAT_LIMITS.maxMessageChars)} caracteres.`),
  })
  .strict();

export const testChatInputSchema = z
  .object({
    agentId: idSchema,
    /** «Simular canal» ([PRU-03]). */
    channel: z.enum(SIMULATED_CHANNELS, { error: "Elige WhatsApp, correo o web." }),
    /** Oldest first; the last one is the tester's new message. */
    messages: z
      .array(messageSchema, { error: "Mensaje no válido." })
      .min(1, "Escribe un mensaje.")
      .max(TEST_CHAT_LIMITS.maxMessages, `Como mucho ${TEST_CHAT_LIMITS.maxMessages} mensajes.`)
      .refine((messages) => messages.at(-1)?.role === "contact", "El último mensaje tiene que ser tuyo."),
  })
  .strict();

export type TestChatInput = z.infer<typeof testChatInputSchema>;
