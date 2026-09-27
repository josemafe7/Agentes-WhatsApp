// Channel credentials live encrypted in `channels.secrets_enc`, apart from the non-secret config ([CAN-17], [SEG-01]).
// Only adapters read them, on the server, right before calling the service; never in logs or the browser.
import "server-only";
import type { z } from "zod";
import { encryptSecret, tryDecryptSecret } from "@/server/crypto";
import type { ChannelRecord } from "./types";

/** Encrypts the channel's secrets object for `secrets_enc`. */
export function encryptChannelSecrets(secrets: Record<string, unknown>): string {
  return encryptSecret(JSON.stringify(secrets));
}

/**
 * The channel's secrets validated with `schema`, or null when there are none, they cannot be decrypted (the
 * encryption key changed: the channel must reconnect, [SEG-03]) or they do not match the schema.
 */
export function readChannelSecrets<T extends z.ZodType>(channel: Pick<ChannelRecord, "secretsEnc">, schema: T): z.infer<T> | null {
  const plain = tryDecryptSecret(channel.secretsEnc);
  if (plain === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(plain);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
