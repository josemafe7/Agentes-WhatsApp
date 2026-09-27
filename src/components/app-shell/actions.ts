"use server";
// Server Action of the app shell: the unread counter of «Bandeja» in the menus ([BAN-03], DESIGN.md «Navegación»).
// Thin: session and permission here, then src/data/conversations.ts, which counts only the actor's channels ([PER-02]).
import { getInboxCounts } from "@/data/conversations";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

/** Conversations with messages nobody has read yet, in the channels the person sees. */
export async function loadInboxUnreadAction(): Promise<ActionResult<number>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.view);
    return ok((await getInboxCounts(actor)).unreadConversations);
  } catch (error) {
    return toActionFailure(error);
  }
}
