"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import { loadInboxUnreadAction } from "./actions";

/** More than this shows «99+». */
const MAX_BADGE = 99;
/** Several events of one burst (a message, its conversation…) ask the server once. */
const RELOAD_DELAY_MS = 400;

const InboxUnreadContext = createContext<number | null>(null);

/**
 * The unread counter of «Bandeja» for the whole shell ([BAN-03], DESIGN.md «Navegación»): the server gives the first
 * value and it follows the conversation events of /api/realtime, so the side menu and the bottom bar share one
 * request. `initial` is null when the role does not see the inbox: then nothing is asked.
 */
export function InboxUnreadProvider({ initial, children }: { initial: number | null; children: ReactNode }) {
  const [count, setCount] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void loadInboxUnreadAction().then(
        (result) => {
          if (result.ok && typeof result.data === "number") setCount(result.data);
        },
        () => undefined,
      );
    }, RELOAD_DELAY_MS);
  }, []);
  useRealtime(
    (events) => {
      if (events.some((event) => event.type === "conversation.updated" || event.type === "message.created")) reload();
    },
    { enabled: initial !== null },
  );
  return <InboxUnreadContext.Provider value={count}>{children}</InboxUnreadContext.Provider>;
}

export function useInboxUnread(): number | null {
  return useContext(InboxUnreadContext);
}

/** «12» (or «99+») next to Bandeja; nothing when all is read. Screen readers get InboxUnreadDescription instead. */
export function InboxUnreadBadge({ className }: { className?: string }) {
  const count = useInboxUnread();
  if (!count) return null;
  return (
    <span aria-hidden className={cn("rounded-full bg-primary px-1.5 text-xs leading-5 font-medium text-primary-foreground tabular-nums", className)}>
      {count > MAX_BADGE ? `${MAX_BADGE}+` : count}
    </span>
  );
}

/**
 * The counter in words, for the link's aria-describedby: the link keeps its name «Bandeja» and screen readers hear
 * «3 conversaciones sin leer» after it.
 */
export function InboxUnreadDescription({ id }: { id: string }) {
  const count = useInboxUnread();
  return (
    <span id={id} className="sr-only">
      {count ? (count === 1 ? "1 conversación sin leer" : `${count} conversaciones sin leer`) : ""}
    </span>
  );
}
