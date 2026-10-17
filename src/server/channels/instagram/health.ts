// The Instagram panel's traffic lights and the token's renewal ([IG-09], [IG-10], [CAN-15], docs/integracion-instagram.md
// §2.2 and §4.5): GET /me checks the token (and that it is still the same account); the account is subscribed to its
// messages again (Meta drops the subscription after an hour of failed deliveries); once a week, or on the first check a
// day after it was pasted, the token is renewed for 60 more days — a renewal Instagram refuses because of the token
// itself (invalid, expired, revoked or without a permission) is an error at once; one that failed any other way (the
// network, a passing error of Instagram) only near its end; then what the app already knows (whether Meta checked the
// webhook and the last message). A blocking light puts the channel in «error» and tells owner and admins what got worse.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, type ChannelHealth } from "@/db/schema";
import { InstagramApiError } from "@/lib/instagram/errors";
import { notify } from "@/server/notifications/notify";
import { safeErrorMessage } from "@/server/redact";
import { worsenedChecks } from "../health";
import type { ChannelRecord } from "../types";
import { encryptInstagramSecrets, instagramClientFor, readInstagramConfig, readInstagramSecrets, TOKEN_LIFETIME_MS, updateInstagramConfig, type InstagramDeps } from "./config";

type Check = ChannelHealth["checks"][number];
type CheckStatus = Check["status"];

/** Spanish names of the lights, in the panel's order. */
export const INSTAGRAM_HEALTH_LABELS = { token: "Token", expiry: "Caducidad del token", receiving: "Recepción", last_message: "Último mensaje" } as const;
export type InstagramHealthKey = keyof typeof INSTAGRAM_HEALTH_LABELS;

/** These make the channel unusable: its status becomes «error» and owner and admins are told ([CAN-15]). */
const BLOCKING: ReadonlySet<InstagramHealthKey> = new Set(["token", "expiry"]);
const DAY_MS = 24 * 60 * 60_000;
/** Instagram only renews a token at least 24 hours old (§2.2). */
const MIN_TOKEN_AGE_MS = DAY_MS;
/** The app renews it once a week, far from its 60 days. */
export const REFRESH_EVERY_MS = 7 * DAY_MS;
/** Under this, the expiry light turns amber. */
const EXPIRY_WARNING_MS = 14 * DAY_MS;

const check = (key: InstagramHealthKey, status: CheckStatus, detail: string): Check => ({ key, status, detail });

export type InstagramHealthReport = { health: ChannelHealth; blocking: boolean };

/** Renews the token when it is due; returns its new expiry, null when not due, or the error. */
async function renewIfDue(channel: ChannelRecord, deps: InstagramDeps, now: Date): Promise<{ expiresAt: Date } | { error: InstagramApiError | Error } | null> {
  const config = readInstagramConfig(channel.config);
  const secrets = readInstagramSecrets(channel);
  if (!secrets) return null;
  const setAt = config.tokenSetAt ? new Date(config.tokenSetAt) : null;
  const age = setAt ? now.getTime() - setAt.getTime() : Number.POSITIVE_INFINITY;
  // A token pasted by hand: its real age is unknown, so it is renewed as soon as Instagram lets (a day later).
  const due = !config.tokenExpiresAt || config.refreshFailures > 0 ? age >= MIN_TOKEN_AGE_MS : age >= REFRESH_EVERY_MS;
  if (!due) return null;
  try {
    const renewed = await instagramClientFor(channel, deps, secrets).refreshToken();
    const expiresAt = new Date(now.getTime() + renewed.expires_in * 1_000);
    await updateInstagramConfig(channel.id, { tokenSetAt: now.toISOString(), tokenExpiresAt: expiresAt.toISOString(), refreshFailures: 0 }, {
      extra: { secretsEnc: encryptInstagramSecrets({ ...secrets, accessToken: renewed.access_token }) },
    });
    return { expiresAt };
  } catch (error) {
    if (!(error instanceof InstagramApiError)) console.error(`[instagram] No se pudo renovar el token: ${safeErrorMessage(error)}`);
    await updateInstagramConfig(channel.id, (current) => ({ refreshFailures: current.refreshFailures + 1 }));
    return { error: error instanceof Error ? error : new Error("error inesperado") };
  }
}

