"use server";
// «Darme de baja» of the public page ([ENV-11], [PER-09]): no session; a limit per IP, since anyone can call it.
import { headers } from "next/headers";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { unsubscribeByToken } from "@/server/campaigns/unsubscribe";
import { clientIp } from "@/server/client-ip";

const PER_MINUTE = 10;

export type UnsubscribeState = { done: boolean; error: string | null };

export async function unsubscribeAction(token: string): Promise<UnsubscribeState> {
  const limited = await getRateLimiter().hit(`baja:page:${clientIp(await headers())}`, PER_MINUTE, 60_000);
  if (!limited.allowed) return { done: false, error: "Demasiados intentos. Espera un minuto." };
  if (typeof token !== "string" || !(await unsubscribeByToken(token))) return { done: false, error: "Este enlace no es válido." };
  return { done: true, error: null };
}
