// One WhatsApp number, one channel in the installation, whatever the way it is connected ([WA-11], [QR-05]). A number
// connected with Meta's own API is told apart by the id Meta gives it (`phone_number_id`, unique in the table); the
// other ways keep the number's own digits there behind a prefix («ycloud:34600111222», «qr:34600111222»), so a row of
// one way never looks like a row of another. This file answers «is this number already here?» across all of them.
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import type { Executor } from "@/db";
import { channels } from "@/db/schema";
import { phoneDigits } from "@/lib/meta/markets";
import { whatsappViaOf, type WhatsAppVia } from "@/lib/whatsapp-via";
import type { ChannelRecord } from "@/server/channels/types";
import { ConflictError } from "@/server/errors";

export const WHATSAPP_NUMBER_TAKEN = "Este número ya está en otro canal de WhatsApp de la instalación. Vuelve a conectar ese canal desde su panel, o elimínalo antes.";

type NumberColumns = Pick<ChannelRecord, "type" | "connectionMode" | "phoneNumberId" | "displayPhoneNumber">;

/** The digits of this channel's own number (the phone is data here, never a contact's key), or null while unknown. */
export function whatsappNumberOf(channel: NumberColumns): string | null {
  const via = whatsappViaOf(channel);
  if (via === null) return null;
  return phoneDigits(via === "meta" ? channel.displayPhoneNumber : channel.phoneNumberId) || null;
}

/** The numbers the real WhatsApp channels of the installation already have, by the way each is connected. */
export async function listWhatsAppNumbers(executor: Executor, exceptChannelId: string | null = null): Promise<{ number: string; via: WhatsAppVia }[]> {
  const rows = await executor
    .select({ type: channels.type, connectionMode: channels.connectionMode, phoneNumberId: channels.phoneNumberId, displayPhoneNumber: channels.displayPhoneNumber })
    .from(channels)
    .where(and(eq(channels.type, "whatsapp"), eq(channels.isDemo, false), ...(exceptChannelId ? [ne(channels.id, exceptChannelId)] : [])));
  return rows.flatMap((row) => {
    const number = whatsappNumberOf(row);
    const via = whatsappViaOf(row);
    return number && via ? [{ number, via }] : [];
  });
}

/**
 * Throws ConflictError when another real channel already has this number. `vias` narrows the ways looked at: Meta's
 * own connection only looks at the other two (its numbers are already unique by Meta's id).
 */
export async function assertWhatsAppNumberFree(
  executor: Executor,
  phoneNumber: string | null | undefined,
  options: { exceptChannelId?: string | null; vias?: readonly WhatsAppVia[] } = {},
): Promise<void> {
  const wanted = phoneDigits(phoneNumber);
  if (!wanted) return;
  const taken = await listWhatsAppNumbers(executor, options.exceptChannelId ?? null);
  if (taken.some((row) => row.number === wanted && (!options.vias || options.vias.includes(row.via)))) throw new ConflictError(WHATSAPP_NUMBER_TAKEN);
}
