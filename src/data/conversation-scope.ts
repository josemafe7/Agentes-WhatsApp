// Access to one conversation for an actor ([SEG-04], [PER-02], [PER-03]): the area permission first (so a Solo
// lectura write fails before reading anything), then the conversation's channel. A missing conversation, a test
// one or one of another channel all answer «no permission», so nobody learns whether it exists (docs/pantallas.md).
import "server-only";
import { eq } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { conversations } from "@/db/schema";
import type { Action, Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { AuthError } from "@/server/errors";
import { assertCan } from "./guard";

export type ScopedConversation = typeof conversations.$inferSelect & { channelId: string };

export async function loadConversationFor(actor: Actor, action: Action, conversationId: unknown, executor: Executor = db): Promise<ScopedConversation> {
  assertCan(actor, action);
  const id = idSchema.safeParse(conversationId);
  if (!id.success) throw new AuthError("forbidden");
  const [row] = await executor.select().from(conversations).where(eq(conversations.id, id.data));
  if (!row || !row.channelId || row.isTest) throw new AuthError("forbidden");
  assertCan(actor, action, { channelId: row.channelId });
  return { ...row, channelId: row.channelId };
}
