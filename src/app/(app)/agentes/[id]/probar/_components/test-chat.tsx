"use client";

import { Bot, CircleAlert, Info, KeyRound, LoaderCircle, RotateCcw, SendHorizontal, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { AI_SETTINGS_HREF } from "@/components/banners/openrouter-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatNumber } from "@/lib/format";
import type { SimulatedChannel } from "@/server/ai/prompt";
import { sendTestMessageAction, type TestChatResult } from "../actions";
import { isSimulatedChannel, SIMULATED_CHANNEL_OPTIONS, simulatedChannelLabel } from "../_lib/channels";
import type { TestReply } from "../_lib/reply";
import { capTranscript, TEST_CHAT_LIMITS, type TranscriptMessage } from "../_lib/transcript";
import { formatCost, formatLatency, ReplyDetails } from "./reply-details";

type ChatItem =
  | { kind: "contact"; id: number; text: string }
  | { kind: "ai"; id: number; reply: TestReply }
  | { kind: "error"; id: number; message: string };

const SEND_FAILED = "No se ha podido enviar el mensaje. Vuelve a intentarlo.";
const NO_KEY_ID = "probar-sin-clave";

function toTranscript(items: readonly ChatItem[]): TranscriptMessage[] {
  return items.flatMap((item): TranscriptMessage[] => {
    if (item.kind === "contact") return [{ role: "contact", text: item.text }];
    if (item.kind === "ai") return [{ role: "ai", text: item.reply.text }];
    return [];
  });
}

type TestChatProps = {
  agentId: string;
  agentName: string;
  /** There is an OpenRouter key: without it the agent does not answer and nothing can be sent ([PRU-07]). */
  aiConfigured: boolean;
  /** What the no-key note offers: "manage" links to Ajustes › IA, "ask" tells to ask the owner ([ARR-14]). */
  keyHelp: "manage" | "ask";
};

/**
 * «Probar agente» ([PRU-01]–[PRU-03], [PRU-06], [PRU-07]). The conversation lives only here: each send carries the
 * transcript, and «Empezar de nuevo» simply forgets it.
 */
export function TestChat({ agentId, agentName, aiConfigured, keyHelp }: TestChatProps) {
  const [channel, setChannel] = useState<SimulatedChannel>("whatsapp");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [noKey, setNoKey] = useState(!aiConfigured);
  const [pending, startTransition] = useTransition();
  const nextId = useRef(1);
  // Bumped by «Empezar de nuevo»: a reply that arrives for a forgotten conversation is dropped.
  const conversation = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  const replies = items.filter((item): item is Extract<ChatItem, { kind: "ai" }> => item.kind === "ai");
  const selected = replies.find((item) => item.id === selectedId) ?? replies.at(-1) ?? null;
  const canSend = !noKey && !pending && draft.trim().length > 0;

  // Keeps the newest message in view by scrolling the conversation only, never the page.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [items.length, pending]);

  function request(current: ChatItem[]) {
    const started = conversation.current;
    const messages = capTranscript(toTranscript(current));
    startTransition(async () => {
      let result: TestChatResult | null;
      try {
        result = await sendTestMessageAction({ agentId, channel, messages });
      } catch {
        result = null;
      }
      if (started !== conversation.current) return;
      if (result?.ok) {
        const id = nextId.current++;
        const reply = result.data;
        setItems((previous) => [...previous, { kind: "ai", id, reply }]);
        setSelectedId(id);
        return;
      }
      if (result?.reason === "ai_not_configured") setNoKey(true);
      const message = result?.error ?? SEND_FAILED;
      setItems((previous) => [...previous, { kind: "error", id: nextId.current++, message }]);
    });
  }

  function send() {
    const text = draft.trim();
    if (!text || noKey || pending) return;
    const next: ChatItem[] = [...items.filter((item) => item.kind !== "error"), { kind: "contact", id: nextId.current++, text }];
    setItems(next);
    setDraft("");
    request(next);
  }

  function retry() {
    if (pending || noKey) return;
    const next = items.filter((item) => item.kind !== "error");
    setItems(next);
    request(next);
  }

  function reset() {
    conversation.current += 1;
    setItems([]);
    setSelectedId(null);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function showDetails(id: number) {
    setSelectedId(id);
    detailsRef.current?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-col gap-3 border-b py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span id="simular-canal" className="text-sm font-medium">
              Simular canal
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={channel}
              onValueChange={(value) => {
                if (isSimulatedChannel(value)) setChannel(value);
              }}
              aria-labelledby="simular-canal"
            >
              {SIMULATED_CHANNEL_OPTIONS.map(({ value, label, icon: Icon }) => (
                <ToggleGroupItem key={value} value={value} className="px-3 pointer-coarse:min-h-11">
                  <Icon aria-hidden />
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <Button type="button" variant="outline" onClick={reset} disabled={items.length === 0 && !pending}>
            <RotateCcw aria-hidden />
            Empezar de nuevo
          </Button>
        </CardHeader>

        <CardContent className="px-0">
          <div ref={logRef} role="log" aria-label="Conversación de prueba" aria-live="polite" className="h-[min(60svh,560px)] min-h-72 space-y-4 overflow-y-auto px-4 py-4">
            {items.length === 0 && !pending ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Bot aria-hidden className="size-6 text-muted-foreground" />
                <p className="font-medium">Escribe un mensaje para empezar</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Prueba preguntas de tus clientes y cambia el canal para ver cómo responde en cada uno.
                </p>
              </div>
            ) : null}
            {items.map((item) => {
              if (item.kind === "contact") return <ContactBubble key={item.id} text={item.text} />;
              if (item.kind === "error")
                return <ErrorLine key={item.id} message={item.message} onRetry={item === items.at(-1) && !noKey ? retry : undefined} pending={pending} />;
              return (
                <AiBubble
                  key={item.id}
                  agentName={agentName}
                  reply={item.reply}
                  selected={selected?.id === item.id}
                  onShowDetails={() => showDetails(item.id)}
                />
              );
            })}
            {pending ? <TypingBubble agentName={agentName} /> : null}
          </div>

          <div className="space-y-2 border-t p-4">
            <Label htmlFor="probar-mensaje" className="sr-only">
              Mensaje de prueba
            </Label>
            <div className="flex items-end gap-2">
              <Textarea
                id="probar-mensaje"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={noKey ? "Sin clave de OpenRouter el agente no responde" : "Escribe como si fueras un cliente…"}
                maxLength={TEST_CHAT_LIMITS.maxMessageChars}
                rows={1}
                disabled={noKey}
                aria-describedby={noKey ? NO_KEY_ID : undefined}
                className="max-h-40 min-h-9 resize-none"
              />
              <Button type="button" onClick={send} disabled={!canSend} aria-describedby={noKey ? NO_KEY_ID : undefined}>
                {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <SendHorizontal aria-hidden />}
                {pending ? "Enviando…" : "Enviar"}
              </Button>
            </div>
            {noKey ? (
              <NoKeyNote variant={keyHelp} />
            ) : (
              <p className="text-xs text-muted-foreground">Intro envía; Mayús + Intro añade una línea.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card ref={detailsRef} className="lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>
            <h3 className="text-base font-semibold">Detalles de la respuesta</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selected ? (
            <ReplyDetails reply={selected.reply} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Aquí verás, para cada respuesta, el modelo, los tokens, el coste, el tiempo, las herramientas usadas y los
              fragmentos de conocimiento.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ContactBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1">
        <p className="text-xs text-muted-foreground">Tú, como cliente</p>
        <p className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 break-words whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

type AiBubbleProps = { agentName: string; reply: TestReply; selected: boolean; onShowDetails: () => void };

function AiBubble({ agentName, reply, selected, onShowDetails }: AiBubbleProps) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1">
          <p className="flex items-center justify-end gap-1 text-xs text-ai">
            <Bot aria-hidden className="size-4" />
            IA · {agentName}
          </p>
          <p className="rounded-2xl rounded-br-sm border border-ai/25 bg-ai-soft px-3 py-2 break-words whitespace-pre-wrap">{reply.text}</p>
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {reply.toolCalls.map((call) => (
              <span key={call.id} className="inline-flex items-center gap-1">
                <Wrench aria-hidden className="size-3" />
                {call.label}
              </span>
            ))}
            <span>{simulatedChannelLabel(reply.channel)}</span>
            <span aria-hidden>·</span>
            <span>{formatNumber(reply.usage.totalTokens)} tokens</span>
            <span aria-hidden>·</span>
            <span>{formatCost(reply.costUsd)}</span>
            <span aria-hidden>·</span>
            <span>{formatLatency(reply.latencyMs)}</span>
            <Button type="button" variant="link" size="xs" className="h-auto px-0 pointer-coarse:min-h-11" onClick={onShowDetails} aria-pressed={selected}>
              Ver detalles
            </Button>
          </div>
        </div>
      </div>
      {reply.handedOff ? (
        <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
          <Info aria-hidden className="size-4 shrink-0" />
          Traspaso simulado: en una conversación real, pasaría a una persona del equipo.
        </p>
      ) : null}
    </div>
  );
}

function TypingBubble({ agentName }: { agentName: string }) {
  return (
    <div className="flex justify-end" role="status">
      <div className="space-y-1">
        <p className="flex items-center justify-end gap-1 text-xs text-ai">
          <Bot aria-hidden className="size-4" />
          IA · {agentName}
        </p>
        <p className="flex items-center gap-2 rounded-2xl rounded-br-sm border border-ai/25 bg-ai-soft px-3 py-2 text-sm text-muted-foreground">
          <span aria-hidden className="flex gap-1">
            {[0, 1, 2].map((dot) => (
              <span key={dot} className="size-1.5 animate-pulse rounded-full bg-ai motion-reduce:animate-none" style={{ animationDelay: `${dot * 150}ms` }} />
            ))}
          </span>
          Escribiendo…
        </p>
      </div>
    </div>
  );
}

function ErrorLine({ message, onRetry, pending }: { message: string; onRetry?: () => void; pending: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 text-center">
      <p className="flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-text">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {message}
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={pending}>
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
        Añade tu clave de OpenRouter: sin ella el agente no responde y no se puede enviar.
        {variant === "ask" ? " Pide al propietario que la añada." : null}
      </span>
      {variant === "manage" ? (
        <Link href={AI_SETTINGS_HREF} className="font-medium text-primary underline-offset-4 hover:underline">
          Ir a Ajustes › IA
        </Link>
      ) : null}
    </p>
  );
}
