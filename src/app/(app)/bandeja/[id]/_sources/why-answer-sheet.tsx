"use client";

import { BookOpen, CircleCheck, CircleX, Library, RotateCcw, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { MessageReason, MessageReasonFragment } from "@/data/message-reason";
import type { ActionResult } from "@/lib/action-result";
import { loadWhyAnswerAction } from "./actions";
import { formatScore, fragmentPlace, summarizeTools, type ToolSummary } from "./presentation";

const LOAD_FAILED = "No se ha podido cargar. Inténtalo de nuevo.";

type WhyAnswerSheetProps = {
  conversationId: string;
  /** The AI answer whose panel is open; null = closed. */
  messageId: string | null;
  onClose: () => void;
  /** Links to the document for whoever may open Conocimiento. */
  canOpenDocuments: boolean;
};

/**
 * «¿Por qué respondió esto?» ([BAN-07], [CON-20]): the numbered fragments an AI answer used (title, section, page,
 * base and score) and the tools the AI called in that turn, read from the server when the panel opens.
 */
export function WhyAnswerSheet({ conversationId, messageId, onClose, canOpenDocuments }: WhyAnswerSheetProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; result: ActionResult<MessageReason> } | null>(null);
  const key = messageId ? `${messageId}:${attempt}` : null;

  useEffect(() => {
    if (!messageId || !key) return;
    let current = true;
    loadWhyAnswerAction({ conversationId, messageId }).then(
      (result) => {
        if (current) setLoaded({ key, result });
      },
      () => {
        if (current) setLoaded({ key, result: { ok: false, error: LOAD_FAILED } });
      },
    );
    return () => {
      current = false;
    };
  }, [conversationId, messageId, key]);

  const result = loaded && loaded.key === key ? loaded.result : null;
  return (
    <Sheet open={messageId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="flex-row items-start justify-between gap-2 border-b">
          <div className="flex min-w-0 flex-col gap-1">
            <SheetTitle>¿Por qué respondió esto?</SheetTitle>
            <SheetDescription>Lo que la IA consultó para escribir esta respuesta.</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Cerrar">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </SheetHeader>
        {result === null ? (
          <ReasonSkeleton />
        ) : result.ok && result.data ? (
          <ReasonDetails reason={result.data} canOpenDocuments={canOpenDocuments} />
        ) : (
          <div className="p-4">
            <ErrorState
              description={result.ok ? LOAD_FAILED : result.error}
              retry={
                <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                  <RotateCcw aria-hidden />
                  Reintentar
                </Button>
              }
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReasonSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReasonDetails({ reason, canOpenDocuments }: { reason: MessageReason; canOpenDocuments: boolean }) {
  const tools = summarizeTools(reason.tools);
  return (
    <div className="flex flex-col">
      <section aria-labelledby="why-fragments" className="flex flex-col gap-1 border-b px-4 py-3">
        <h3 id="why-fragments" className="text-xs font-medium text-muted-foreground">
          Fragmentos usados, del más al menos relevante
        </h3>
        {reason.fragments.length > 0 ? (
          <>
            <ol className="flex flex-col divide-y">
              {reason.fragments.map((fragment) => (
                <FragmentItem key={fragment.rank} fragment={fragment} canOpenDocuments={canOpenDocuments} />
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">La puntuación compara los fragmentos entre sí: cuanto más alta, más se parece a lo que preguntó el cliente.</p>
          </>
        ) : (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <BookOpen aria-hidden className="size-4 shrink-0" />
            No usó fragmentos de conocimiento.
          </p>
        )}
      </section>
      <section aria-labelledby="why-tools" className="flex flex-col gap-2 px-4 py-3">
        <h3 id="why-tools" className="text-xs font-medium text-muted-foreground">
          Herramientas usadas
        </h3>
        {tools.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {tools.map((tool) => (
              <ToolItem key={`${tool.name}:${tool.ok}`} tool={tool} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No usó herramientas.</p>
        )}
      </section>
    </div>
  );
}

function FragmentItem({ fragment, canOpenDocuments }: { fragment: MessageReasonFragment; canOpenDocuments: boolean }) {
  const details = [fragmentPlace(fragment), fragment.score !== null ? `puntuación ${formatScore(fragment.score)}` : null].filter(Boolean).join(" · ");
  return (
    <li className="flex gap-3 py-3 text-sm">
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
        {fragment.rank}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium break-words">
          <span className="sr-only">Fragmento {fragment.rank}: </span>
          {fragment.title ?? "Documento sin título"}
        </span>
        {details ? <span className="text-xs text-muted-foreground tabular-nums">{details}</span> : null}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Library aria-hidden className="size-3 shrink-0" />
          {fragment.kbName ? `Base «${fragment.kbName}»` : "Base de conocimiento borrada"}
        </span>
        {canOpenDocuments && fragment.kbId && fragment.documentId ? (
          <Link
            href={`/conocimiento/${fragment.kbId}/documentos/${fragment.documentId}`}
            className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary-text hover:underline"
          >
            Abrir el documento
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function ToolItem({ tool }: { tool: ToolSummary }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <Wrench aria-hidden className="size-4 shrink-0 text-ai" />
        <span className="break-words">{tool.label}</span>
        {tool.count > 1 ? <span className="text-xs text-muted-foreground tabular-nums">× {tool.count}</span> : null}
      </span>
      {tool.ok ? (
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
    </li>
  );
}
