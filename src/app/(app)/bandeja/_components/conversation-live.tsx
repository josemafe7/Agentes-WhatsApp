"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { requestRealtimePoll, useRealtime } from "@/hooks/use-realtime";
import { markReadAction } from "../actions";

/** News of the same conversation often come together (message, status, «leída»): one refresh for all. */
const REFRESH_DELAY_MS = 300;

/**
 * Keeps the open conversation up to date ([BAN-03]): refreshes it when its news arrive, and marks it read when it
 * opens and when the customer writes while it is on screen ([BAN-04]). Renders nothing.
 */
export function ConversationLive({ conversationId, markRead }: { conversationId: string; markRead: boolean }) {
  const router = useRouter();
  const timer = useRef<number | null>(null);
  const newInbound = useRef(false);

  useEffect(() => {
    if (!markRead) return;
    void markReadAction({ conversationId }).then((result) => {
      // The list hears the change at once instead of on its next poll.
      if (result.ok && result.data?.changed) requestRealtimePoll();
    });
  }, [conversationId, markRead]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  useRealtime((events) => {
    // «leída» is this screen's own doing: nothing new to show.
    const mine = events.filter((event) => event.type !== "notification.created" && event.conversationId === conversationId && !(event.type === "conversation.updated" && event.change === "read"));
    if (mine.length === 0) return;
    if (mine.some((event) => event.type === "message.created" && event.direction === "inbound")) newInbound.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      router.refresh();
      if (newInbound.current && markRead && document.visibilityState === "visible") void markReadAction({ conversationId });
      newInbound.current = false;
    }, REFRESH_DELAY_MS);
  });

  return null;
}
