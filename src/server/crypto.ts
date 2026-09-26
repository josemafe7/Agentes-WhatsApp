// Business secrets at rest: AES-256-GCM with APP_ENCRYPTION_KEY (docs/security.md «Secretos del negocio»).
// Stored as "v1:<iv b64>:<tag b64>:<ciphertext b64>", with a new random IV each time.
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const FORMAT_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MASK = "••••";
const MASK_VISIBLE_CHARS = 4;
/** Below this length, showing the last characters would reveal too much of the secret. */
const MASK_MIN_LENGTH = 8;
const TOKEN_BYTES = 32;

/** APP_ENCRYPTION_KEY is missing or invalid: the app must not start ([SEG-03]). */
export class EncryptionKeyError extends Error {
  constructor() {
    super(
      "APP_ENCRYPTION_KEY falta o no es válida: tiene que ser 32 bytes aleatorios en Base64 " +
        "(por ejemplo, `openssl rand -base64 32`). En local la crea `pnpm run setup` en .env.local.",
    );
    this.name = "EncryptionKeyError";
  }
}

/** A stored secret cannot be read: wrong or changed key, or tampered value ([SEG-03]). */
export class DecryptionError extends Error {
  constructor() {
    super("No se puede leer un secreto guardado: la clave de cifrado cambió o el valor está dañado.");
    this.name = "DecryptionError";
  }
}

function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new EncryptionKeyError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) throw new EncryptionKeyError();
  return key;
}

/** Throws EncryptionKeyError if the key is not usable (for start-up checks). */
export function assertEncryptionKeyConfigured(): void {
  encryptionKey();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const key = encryptionKey();
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) throw new DecryptionError();
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new DecryptionError();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // GCM authentication failed: wrong key or modified value. The cause is not exposed.
    throw new DecryptionError();
  }
}

/** Decrypts, or null when there is nothing stored or it cannot be read (the caller asks to re-enter it). */
export function tryDecryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch (error) {
    if (error instanceof DecryptionError) return null;
    throw error;
  }
}

/** «••••1234»: the most a browser ever sees of a secret, and only owners and admins ([PER-07], [AJU-16]). */
export function maskSecret(secret: string): string {
  if (secret.length < MASK_MIN_LENGTH) return MASK;
  return MASK + secret.slice(-MASK_VISIBLE_CHARS);
}

/** Constant-time string comparison (signatures, cron secret) ([SEG-08]). Lengths are hidden by hashing. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB) && a.length === b.length;
}

/** Random URL-safe token (256 bits) for one-time links. */
export function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex of a token: what the database stores instead of the token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
