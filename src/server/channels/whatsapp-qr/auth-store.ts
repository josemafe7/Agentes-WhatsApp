// Where the session of a linked number lives between restarts ([QR-04], [SEG-01], docs/integracion-whatsapp-qr.md
// «Sesión»). The library only keeps it in memory: here its two halves are persisted, always encrypted with
// APP_ENCRYPTION_KEY — the device's own credentials in the channel's `secrets_enc`, and the Signal keys (one per
// contact and device, changing with every message) in `whatsapp_qr_keys`. A batch of key changes is written in ONE
// transaction: half a batch would break the session for good. Nothing here is ever logged.
import "server-only";
import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type SignalDataSet, type SignalDataTypeMap, type SignalKeyStore } from "baileys";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { channels, whatsappQrKeys } from "@/db/schema";
import { encryptSecret, tryDecryptSecret } from "@/server/crypto";
import type { ChannelRecord } from "../types";
import { encryptQrCreds, readQrCredsText } from "./config";

/** Rows per statement when a batch is big (the first pre-keys, a long history of contacts). */
const ROWS_PER_STATEMENT = 200;

function chunked<T>(items: readonly T[], size = ROWS_PER_STATEMENT): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/** The library's own serialization: binary values travel as Base64 inside JSON. */
const serialize = (value: unknown) => JSON.stringify(value, BufferJSON.replacer);

function deserialize(text: string): unknown {
  try {
    return JSON.parse(text, BufferJSON.reviver) as unknown;
  } catch {
    return undefined;
  }
}

/** Credentials of a device that is not linked yet (it shows a QR code). */
export const newQrCreds = (): AuthenticationCreds => initAuthCreds();

/** The channel's stored credentials, or null (never linked, erased, or unreadable after a key change). */
export function loadQrCreds(channel: Pick<ChannelRecord, "secretsEnc">): AuthenticationCreds | null {
  const text = readQrCredsText(channel);
  const creds = text ? deserialize(text) : undefined;
  return creds && typeof creds === "object" ? (creds as AuthenticationCreds) : null;
}

/** Whether these credentials are of a device WhatsApp already accepted (the QR was scanned). */
export const isLinked = (creds: Pick<AuthenticationCreds, "me"> | null): boolean => Boolean(creds?.me?.id);

export async function saveQrCreds(channelId: string, creds: AuthenticationCreds, executor: Executor = db): Promise<void> {
  await executor.update(channels).set({ secretsEnc: encryptQrCreds(serialize(creds)), updatedAt: new Date() }).where(eq(channels.id, channelId));
}

/** Erases the whole session: credentials and keys. The number has to be linked again. */
export async function deleteQrSession(channelId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(whatsappQrKeys).where(eq(whatsappQrKeys.channelId, channelId));
    await tx.update(channels).set({ secretsEnc: null, updatedAt: new Date() }).where(eq(channels.id, channelId));
  });
}

/** Only the keys (a channel being deleted takes its row with it). */
export async function deleteQrKeys(channelId: string, executor: Executor = db): Promise<void> {
  await executor.delete(whatsappQrKeys).where(eq(whatsappQrKeys.channelId, channelId));
}

/** The Signal key store of one channel, as the library asks for it. */
export function createQrKeyStore(channelId: string): SignalKeyStore {
  return {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
      const found: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const chunk of chunked([...new Set(ids)])) {
        const rows = await db
          .select({ keyId: whatsappQrKeys.keyId, valueEnc: whatsappQrKeys.valueEnc })
          .from(whatsappQrKeys)
          .where(and(eq(whatsappQrKeys.channelId, channelId), eq(whatsappQrKeys.type, type), inArray(whatsappQrKeys.keyId, chunk)));
        for (const row of rows) {
          // A key that cannot be read (the encryption key changed) is a key that is missing.
          const plain = tryDecryptSecret(row.valueEnc);
          const value = plain === null ? undefined : deserialize(plain);
          if (value === undefined || value === null) continue;
          // The reference store rebuilds this one type from its plain object.
          found[row.keyId] = (type === "app-state-sync-key" ? proto.Message.AppStateSyncKeyData.fromObject(value as object) : value) as SignalDataTypeMap[T];
        }
      }
      return found;
    },

    async set(data: SignalDataSet): Promise<void> {
      const upserts: { type: string; keyId: string; valueEnc: string }[] = [];
      const deletions = new Map<string, string[]>();
      for (const [type, entries] of Object.entries(data)) {
        for (const [keyId, value] of Object.entries(entries ?? {})) {
          if (value === null || value === undefined) deletions.set(type, [...(deletions.get(type) ?? []), keyId]);
          else upserts.push({ type, keyId, valueEnc: encryptSecret(serialize(value)) });
        }
      }
      if (upserts.length === 0 && deletions.size === 0) return;
      const now = new Date();
      await db.transaction(async (tx) => {
        for (const [type, keyIds] of deletions) {
          for (const chunk of chunked(keyIds)) await tx.delete(whatsappQrKeys).where(and(eq(whatsappQrKeys.channelId, channelId), eq(whatsappQrKeys.type, type), inArray(whatsappQrKeys.keyId, chunk)));
        }
        for (const chunk of chunked(upserts)) {
          await tx
            .insert(whatsappQrKeys)
            .values(chunk.map((row) => ({ channelId, ...row, createdAt: now, updatedAt: now })))
            .onConflictDoUpdate({ target: [whatsappQrKeys.channelId, whatsappQrKeys.type, whatsappQrKeys.keyId], set: { valueEnc: sql`excluded.value_enc`, updatedAt: now } });
        }
      });
    },

    async clear(): Promise<void> {
      await deleteQrKeys(channelId);
    },
  };
}
