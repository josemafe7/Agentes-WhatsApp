"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { EmailMessageView, EmailThreadView } from "@/data/email-drafts";
import { loadEmailDetailsAction } from "./actions";

type EmailThreadState = {
  thread: EmailThreadView;
  /** The emails' details: the first page from the server, older ones as «Cargar anteriores» brings them. */
  details: Readonly<Record<string, EmailMessageView>>;
  /** Asks once for the details of a message that came with an older page. */
  request: (messageId: string) => void;
};

const EmailThreadContext = createContext<EmailThreadState | null>(null);

/** The open conversation's email thread, or null when it is not an email conversation. */
export function useEmailThread(): EmailThreadState | null {
  return useContext(EmailThreadContext);
}

/**
 * Makes the email thread ([BAN-09]) available to the messages of the timeline, which show each email as a card. Without
 * a thread (other channels) it only renders its children.
 */
export function EmailThreadProvider({ thread, children }: { thread: EmailThreadView | null; children: ReactNode }) {
  const [older, setOlder] = useState<Record<string, EmailMessageView>>({});
  const asked = useRef(new Set<string>());
  const waiting = useRef(new Set<string>());
  const timer = useRef<number | null>(null);
  const conversationId = thread?.conversationId ?? null;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const request = useCallback(
    (messageId: string) => {
      if (!conversationId || asked.current.has(messageId)) return;
      asked.current.add(messageId);
      waiting.current.add(messageId);
      if (timer.current !== null) return;
      // Every message of a page asks in the same moment: one call for all of them.
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const messageIds = [...waiting.current];
        waiting.current.clear();
        // Until the details arrive (or if they cannot be read) the message shows as a plain one; a failed batch is asked
        // again the next time those messages render.
        const retryLater = () => messageIds.forEach((id) => asked.current.delete(id));
        loadEmailDetailsAction({ conversationId, messageIds }).then((result) => {
          if (!result.ok || !result.data) return retryLater();
          const found = result.data;
          setOlder((previous) => ({ ...previous, ...found }));
        }, retryLater);
      }, 0);
    },
    [conversationId],
  );

  if (!thread) return children;
  return <EmailThreadContext.Provider value={{ thread, details: { ...older, ...thread.messages }, request }}>{children}</EmailThreadContext.Provider>;
}
