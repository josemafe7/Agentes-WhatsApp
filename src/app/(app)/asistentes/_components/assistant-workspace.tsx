"use client";

import { Bot, ChevronDown, CircleAlert, FileText, KeyRound, Library, LoaderCircle, Lock, MessageSquarePlus, RotateCcw, SendHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { toast } from "sonner";
import { fragmentPlace } from "@/app/(app)/bandeja/[id]/_sources/presentation";
import { AI_SETTINGS_HREF } from "@/components/banners/openrouter-banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MarkdownText } from "@/components/markdown-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AssistantSource } from "@/db/schema";
import type { AssistantMessageRole } from "@/lib/enums";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  askAssistantAction,
  deleteAssistantChatAction,
  loadEarlierAssistantMessagesAction,
  loadMoreAssistantChatsAction,
  type AskAssistantActionResult,
} from "../actions";
import { assistantPath } from "../_lib/paths";

/** Same as MAX_QUESTION_CHARS of src/data/assistants.ts (server-only), repeated here for the field. */
const MAX_QUESTION_CHARS = 4_000;
const SEND_FAILED = "No se ha podido enviar la pregunta. Vuelve a intentarlo.";
const LOAD_FAILED = "No se ha podido cargar. Vuelve a intentarlo.";
const NO_KEY_ID = "asistente-sin-clave";
/** Space kept above the question the conversation is moved to (the padding of the log). */
const LOG_PADDING_PX = 16;

export type WorkspaceMessage = { id: string; role: AssistantMessageRole; content: string; sources: AssistantSource[] };
/** `updatedAt`: ISO date of its last question. */
export type WorkspaceChat = { id: string; title: string; updatedAt: string };
export type WorkspaceOpenChat = WorkspaceChat & { messages: WorkspaceMessage[]; hasEarlier: boolean };

type AssistantWorkspaceProps = {
  assistant: { id: string; name: string };
  /** This person's conversations with the assistant, newest first: the first ones. */
  chats: WorkspaceChat[];
  /** There are older conversations than those: «Cargar más» brings them ([INT-10]). */
  moreChats: boolean;
  /** The conversation of the address with its last messages, or null for a new one. */
  openChat: WorkspaceOpenChat | null;
  /** Time zone of the business and the moment the page was rendered: the dates of the list are told from them. */
  timezone: string;
  renderedAt: string;
  /** There is an OpenRouter key: without it nothing can be sent ([INT-11]). */
  aiConfigured: boolean;
  /** What the no-key note offers: "manage" links to Ajustes › IA, "ask" tells to ask the owner ([ARR-14]). */
  keyHelp: "manage" | "ask";
};

/** What the conversation pane was opened with; `view` changes whenever another conversation takes its place. */
type Pane = { view: number; initial: WorkspaceOpenChat | null; chatId: string | null };

/**
 * A person's conversations with one internal agent and the chat ([INT-07], [INT-09]–[INT-12]). The list lives here
 * and stays as it is from one conversation to another (what «Cargar más» brought included); the chat is the pane
 * below, a new one for each conversation that is opened.
 */
