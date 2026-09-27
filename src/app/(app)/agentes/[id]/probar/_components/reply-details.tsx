import { BookOpen, CircleCheck, CircleX, Library, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatCurrencyUSD, formatNumber } from "@/lib/format";
import { simulatedChannelLabel } from "../_lib/channels";
import type { TestReply, TestRetrieval, TestToolCall } from "../_lib/reply";

/** «1.234 ms». */
export function formatLatency(ms: number): string {
  return `${formatNumber(ms)} ms`;
}

/** Cost of OpenRouter's usage.cost, or a note when it sent none (never computed from prices). */
export function formatCost(costUsd: number | null): string {
  return costUsd === null ? "Sin dato de coste" : formatCurrencyUSD(costUsd);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function DetailText({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

function ToolCallItem({ call }: { call: TestToolCall }) {
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <Wrench aria-hidden className="size-4 text-ai" />
          {call.label}
        </p>
        {call.ok ? (
          <Badge variant="outline" className="border-transparent bg-success-soft text-success">
            <CircleCheck aria-hidden />
            Correcto
          </Badge>
        ) : (
          <Badge variant="outline" className="border-transparent bg-destructive-soft text-destructive-text">
            <CircleX aria-hidden />
            Error
          </Badge>
        )}
      </div>
      {call.label !== call.name ? <p className="font-mono text-xs text-muted-foreground">{call.name}</p> : null}
      <DetailText label="Datos" text={call.argumentsText} />
      <DetailText label="Resultado" text={call.resultText} />
    </li>
  );
}

/** «Cortes · pág. 3», or null when the fragment has neither. A FAQ's section is its question, its title too: not repeated. */
function retrievalPlace(retrieval: TestRetrieval): string | null {
  const section = retrieval.section !== retrieval.title ? retrieval.section : null;
  const parts = [section, retrieval.page !== null ? `pág. ${retrieval.page}` : null].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** One fragment with its source (document, section, page and base) and its score ([PRU-02]). */
function RetrievalItem({ retrieval }: { retrieval: TestRetrieval }) {
  const place = retrievalPlace(retrieval);
  return (
    <li className="flex items-start gap-3 py-2">
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
        {retrieval.rank}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 font-medium break-words">
            <span className="sr-only">Fragmento {retrieval.rank}: </span>
            {retrieval.title ?? "Sin título"}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            <span className="sr-only">Puntuación </span>
            {retrieval.score !== null ? formatNumber(retrieval.score, { maximumSignificantDigits: 2 }) : "—"}
          </span>
        </div>
        {place ? <span className="text-xs text-muted-foreground">{place}</span> : null}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Library aria-hidden className="size-3 shrink-0" />
          {retrieval.knowledgeBase ? `Base «${retrieval.knowledgeBase}»` : "Base de conocimiento borrada"}
        </span>
      </div>
    </li>
  );
}

/** Everything about one reply ([PRU-02]): model, tokens, cost, time, tools with data and result, and fragments. */
export function ReplyDetails({ reply }: { reply: TestReply }) {
  const { usage } = reply;
  return (
    <div className="space-y-5 text-sm">
      <Block title="Modelo">
        <dl>
          <Row label="Ha respondido">
            <span className="font-mono text-xs break-all">{reply.modelUsed}</span>
          </Row>
          <Row label="Proveedor">{reply.provider ?? "Sin dato"}</Row>
          {reply.usedFallback ? (
            <Row label="Pedido">
              <span className="font-mono text-xs break-all">{reply.modelRequested}</span>{" "}
              <Badge variant="outline" className="ml-1 border-transparent bg-warning-soft text-warning">
                Respaldo
              </Badge>
            </Row>
          ) : null}
          <Row label="Canal simulado">{simulatedChannelLabel(reply.channel)}</Row>
        </dl>
      </Block>

      <Block title="Tokens">
        <dl>
          <Row label="Entrada">{formatNumber(usage.promptTokens)}</Row>
          <Row label="Entrada leída de la caché">{formatNumber(usage.cachedTokens)}</Row>
          <Row label="Salida">{formatNumber(usage.completionTokens)}</Row>
          <Row label="Razonamiento">{formatNumber(usage.reasoningTokens)}</Row>
          <Row label="Total">{formatNumber(usage.totalTokens)}</Row>
        </dl>
      </Block>

      <Block title="Coste y tiempo">
        <dl>
          <Row label="Coste">{formatCost(reply.costUsd)}</Row>
          <Row label="Tiempo">{formatLatency(reply.latencyMs)}</Row>
          <Row label="Pasos">{formatNumber(reply.steps)}</Row>
        </dl>
      </Block>

      <Block title="Herramientas usadas">
        {reply.toolCalls.length > 0 ? (
          <ul className="space-y-3">
            {reply.toolCalls.map((call) => (
              <ToolCallItem key={call.id} call={call} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No ha usado herramientas.</p>
        )}
        {reply.handedOff ? (
          <p className="text-xs text-muted-foreground">
            Traspaso simulado: en una conversación real, pasaría a una persona del equipo.
          </p>
        ) : null}
      </Block>

      <Block title="Fragmentos de conocimiento">
        {reply.retrievals.length > 0 ? (
          <>
            <ol className="divide-y">
              {reply.retrievals.map((retrieval) => (
                <RetrievalItem key={retrieval.rank} retrieval={retrieval} />
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">Del más al menos relevante. La cifra de la derecha es su puntuación: cuanto más alta, más se parece a lo preguntado.</p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <BookOpen aria-hidden className="size-4 shrink-0" />
            No ha usado fragmentos de conocimiento.
          </p>
        )}
      </Block>
    </div>
  );
}
