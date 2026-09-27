"use client";

import { ArrowDown, LoaderCircle, StickyNote } from "lucide-react";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MessageSourcesByMessage } from "@/data/message-sources";
import type { MessageItem } from "@/data/messages";
import type { NoteItem } from "@/data/notes";
import type { ChannelType } from "@/lib/enums";
import { formatDateTime } from "@/lib/format";
import { ConvertToFaq } from "../[id]/_sources/convert-to-faq";
import { isConvertibleReply } from "../[id]/_sources/permissions";
import { WhyAnswerSheet } from "../[id]/_sources/why-answer-sheet";
import { loadOlderMessagesAction, retryMessageAction } from "../actions";
import { buildTimeline, mergeMessages } from "../_lib/timeline";
import { DraftReview } from "./draft-review";
import { MessageBubble } from "./message-bubble";
import { ACTION_FAILED, useInboxAction } from "./use-inbox-action";

/** Close enough to the end to follow new messages. */
const AT_BOTTOM_PX = 48;

type MessageTimelineProps = {
  conversationId: string;
  /** Latest page from the server; refreshed when news arrive. */
  messages: MessageItem[];
  hasMore: boolean;
  sources: MessageSourcesByMessage;
  notes: NoteItem[];
  channel: { type: ChannelType; name: string };
  contactName: string | null;
  timezone: string;
  now: Date;
  canRetry: boolean;
  /** Approve, edit or discard the AI's drafts ([CAN-07], [MOT-14]). */
  canReviewDrafts: boolean;
  canOpenDocuments: boolean;
  /** «Convertir en FAQ» on the people's replies ([CON-22]). */
  canConvertFaq?: boolean;
};

/**
 * Messages and internal notes of the conversation ([BAN-05]–[BAN-07], [BAN-13]). New messages come in without moving
 * what is being read; away from the end, «Nuevos mensajes» takes you there (DESIGN.md «Tiempo real»).
 */