/** The account subscribed to its messages again (§4.5): idempotent; false when Instagram did not take it. */
async function resubscribe(channel: ChannelRecord, deps: InstagramDeps): Promise<boolean> {
  try {
    return await instagramClientFor(channel, deps).subscribeApp();
  } catch (error) {
    if (!(error instanceof InstagramApiError)) console.error(`[instagram] No se pudo volver a suscribir la cuenta: ${safeErrorMessage(error)}`);
    return false;
  }
}

/** The lights of one account, renewing its token first when due. */
export async function checkInstagramHealth(channel: ChannelRecord, deps: InstagramDeps = {}): Promise<InstagramHealthReport> {
  const now = deps.now?.() ?? new Date();
  const checkedAt = now.toISOString();
  const secrets = readInstagramSecrets(channel);
  if (!secrets) {
    const detail = "Falta el token de esta cuenta de Instagram. Vuelve a conectarla.";
    return { health: { checkedAt, checks: [check("token", "error", detail)], error: detail }, blocking: true };
  }
  const config = readInstagramConfig(channel.config);
  const checks: Check[] = [];
  try {
    const me = await instagramClientFor(channel, deps, secrets).getMe();
    checks.push(
      config.accountId && me.user_id !== config.accountId
        ? check("token", "error", `El token es de otra cuenta (@${me.username}). Genera el de @${config.username ?? "la cuenta del canal"} y pulsa «Cambiar token».`)
        : check("token", "ok", `Cuenta @${me.username} conectada.`),
    );
  } catch (error) {
    if (error instanceof InstagramApiError && !error.retryable) checks.push(check("token", "error", `${error.userMessage} ${error.action}`));
    else checks.push(check("token", "warn", `No se ha podido comprobar el token: ${error instanceof InstagramApiError ? error.userMessage : "error inesperado"}`));
  }
  const tokenOk = checks[0].status === "ok";
  const renewal = tokenOk ? await renewIfDue(channel, deps, now) : null;
  const expiresAt = renewal && "expiresAt" in renewal ? renewal.expiresAt : config.tokenExpiresAt ? new Date(config.tokenExpiresAt) : config.tokenSetAt ? new Date(new Date(config.tokenSetAt).getTime() + TOKEN_LIFETIME_MS) : null;
  if (renewal && "error" in renewal) {
    const left = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
    const error = renewal.error;
    const why = error instanceof InstagramApiError ? error.userMessage : "error inesperado";
    // Instagram refused the token itself: another try will not help, the business has to act ([IG-09]). Anything else
    // is tried again in the next check.
    const refused = error instanceof InstagramApiError && error.token && !error.retryable;
    checks.push(
      refused
        ? check("expiry", "error", `Instagram no ha renovado el token. ${error.userMessage} ${error.action}`)
        : left <= EXPIRY_WARNING_MS / 2
          ? check("expiry", "error", `No se ha podido renovar el token (${why}) y caduca pronto. Genera uno nuevo en el panel de tu app de Meta y pulsa «Cambiar token».`)
          : check("expiry", "warn", `No se ha podido renovar el token (${why}); se vuelve a intentar en la próxima revisión.`),
    );
  } else if (expiresAt) {
    const left = expiresAt.getTime() - now.getTime();
    checks.push(
      left <= 0
        ? check("expiry", "error", "El token ha caducado. Genera uno nuevo en el panel de tu app de Meta y pulsa «Cambiar token».")
        : check("expiry", left <= EXPIRY_WARNING_MS ? "warn" : "ok", `Vale hasta el ${expiresAt.toISOString()}; la app lo renueva sola cada semana.`),
    );
  }
  const subscribed = tokenOk ? await resubscribe(channel, deps) : true;
  checks.push(
    !subscribed
      ? check("receiving", "warn", "No se ha podido volver a suscribir la cuenta a sus mensajes; se intenta en la próxima revisión, o pulsa «Revalidar».")
      : config.webhookVerifiedAt
        ? check("receiving", "ok", "Meta ha comprobado la dirección de avisos de esta cuenta.")
        : check("receiving", "warn", "Meta aún no ha comprobado la dirección de avisos: pégala con su token de verificación en el panel de tu app de Meta (Webhooks)."),
  );
  checks.push(
    channel.lastInboundAt ? check("last_message", "ok", `Último mensaje recibido el ${channel.lastInboundAt.toISOString()}.`) : check("last_message", "off", "Aún no ha llegado ningún mensaje."),
  );
  const failing = checks.find((item) => item.status === "error" && BLOCKING.has(item.key as InstagramHealthKey));
  return { health: { checkedAt, checks, ...(failing ? { error: failing.detail } : {}) }, blocking: failing !== undefined };
}

