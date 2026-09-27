// What every tab of the channel panel loads on the server: who is looking and the channel, checked on each request
// ([SEG-04]). The layout is not the security boundary: each page calls this again (deduplicated per request).
import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getChannel, type ChannelDetail } from "@/data/channels";
import { can, PERMISSIONS, type Actor, type Role } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor, type SessionActor } from "@/server/session";
import { channelPath } from "../../_lib/webchat";

/** The channel (never its secrets, only whether it has any), or the «not found» page for an unknown or malformed id. */
export const loadPanelChannel = cache(async (actor: Actor, channelId: string): Promise<ChannelDetail> => {
  try {
    return await getChannel(actor, channelId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

export type ChannelPage =
  | { allowed: true; actor: SessionActor; channel: ChannelDetail; /** Owner and admin; Solo lectura only looks. */ canManage: boolean }
  | { allowed: false; role: Role };

/** Session (or /login coming back to this tab), permission to see channels ([PER-04]) and the channel. */
export async function loadChannelPage(params: Promise<{ id: string }>, segment = ""): Promise<ChannelPage> {
  const { id } = await params;
  const actor = await requirePageActor({ next: channelPath(encodeURIComponent(id), segment) });
  if (!can(actor, PERMISSIONS.channels.view)) return { allowed: false, role: actor.role };
  const channel = await loadPanelChannel(actor, id);
  return { allowed: true, actor, channel, canManage: can(actor, PERMISSIONS.channels.manage) };
}