export function MessageTimeline(props: MessageTimelineProps) {
  const { conversationId, messages, hasMore, sources, notes, channel, contactName, timezone, now, canRetry, canReviewDrafts, canOpenDocuments, canConvertFaq = false } = props;
  // Every message seen since the conversation opened, so fresh pages never leave a gap with older ones.
  const [known, setKnown] = useState(messages);
  const [latest, setLatest] = useState(messages);
  if (messages !== latest) {
    setLatest(messages);
    setKnown((previous) => mergeMessages(previous, messages));
  }
  const [older, setOlder] = useState<{ items: MessageItem[]; hasMore: boolean; sources: MessageSourcesByMessage } | null>(null);
  const [loadingOlder, startLoadingOlder] = useTransition();
  // AI answer whose «¿Por qué respondió esto?» is open.
  const [whyMessageId, setWhyMessageId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Drafts discarded here: gone at once, even before the refreshed page arrives.
  const [discarded, setDiscarded] = useState<ReadonlySet<string>>(() => new Set());
  const retry = useInboxAction();

  const all = mergeMessages(older?.items ?? [], known).filter((message) => !discarded.has(message.id));
  const allSources: MessageSourcesByMessage = { ...older?.sources, ...sources };
  const moreToLoad = older ? older.hasMore : hasMore;
  const timeline = buildTimeline(all, notes, { timezone, now, complete: !moreToLoad });
  const lastId = all.at(-1)?.id;

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [seenUpTo, setSeenUpTo] = useState(lastId);
  const restoreFromBottom = useRef<number | null>(null);
  const shownLast = useRef<string | undefined>(undefined);

  // Opening: at the end. New message: follow it if the person was at the end or just wrote it.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const newest = all.at(-1);
    const first = shownLast.current === undefined;
    const mine = newest?.direction === "outbound" && newest.senderType === "human";
    if (first || (lastId !== shownLast.current && (atBottom.current || mine))) element.scrollTop = element.scrollHeight;
    shownLast.current = lastId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the newest message changes
  }, [lastId]);

  // Older messages added on top: keep the same message in view.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || restoreFromBottom.current === null) return;
    element.scrollTop = element.scrollHeight - restoreFromBottom.current;
    restoreFromBottom.current = null;
  }, [older]);

  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < AT_BOTTOM_PX;
    if (atBottom.current && seenUpTo !== lastId) setSeenUpTo(lastId);
  }

  const seenIndex = all.findIndex((message) => message.id === seenUpTo);
  const unseen = seenIndex === -1 ? 0 : all.slice(seenIndex + 1).filter((message) => message.direction === "inbound").length;

  function goToEnd() {
    const element = scroller.current;
    if (!element) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function loadOlder() {
    const before = all[0]?.id;
    if (!before) return;
    startLoadingOlder(async () => {
      let result: Awaited<ReturnType<typeof loadOlderMessagesAction>> | null;
      try {
        result = await loadOlderMessagesAction({ conversationId, before });
      } catch {
        result = null;
      }
      if (!result?.ok || !result.data) {
        toast.error(result && !result.ok ? result.error : ACTION_FAILED);
        return;
      }
      const page = result.data;
      const element = scroller.current;
      if (element) restoreFromBottom.current = element.scrollHeight - element.scrollTop;
      setOlder((previous) => ({
        items: mergeMessages(page.items, previous?.items ?? []),
        hasMore: page.hasMore,
        sources: { ...previous?.sources, ...page.sources },
      }));
    });
  }

  function retryMessage(messageId: string) {
    setRetryingId(messageId);
    retry.run(() => retryMessageAction({ messageId }), {
      onSuccess: (data) => {
        if (data?.status === "failed") toast.error("Sigue sin poder enviarse. Revisa el canal y vuelve a intentarlo.", { duration: Infinity });
      },
    });
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} role="log" aria-label="Mensajes de la conversación" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {moreToLoad ? (
          <div className="flex justify-center pb-4">
            <Button type="button" variant="outline" size="sm" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {loadingOlder ? "Cargando…" : "Cargar mensajes anteriores"}
            </Button>
          </div>
        ) : null}
        {all.length === 0 && notes.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay mensajes en esta conversación.</p> : null}
        <div className="flex flex-col gap-3">
          {timeline.map((item) => {
            if (item.kind === "day") {
              return (
                <div key={item.key} role="separator" className="flex items-center gap-3 py-1 text-xs font-medium text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {item.label}
                  <span className="h-px flex-1 bg-border" />
                </div>
              );
            }
            if (item.kind === "note") return <InternalNote key={item.key} note={item.note} timezone={timezone} />;
            const message = item.message;
            const messageSources = allSources[message.id];
            return (
              <MessageBubble
                key={item.key}
                message={message}
                first={item.first}
                last={item.last}
                channel={channel}
                contactName={contactName}
                timezone={timezone}
                hasSources={Boolean(messageSources?.length)}
                onShowSources={() => setWhyMessageId(message.id)}
                actions={canConvertFaq && isConvertibleReply(message) ? <ConvertToFaq conversationId={conversationId} messageId={message.id} /> : null}
                onRetry={canRetry ? () => retryMessage(message.id) : null}
                retrying={retry.pending && retryingId === message.id}
                draftReview={
                  canReviewDrafts && message.status === "draft" ? (
                    <DraftReview message={message} onDiscarded={(id) => setDiscarded((previous) => new Set(previous).add(id))} />
                  ) : null
                }
              />
            );
          })}
        </div>
      </div>
      {unseen > 0 ? (
        <Button type="button" size="sm" onClick={goToEnd} className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md">
          <ArrowDown aria-hidden />
          {unseen === 1 ? "1 mensaje nuevo" : `${unseen} mensajes nuevos`}
        </Button>
      ) : null}
      <WhyAnswerSheet conversationId={conversationId} messageId={whyMessageId} onClose={() => setWhyMessageId(null)} canOpenDocuments={canOpenDocuments} />
    </div>
  );
}

/** «Nota interna · solo la ve el equipo»: full width, dashed, never sent to the customer ([BAN-07]). */
function InternalNote({ note, timezone }: { note: NoteItem; timezone: string }) {
  return (
    <div className="rounded-lg border border-dashed border-warning bg-warning-soft px-3 py-2 text-base md:text-sm">
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs font-medium text-warning">
        <StickyNote aria-hidden className="size-3.5" />
        Nota interna · solo la ve el equipo
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words">{note.text}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {note.authorName ?? "Persona borrada"} · <time dateTime={note.createdAt.toISOString()}>{formatDateTime(note.createdAt, timezone, { preset: "time" })}</time>
      </p>
    </div>
  );
}
