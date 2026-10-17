// Connecting an Instagram account ([IG-01], [IG-11], docs/integracion-instagram.md §2 and §4.4): GET /me checks the token
// and says which professional account it is; then the account is subscribed to the messages (POST /me/subscribed_apps),
// without which Meta sends no webhook of it. Nothing is stored here.
import "server-only";
import { createInstagramClient } from "@/lib/instagram/client";
import { InstagramApiError } from "@/lib/instagram/errors";
import { safeErrorMessage } from "@/server/redact";
import type { InstagramDeps } from "./config";

export type InstagramAccountIdentity = { accountId: string; username: string; accountName: string | null };

export type InstagramValidation = { ok: true; account: InstagramAccountIdentity } | { ok: false; error: string; action: string | null };

const UNEXPECTED = "No se ha podido comprobar el token por un error inesperado.";
const NOT_PROFESSIONAL = "Esa cuenta no es profesional (de empresa o de creador): Instagram solo deja atender sus mensajes así.";

function failure(error: unknown): Extract<InstagramValidation, { ok: false }> {
  if (error instanceof InstagramApiError) return { ok: false, error: error.userMessage, action: error.action };
  console.error(`[instagram] Validación fallida: ${safeErrorMessage(error)}`);
  return { ok: false, error: UNEXPECTED, action: null };
}

/** Checks the token, says whose account it is and subscribes it to its messages. */
export async function validateInstagramToken(accessToken: string, deps: InstagramDeps = {}): Promise<InstagramValidation> {
  try {
    const client = createInstagramClient({ accessToken, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
    const me = await client.getMe();
    if (me.account_type && !["business", "media_creator"].includes(me.account_type.toLowerCase())) return { ok: false, error: NOT_PROFESSIONAL, action: "Pásala a cuenta profesional en Instagram y vuelve a generar el token." };
    // Without it Meta sends nothing of this account (§4.4).
    if (!(await client.subscribeApp())) return { ok: false, error: "Instagram no ha suscrito la cuenta a sus mensajes.", action: "Revisa en tu app de Meta que la cuenta está añadida y que la app tiene el permiso instagram_business_manage_messages, y vuelve a intentarlo." };
    return { ok: true, account: { accountId: me.user_id, username: me.username, accountName: me.name?.trim() || null } };
  } catch (error) {
    return failure(error);
  }
}
