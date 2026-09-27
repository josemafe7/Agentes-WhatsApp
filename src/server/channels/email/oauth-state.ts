// OAuth round trips started from the app (Google and Microsoft, [COR-23]): each «Conectar» stores the SHA-256 of a
// random `state`, the PKCE verifier encrypted, who started it, for which channel, where to return and a 10-minute
// expiry. The callback consumes the state once (atomically) and only for the person who started it: a return that
// does not match one of ours, comes back twice, comes late or for another person is rejected and nothing is stored —
// and another person's attempt does not use it up for its owner. System code: the data layer checks permissions first.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { oauthStates } from "@/db/schema";
import type { OAuthProvider } from "@/lib/enums";
import { encryptSecret, hashToken, randomToken, tryDecryptSecret } from "@/server/crypto";

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** Used or expired states are deleted after this long. */
const CLEANUP_AFTER_MS = 24 * 60 * 60_000;

/** A random PKCE verifier (43 characters) and its S256 challenge (RFC 7636). */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export type OAuthStart = { state: string; codeChallenge: string };

export async function createOAuthState(
  input: { provider: OAuthProvider; channelId: string; userId: string; returnTo: string },
  now: Date = new Date(),
): Promise<OAuthStart> {
  const state = randomToken();
  const pkce = createPkcePair();
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date(now.getTime() - CLEANUP_AFTER_MS)));
  await db.insert(oauthStates).values({
    provider: input.provider,
    stateHash: hashToken(state),
    codeVerifierEnc: encryptSecret(pkce.verifier),
    channelId: input.channelId,
    userId: input.userId,
    returnTo: input.returnTo,
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    createdAt: now,
    updatedAt: now,
  });
  return { state, codeChallenge: pkce.challenge };
}

export type ConsumedState = { channelId: string; userId: string; codeVerifier: string; returnTo: string | null };
export type ConsumeResult = { ok: true; state: ConsumedState } | { ok: false; reason: "state_invalid" | "state_expired" };

/** Marks the state used (only once, and only when it is `userId`'s) and returns what it holds. */
export async function consumeOAuthState(provider: OAuthProvider, state: string | null | undefined, userId: string, now: Date = new Date()): Promise<ConsumeResult> {
  if (!state || state.length > 200) return { ok: false, reason: "state_invalid" };
  const stateHash = hashToken(state);
  const [row] = await db
    .update(oauthStates)
    .set({ usedAt: now, updatedAt: now })
    .where(and(eq(oauthStates.stateHash, stateHash), eq(oauthStates.provider, provider), eq(oauthStates.userId, userId), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, now)))
    .returning();
  if (!row) {
    const [known] = await db.select({ expiresAt: oauthStates.expiresAt, usedAt: oauthStates.usedAt, userId: oauthStates.userId }).from(oauthStates).where(eq(oauthStates.stateHash, stateHash));
    return { ok: false, reason: known && known.userId === userId && !known.usedAt && known.expiresAt <= now ? "state_expired" : "state_invalid" };
  }
  const codeVerifier = tryDecryptSecret(row.codeVerifierEnc);
  if (!row.channelId || !row.userId || !codeVerifier) return { ok: false, reason: "state_invalid" };
  return { ok: true, state: { channelId: row.channelId, userId: row.userId, codeVerifier, returnTo: row.returnTo } };
}
