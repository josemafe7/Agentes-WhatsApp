// Shared by the Google and Microsoft OAuth callbacks ([COR-23]): the query validated with Zod, the signed-in person,
// the data layer's verdict, and a redirect to the channel with `?conexion=ok` or `?conexion=error&motivo=<code>` (the
// screen shows the Spanish text of the code: never the provider's own text, never a token in the URL).
import { z } from "zod";
import type { OAuthCallbackQuery, OAuthCompletion } from "@/data/email-oauth";
import { loginPathFor } from "@/lib/auth-paths";
import { getAppUrl } from "@/server/app-url";
import { safeErrorMessage } from "@/server/redact";
import { getActor, TWO_FACTOR_SETUP_PATH, type SessionActor } from "@/server/session";

const queryValue = z.string().max(4_096).optional();
const querySchema = z.object({
  code: queryValue,
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
  admin_consent: z.string().max(10).optional(),
});

function readQuery(request: Request): OAuthCallbackQuery | null {
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
    error: params.get("error") ?? undefined,
    admin_consent: params.get("admin_consent") ?? undefined,
  });
  if (!parsed.success) return null;
  return { code: parsed.data.code ?? null, state: parsed.data.state ?? null, error: parsed.data.error ?? null, adminConsent: parsed.data.admin_consent ?? null };
}

const CHANNELS_PATH = "/canales";

function redirectTo(path: string, params: Record<string, string> = {}): Response {
  const url = new URL(path.startsWith("/") && !path.startsWith("//") ? path : CHANNELS_PATH, `${getAppUrl()}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return Response.redirect(url.toString(), 303);
}

export async function handleOAuthCallback(
  request: Request,
  complete: (actor: SessionActor | null, query: OAuthCallbackQuery) => Promise<OAuthCompletion>,
): Promise<Response> {
  const query = readQuery(request);
  if (!query) return redirectTo(CHANNELS_PATH, { conexion: "error", motivo: "state_invalid" });
  try {
    const actor = await getActor();
    // Without a session nothing is consumed: the person signs in and presses «Conectar» again.
    if (!actor) return redirectTo(loginPathFor(CHANNELS_PATH));
    // Owners and admins who must set up 2FA first ([USU-12]) do nothing else until they do.
    if (actor.twoFactorSetupRequired) return redirectTo(TWO_FACTOR_SETUP_PATH);
    const result = await complete(actor, query);
    if (result.ok) return redirectTo(result.returnTo, result.adminConsent ? { consentimiento: "ok" } : { conexion: "ok" });
    return redirectTo(result.returnTo, { conexion: "error", motivo: result.reason });
  } catch (error) {
    // Generic answer only: nothing of the provider's reply or the tokens ([SEG-14]).
    console.error(`[oauth] No se ha podido completar la conexión: ${safeErrorMessage(error)}`);
    return redirectTo(CHANNELS_PATH, { conexion: "error", motivo: "provider_error" });
  }
}
