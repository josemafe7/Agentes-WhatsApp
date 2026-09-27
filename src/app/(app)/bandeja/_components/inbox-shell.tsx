"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Inbox columns (DESIGN.md «Layout › Bandeja»): list 360 px | conversation (| contact card, inside the conversation)
 * from 1280 px; list 320 px | conversation from 768 px; on the phone the list is one screen and the conversation
 * another. It fills the height left by the top bar (and the bottom bar on the phone list), cancelling the page
 * padding of the app shell so each column scrolls on its own.
 */
export function InboxShell({ list, children }: { list: ReactNode; children: ReactNode }) {
  const inConversation = useSelectedLayoutSegment() !== null;
  return (
    <div
      className={cn(
        "-mx-4 -mt-6 -mb-[calc(3.5rem+env(safe-area-inset-bottom)+1.5rem)] flex min-h-0 overflow-hidden",
        "md:-mx-6 md:-mb-8 md:h-[calc(100svh-var(--app-banner-h)-3.5rem)]",
        inConversation ? "h-[calc(100svh-var(--app-banner-h)-3.5rem)]" : "h-[calc(100svh-var(--app-banner-h)-7rem-env(safe-area-inset-bottom))]",
      )}
    >
      <div className={cn("min-h-0 w-full flex-col border-r md:flex md:w-80 md:shrink-0 xl:w-[360px]", inConversation ? "hidden" : "flex")}>{list}</div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", inConversation ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}
