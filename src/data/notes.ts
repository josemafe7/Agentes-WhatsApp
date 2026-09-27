// Internal notes of a conversation ([BAN-07]): the team's, clearly apart from the messages and never sent to the
// customer. They keep the author's name if the user is deleted ([USU-15]).
import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { internalNotes } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { parseInput } from "@/server/errors";
import { publishConversationEvent } from "@/server/realtime/events";
import { loadConversationFor } from "./conversation-scope";

export const MAX_NOTE = 4_000;

export type NoteItem = { id: string; authorUserId: string | null; authorName: string | null; text: string; createdAt: Date };

export async function listNotes(actor: Actor, conversationId: string): Promise<NoteItem[]> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, conversationId);
  return db
    .select({ id: internalNotes.id, authorUserId: internalNotes.authorUserId, authorName: internalNotes.authorName, text: internalNotes.text, createdAt: internalNotes.createdAt })
    .from(internalNotes)
    .where(eq(internalNotes.conversationId, conversation.id))
    .orderBy(asc(internalNotes.createdAt));
}

export const addNoteSchema = z
  .object({ conversationId: idSchema, text: z.string().trim().min(1, "Escribe la nota.").max(MAX_NOTE, `Como mucho ${MAX_NOTE} caracteres.`) })
  .strict();

export async function addNote(actor: Actor, input: unknown): Promise<NoteItem> {
  const data = parseInput(addNoteSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.notes, data.conversationId);
  const [row] = await db
    .insert(internalNotes)
    .values({ conversationId: conversation.id, authorUserId: actor.userId, authorName: actor.name, text: data.text })
    .returning({ id: internalNotes.id, authorUserId: internalNotes.authorUserId, authorName: internalNotes.authorName, text: internalNotes.text, createdAt: internalNotes.createdAt });
  await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: conversation.channelId, change: "note" });
  return row;
}
