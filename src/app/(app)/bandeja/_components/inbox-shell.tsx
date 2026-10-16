"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Inbox columns (DESIGN.md «Layout › Bandeja»): list 360 px | conversation (| contact card, inside the conversation)
 * from 1280 px; list 320 px | conversation from 768 px; on the phone the list is one screen and the conversation
 * another. It fills what the page has left under the top bar and the notices over it (and over the bottom bar on the
 * phone list), cancelling the page padding of the app shell, so each column scrolls on its own and the composer is
 * always in sight. The app shell lays the page out as a column for whatever is marked `data-fill-height`.
 *
 * With a conversation open, the list stays next to it only while the conversation keeps 400 px (720 px for both,
 * measured here and not on the window: the menu takes a different width folded and open). Narrower (a phone, or a
 * tablet with the menu open) the conversation is the whole screen, with its «Atrás».
 */
export function InboxShell({ list, children }: { list: ReactNode; children: ReactNode }) {
  const inConversation = useSelectedLayoutSegment() !== null;
  return (
    <div
      data-fill-height
      data-conversation={inConversation ? "" : undefined}
      className={cn(
        "@container/inbox -mx-4 -mt-6 flex min-h-0 grow basis-0 overflow-hidden md:-mx-6 md:-mb-8",
        // Inside a conversation the bottom bar is hidden: the conversation takes its place too.
        inConversation ? "-mb-[calc(3.5rem+env(safe-area-inset-bottom)+1.5rem)]" : "-mb-6",
      )}
    >
      <div className={cn("min-h-0 w-full flex-col border-r md:w-80 md:shrink-0 xl:w-[360px]", inConversation ? "hidden @min-[45rem]/inbox:flex" : "flex")}>{list}</div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", inConversation ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}