async function loadInstagramChannel(channelId: string): Promise<ChannelRecord | null> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  // Demo channels never call Instagram ([ARR-11]).
  return channel && channel.type === "instagram" && !channel.isDemo ? channel : null;
}

/** ig.health_check: the lights every 6 h (and the weekly renewal); a channel that cannot work goes to «error». */
export async function runInstagramHealthCheck(channelId: string, deps: InstagramDeps = {}): Promise<InstagramHealthReport | null> {
  const channel = await loadInstagramChannel(channelId);
  if (!channel || channel.status === "draft") return null;
  // A channel switched off keeps its token alive (it lasts 60 days), without lights nor notices ([IG-09]).
  if (channel.status === "disabled") {
    if (readInstagramSecrets(channel)) await renewIfDue(channel, deps, deps.now?.() ?? new Date());
    return null;
  }
  const report = await checkInstagramHealth(channel, deps);
  const now = deps.now?.() ?? new Date();
  await updateInstagramConfig(channel.id, {}, { extra: { lastHealth: report.health, lastHealthAt: now, status: report.blocking ? "error" : "connected" } });
  const worse = worsenedChecks(channel.lastHealth, report.health);
  if (worse.length > 0) {
    const labels = worse.map((item) => INSTAGRAM_HEALTH_LABELS[item.key as InstagramHealthKey] ?? item.key).join(", ");
    await notify({ event: "channel_error", title: `Instagram «${channel.name}»: ha empeorado ${labels}`, body: worse[0].detail ?? null, link: `/canales/${channel.id}`, channelId: channel.id });
  }
  return report;
}

/**
 * Sending found the account itself failing (token, permissions, Instagram blocking it): the channel goes to «error»
 * with the reason and owner and admins are told, without waiting for the next check ([IG-09], [CAN-15]).
 */
export async function markInstagramAccountError(channelId: string, detail: string, now: Date = new Date()): Promise<void> {
  const channel = await loadInstagramChannel(channelId);
  if (!channel || channel.status === "disabled") return;
  const previous = channel.lastHealth;
  const checks = [check("token", "error", detail), ...(previous?.checks ?? []).filter((item) => item.key !== "token")];
  const health: ChannelHealth = { checkedAt: now.toISOString(), checks, error: detail };
  await updateInstagramConfig(channel.id, {}, { extra: { lastHealth: health, lastHealthAt: now, status: "error" } });
  if (worsenedChecks(previous, health).length > 0) {
    await notify({ event: "channel_error", title: `Instagram «${channel.name}»: ha empeorado ${INSTAGRAM_HEALTH_LABELS.token}`, body: detail, link: `/canales/${channel.id}`, channelId: channel.id });
  }
}