export function AssistantWorkspace({ assistant, chats: initialChats, moreChats, openChat, timezone, renderedAt, aiConfigured, keyHelp }: AssistantWorkspaceProps) {
  const router = useRouter();
  const [chats, setChats] = useState(initialChats);
  const [hasMoreChats, setHasMoreChats] = useState(moreChats);
  const [loadingChats, setLoadingChats] = useState(false);
  /** From when «hace 5 min» is counted: the render of the page at first, the moment of each change after it. */
  const [now, setNow] = useState(renderedAt);
  /** The conversation whose deletion is being confirmed. */
  const [deleting, setDeleting] = useState<WorkspaceChat | null>(null);
  const openChatId = openChat?.id ?? null;
  const [pane, setPane] = useState<Pane>({ view: 0, initial: openChat, chatId: openChatId });
  const [seenOpenChatId, setSeenOpenChatId] = useState(openChatId);

  // The address now names another conversation (a link of the list, «Atrás»): a fresh pane with what the server sent.
  // When it only caught up with the conversation already on screen (its first question gave it an address), nothing
  // changes: what was being read or written stays.
  if (openChatId !== seenOpenChatId) {
    setSeenOpenChatId(openChatId);
    if (openChatId !== pane.chatId) setPane({ view: pane.view + 1, initial: openChat, chatId: openChatId });
  }

  /** An empty chat in place of the one on screen. */
  function startNew() {
    setPane((previous) => ({ view: previous.view + 1, initial: null, chatId: null }));
  }

  /** A question got its answer: its conversation goes first in the list; `started`: it is the one on screen and just began. */
  function onAnswered(chat: { id: string; title: string; updatedAt: Date }, started: boolean) {
    const item = { id: chat.id, title: chat.title, updatedAt: chat.updatedAt.toISOString() };
    setChats((previous) => [item, ...previous.filter((other) => other.id !== chat.id)]);
    setNow(new Date().toISOString());
    if (!started) return;
    setPane((previous) => ({ ...previous, chatId: chat.id }));
    // Its address, so that reloading or coming back with «Atrás» opens it; the pane stays as it is.
    router.replace(assistantPath(assistant.id, chat.id), { scroll: false });
  }

  async function removeChat(chat: WorkspaceChat) {
    const result = await deleteAssistantChatAction({ chatId: chat.id });
    if (!result.ok) {
      // Said once, with the reason; the dialog closes.
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Conversación borrada.");
    setChats((previous) => previous.filter((item) => item.id !== chat.id));
    if (chat.id === pane.chatId) {
      startNew();
      router.replace(assistantPath(assistant.id), { scroll: false });
    }
  }

  /** «Cargar más»: the conversations after the last one listed ([INT-10]); the first ones again when none is left. */
  async function loadMoreChats() {
    if (loadingChats) return;
    setLoadingChats(true);
    let result: Awaited<ReturnType<typeof loadMoreAssistantChatsAction>> | null;
    try {
      result = await loadMoreAssistantChatsAction({ agentId: assistant.id, before: chats.at(-1)?.id });
    } catch {
      result = null;
    }
    setLoadingChats(false);
    if (!result?.ok || !result.data) {
      toast.error(result && !result.ok ? result.error : LOAD_FAILED);
      return;
    }
    const page = result.data;
    setChats((previous) => {
      const listed = new Set(previous.map((chat) => chat.id));
      return [...previous, ...page.chats.filter((chat) => !listed.has(chat.id)).map(({ id, title, updatedAt }) => ({ id, title, updatedAt: updatedAt.toISOString() }))];
    });
    setHasMoreChats(page.hasMore);
    setNow(new Date().toISOString());
  }

  // An old conversation opened by its address may not be among the ones listed yet: it is shown anyway, last.
  const openItem = pane.initial && pane.initial.id === pane.chatId && !chats.some((chat) => chat.id === pane.chatId) ? pane.initial : null;
  const listed = openItem ? [...chats, { id: openItem.id, title: openItem.title, updatedAt: openItem.updatedAt }] : chats;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* The chat goes first in the page (and on a phone); on a wide screen the list is on its left. */}
      <ConversationPane
        key={pane.view}
        assistant={assistant}
        initial={pane.initial}
        aiConfigured={aiConfigured}
        keyHelp={keyHelp}
        onAnswered={onAnswered}
      />

      <nav aria-labelledby="mis-conversaciones" className="flex min-w-0 flex-col gap-3 lg:order-first">
        <Button asChild variant="outline" className="justify-start">
          <Link
            href={assistantPath(assistant.id)}
            onClick={() => {
              if (pane.chatId !== null) startNew();
            }}
          >
            <MessageSquarePlus aria-hidden />
            Nueva conversación
          </Link>
        </Button>
        <h2 id="mis-conversaciones" className="text-sm font-medium">
          Tus conversaciones
        </h2>
        {listed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aquí aparecerán las preguntas que le hagas.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1">
            {listed.map((chat) => {
              const current = chat.id === pane.chatId;
              return (
                <li
                  key={chat.id}
                  className={cn("relative flex min-w-0 items-center gap-1 rounded-lg border-l-2 border-transparent pr-1 has-focus-visible:ring-3 has-focus-visible:ring-ring/50", current && "border-primary bg-primary-soft")}
                >
                  <div className="grid min-w-0 flex-1 gap-0.5 px-3 py-2 pointer-coarse:py-3">
                    {/* The whole row is the link (its name is the title alone); the bin sits above it. */}
                    <Link
                      href={assistantPath(assistant.id, chat.id)}
                      aria-current={current ? "page" : undefined}
                      title={chat.title}
                      className="truncate text-sm outline-none after:absolute after:inset-0 after:rounded-lg"
                    >
                      {chat.title}
                    </Link>
                    <time dateTime={chat.updatedAt} className="text-xs text-muted-foreground tabular-nums">
                      {formatRelative(chat.updatedAt, timezone, now)}
                    </time>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Borrar la conversación «${chat.title}»`}
                        className="relative z-10 shrink-0 pointer-coarse:size-11"
                        onClick={() => setDeleting(chat)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Borrar conversación</TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}
        {hasMoreChats ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMoreChats()} disabled={loadingChats}>
            {loadingChats ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            {loadingChats ? "Cargando…" : "Cargar más"}
          </Button>
        ) : null}
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          title="¿Borrar esta conversación?"
          description={deleting ? `Se borran las preguntas y las respuestas de «${deleting.title}». No se puede deshacer.` : undefined}
          confirmLabel="Borrar"
          destructive
          onConfirm={async () => {
            if (deleting) await removeChat(deleting);
          }}
        />
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
          Solo tú ves tus conversaciones. Tu empresa ve cuánto se usa cada asistente, no lo que preguntas.
        </p>
      </nav>
    </div>
  );
}

type ConversationPaneProps = {
  assistant: { id: string; name: string };
  /** The conversation it opens with, or null for a new one. */
  initial: WorkspaceOpenChat | null;
  aiConfigured: boolean;
  keyHelp: "manage" | "ask";
  onAnswered: (chat: { id: string; title: string; updatedAt: Date }, started: boolean) => void;
};

type FailedQuestion = { text: string; message: string; /** Asking the same again can work. */ retry: boolean };

/**
 * The chat with one conversation. A question is sent with what is already saved on the server; the answer comes back
 * with its sources. A question that could not be answered is not saved: it stays here, to retry when that can help.
 * While it answers nothing else is held: the person can open another conversation or leave, and the answer is saved
 * all the same.
 */
function ConversationPane({ assistant, initial, aiConfigured, keyHelp, onAnswered }: ConversationPaneProps) {
  const [chatId, setChatId] = useState<string | null>(initial?.id ?? null);
  const [messages, setMessages] = useState<WorkspaceMessage[]>(initial?.messages ?? []);
  const [hasEarlier, setHasEarlier] = useState(initial?.hasEarlier ?? false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  /** A question that got no answer: shown with its error until it is retried or another one is sent. */
  const [failed, setFailed] = useState<FailedQuestion | null>(null);
  /** The question being answered. */
  const [asking, setAsking] = useState<string | null>(null);
  /** The server said there is no key any more, whatever the page was rendered with. */
  const [keyRemoved, setKeyRemoved] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastQuestionRef = useRef<HTMLDivElement>(null);
  /** Where the conversation is left after the next change: its end, the start of the last question, or this far from the end. */
  const scrollTarget = useRef<"end" | "question" | number>("end");
  /** False once this pane is gone: an answer that arrives then is saved, but there is nothing here to show it in. */
  const alive = useRef(true);
  const sending = asking !== null;
  const noKey = !aiConfigured || keyRemoved;
  const canSend = !noKey && !sending && draft.trim().length > 0;
  const lastQuestionId = messages.findLast((message) => message.role === "user")?.id ?? null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Moves the conversation only, never the page. A new answer is left at its question, so a long one is read from
  // its start; anything else, at the end.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const target = scrollTarget.current;
    scrollTarget.current = "end";
    if (typeof target === "number") log.scrollTop = log.scrollHeight - target;
    else if (target === "question" && lastQuestionRef.current) log.scrollTop = lastQuestionRef.current.offsetTop - LOG_PADDING_PX;
    else log.scrollTop = log.scrollHeight;
  }, [messages.length, asking, failed]);

  async function ask(text: string) {
    const askedIn = chatId;
    setFailed(null);
    setAsking(text);
    let result: AskAssistantActionResult | null;
    try {
      result = await askAssistantAction({ agentId: assistant.id, chatId: askedIn, text });
    } catch {
      result = null;
    }
    if (!alive.current) {
      // The person opened something else meanwhile: the answer is saved, and the list is told.
      if (result?.ok) onAnswered(result.data.chat, false);
      return;
    }
    setAsking(null);
    if (result?.ok) {
      const { chat, question, answer } = result.data;
      scrollTarget.current = "question";
      setMessages((previous) => [...previous, toMessage(question), toMessage(answer)]);
      setChatId(chat.id);
      onAnswered(chat, askedIn === null);
      return;
    }
    if (result?.reason === "ai_not_configured") setKeyRemoved(true);
    // Nothing came back (the connection, an unexpected failure): asking again can work.
    setFailed({ text, message: result?.error ?? SEND_FAILED, retry: result ? result.retry === true : true });
  }

  function send() {
    const text = draft.trim();
    if (!text || noKey || sending) return;
    setDraft("");
    void ask(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter adds a line; on touch screens Enter always adds a line, as in the inbox.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    send();
  }

  /** «Cargar mensajes anteriores» of the open conversation. */
  async function loadEarlier() {
    const first = messages[0];
    if (!chatId || !first || loadingEarlier) return;
    setLoadingEarlier(true);
    let result: Awaited<ReturnType<typeof loadEarlierAssistantMessagesAction>> | null;
    try {
      result = await loadEarlierAssistantMessagesAction({ chatId, before: first.id });
    } catch {
      result = null;
    }
    if (!alive.current) return;
    setLoadingEarlier(false);
    if (!result?.ok || !result.data) {
      toast.error(result && !result.ok ? result.error : LOAD_FAILED);
      return;
    }
    const page = result.data;
    setHasEarlier(page.hasEarlier);
    const shown = new Set(messages.map((message) => message.id));
    const earlier = page.messages.filter((message) => !shown.has(message.id)).map(toMessage);
    if (earlier.length === 0) return;
    // What was being read stays in place: the same distance from the end as before.
    const log = logRef.current;
    if (log) scrollTarget.current = log.scrollHeight - log.scrollTop;
    setMessages((previous) => [...earlier, ...previous]);
  }

  const empty = messages.length === 0 && !sending && !failed;

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardContent className="px-0">
        <div
          ref={logRef}
          role="log"
          aria-label={`Conversación con ${assistant.name}`}
          aria-live="polite"
          // On a phone, what is left of the screen once the header, the field and the bottom bar have their place: the
          // field is in sight when the assistant opens.
          className="relative h-[clamp(12rem,calc(100svh-28rem),600px)] space-y-4 overflow-y-auto px-4 py-4 md:h-[min(62svh,600px)] md:min-h-72"
        >
          {empty ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Bot aria-hidden className="size-6 text-muted-foreground" />
              <p className="font-medium">Escribe tu pregunta para empezar</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {assistant.name} es un asistente de IA: responde con los documentos del negocio y te dice de cuál sale cada dato. Si no lo encuentra, te lo dirá.
              </p>
            </div>
          ) : null}
          {hasEarlier ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadEarlier()} disabled={loadingEarlier}>
                {loadingEarlier ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                {loadingEarlier ? "Cargando…" : "Cargar mensajes anteriores"}
              </Button>
            </div>
          ) : null}
          {messages.map((message) =>
            message.role === "user" ? (
              <QuestionBubble key={message.id} text={message.content} bubbleRef={message.id === lastQuestionId ? lastQuestionRef : undefined} />
            ) : (
              <AnswerBubble key={message.id} assistantName={assistant.name} message={message} />
            ),
          )}
          {asking ? <QuestionBubble text={asking} /> : null}
          {sending ? <TypingBubble assistantName={assistant.name} /> : null}
          {failed ? (
            <>
              <QuestionBubble text={failed.text} />
              <ErrorLine message={failed.message} onRetry={failed.retry && !noKey ? () => void ask(failed.text) : undefined} />
            </>
          ) : null}
        </div>

        <div className="space-y-2 border-t p-4">
          <Label htmlFor="asistente-pregunta" className="sr-only">
            Tu pregunta
          </Label>
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              id="asistente-pregunta"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={noKey ? "Sin clave de OpenRouter el asistente no responde" : "Escribe tu pregunta…"}
              maxLength={MAX_QUESTION_CHARS}
              rows={1}
              disabled={noKey}
              aria-describedby={noKey ? NO_KEY_ID : undefined}
              className="max-h-40 min-h-9 resize-none"
            />
            <Button
              type="button"
              onClick={() => {
                send();
                // With the mouse or a finger the button took the focus: back to the field, for the next question.
                inputRef.current?.focus();
              }}
              disabled={!canSend}
              aria-describedby={noKey ? NO_KEY_ID : undefined}
            >
              {sending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <SendHorizontal aria-hidden />}
              {sending ? "Enviando…" : "Enviar"}
            </Button>
          </div>
          {/* On a touch screen Intro adds a line and the button sends: nothing to explain. */}
          {noKey ? <NoKeyNote variant={keyHelp} /> : <p className="text-xs text-muted-foreground pointer-coarse:hidden">Intro envía; Mayús + Intro añade una línea.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function toMessage({ id, role, content, sources }: WorkspaceMessage): WorkspaceMessage {
  return { id, role, content, sources };
}

// The bubbles are memoized: writing in the field does not paint (nor read the format of) every answer again.
const QuestionBubble = memo(function QuestionBubble({ text, bubbleRef }: { text: string; bubbleRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={bubbleRef} className="flex justify-start">
      <div className="max-w-[85%] space-y-1">
        <p className="text-xs text-muted-foreground">Tú</p>
        <p className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 break-words whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
});

const AnswerBubble = memo(function AnswerBubble({ assistantName, message }: { assistantName: string; message: WorkspaceMessage }) {
  const sourcesRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1">
        <p className="flex items-center justify-end gap-1 text-xs text-ai">
          <Bot aria-hidden className="size-4" />
          IA · {assistantName}
        </p>
        {/* The answer as escaped text with simple formatting (lists, bold): never HTML ([SEG-05]). */}
        <div className="rounded-2xl rounded-br-sm border border-ai/25 bg-ai-soft px-3 py-2 break-words [&>*:first-child]:mt-0">
          <MarkdownText text={message.content} />
        </div>
        {message.sources.length > 0 ? (
          <Collapsible
            className="flex flex-col items-end"
            onOpenChange={(open) => {
              // The list opens below what is in sight at the end of the conversation: it is brought into view.
              if (open) requestAnimationFrame(() => sourcesRef.current?.scrollIntoView({ block: "nearest" }));
            }}
          >
            <CollapsibleTrigger asChild>
              <Button type="button" variant="link" size="xs" className="group h-auto gap-1 px-0 text-primary-text pointer-coarse:min-h-11">
                <FileText aria-hidden className="size-3.5" />
                {message.sources.length === 1 ? "Ver la fuente" : `Ver las ${message.sources.length} fuentes`}
                <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="w-full">
              <div ref={sourcesRef} className="mt-1 grid gap-2 rounded-lg border bg-card p-3 text-xs">
                <p className="text-muted-foreground">Lo que ha consultado para responder, de lo más a lo menos relevante:</p>
                <ol className="grid gap-2">
                  {message.sources.map((source, index) => (
                    <SourceItem key={index} number={index + 1} source={source} />
                  ))}
                </ol>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </div>
  );
});

/** A fragment the answer consulted, as the inbox shows them: document, then section and page, then its base. */
function SourceItem({ number, source }: { number: number; source: AssistantSource }) {
  const place = fragmentPlace(source);
  return (
    <li className="flex items-start gap-2">
      <span className="text-muted-foreground tabular-nums">{number}.</span>
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium break-words">{source.title ?? "Documento sin título"}</span>
        {place ? <span className="break-words text-muted-foreground tabular-nums">{place}</span> : null}
        {source.knowledgeBase ? (
          <span className="inline-flex items-center gap-1 break-words text-muted-foreground">
            <Library aria-hidden className="size-3 shrink-0" />
            Base «{source.knowledgeBase}»
          </span>
        ) : null}
      </span>
    </li>
  );
}

function TypingBubble({ assistantName }: { assistantName: string }) {
  return (
    <div className="flex justify-end" role="status">
      <div className="space-y-1">
        <p className="flex items-center justify-end gap-1 text-xs text-ai">
          <Bot aria-hidden className="size-4" />
          IA · {assistantName}
        </p>
        <p className="flex items-center gap-2 rounded-2xl rounded-br-sm border border-ai/25 bg-ai-soft px-3 py-2 text-sm text-muted-foreground">
          <span aria-hidden className="flex gap-1">
            {[0, 1, 2].map((dot) => (
              <span key={dot} className="size-1.5 animate-pulse rounded-full bg-ai motion-reduce:animate-none" style={{ animationDelay: `${dot * 150}ms` }} />
            ))}
          </span>
          Buscando en los documentos…
        </p>
      </div>
    </div>
  );
}

function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 text-center">
      <p className="flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-text">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {message}
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw aria-hidden />
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

function NoKeyNote({ variant }: { variant: "manage" | "ask" }) {
  return (
    <p id={NO_KEY_ID} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-warning">
      <KeyRound aria-hidden className="size-4 shrink-0" />
      <span>
        Falta la clave de OpenRouter: sin ella el asistente no responde y no se puede enviar.
        {variant === "ask" ? " Pide al propietario que la añada." : null}
      </span>
      {variant === "manage" ? (
        <Link href={AI_SETTINGS_HREF} className="font-medium text-primary-text underline-offset-4 hover:underline">
          Ir a Ajustes › IA
        </Link>
      ) : null}
    </p>
  );
}
