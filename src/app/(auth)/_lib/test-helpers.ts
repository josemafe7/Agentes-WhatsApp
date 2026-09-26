// Test-only helpers for the sign-in flows: real Better Auth against the test file's own database.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { session } from "@/db/schema";
import { auth } from "@/server/auth";

export const TEST_ORIGIN = "http://localhost:3000";

let ipCounter = 0;

/** A fresh client IP, so each call gets its own rate-limit counters. */
export function nextTestIp(): string {
  ipCounter += 1;
  return `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/** "name=value; …" for a Cookie header, from a response's Set-Cookie headers (deleted cookies left out). */
export function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

/**
 * Signs in with Better Auth's server API, as the sign-in action does (the endpoint is closed over HTTP), and
 * returns the status and the cookies it set (session, or two_factor with 2FA).
 */
export async function serverSignIn(email: string, password: string): Promise<{ status: number; cookie: string }> {
  const response = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ origin: TEST_ORIGIN, "x-forwarded-for": nextTestIp() }),
    asResponse: true,
  });
  return { status: response.status, cookie: cookieHeaderFrom(response) };
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 (no padding) to text: the TOTP secret inside an otpauth:// URI. */
function base32ToText(encoded: string): string {
  let bits = "";
  for (const char of encoded.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) throw new Error("base32 no válido");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
}

/** The raw TOTP secret (what generateTOTP expects) from the otpauth:// URI shown as a QR code. */
export function totpSecretFromUri(totpUri: string): string {
  const encoded = new URL(totpUri).searchParams.get("secret");
  if (!encoded) throw new Error("La URI no trae secreto");
  return base32ToText(encoded);
}

/** The code an authenticator app would show right now. */
export async function currentTotp(secret: string): Promise<string> {
  return (await auth.api.generateTOTP({ body: { secret } })).code;
}

/** Turns TOTP 2FA on for a user (as Mi cuenta does) and returns the secret and the backup codes. */
export async function enableTwoFactorFor(user: { email: string; password: string }): Promise<{ secret: string; backupCodes: string[] }> {
  const { cookie } = await serverSignIn(user.email, user.password);
  const headers = new Headers({ cookie });
  const enabled = await auth.api.enableTwoFactor({ body: { password: user.password }, headers });
  if (!("totpURI" in enabled) || !enabled.totpURI || !enabled.backupCodes) throw new Error("No se ha activado TOTP");
  const secret = totpSecretFromUri(enabled.totpURI);
  await auth.api.verifyTOTP({ body: { code: await currentTotp(secret) }, headers });
  return { secret, backupCodes: enabled.backupCodes };
}

/** Full sign-in of a user with 2FA (password, then the current code), as the actions do; returns the session cookie. */
export async function serverSignInWithTwoFactor(email: string, password: string, secret: string): Promise<string> {
  const { cookie } = await serverSignIn(email, password);
  const response = await auth.api.verifyTOTP({
    body: { code: await currentTotp(secret) },
    headers: new Headers({ origin: TEST_ORIGIN, cookie, "x-forwarded-for": nextTestIp() }),
    asResponse: true,
  });
  if (response.status !== 200) throw new Error(`verify-totp respondió ${response.status}`);
  return cookieHeaderFrom(response);
}

export async function sessionCount(userId: string): Promise<number> {
  return (await db.select({ id: session.id }).from(session).where(eq(session.userId, userId))).length;
}
