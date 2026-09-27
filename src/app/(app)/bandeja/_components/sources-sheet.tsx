"use client";

import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { MessageSource } from "@/data/message-sources";
import { formatNumber } from "@/lib/format";

type SourcesSheetProps = {
  sources: MessageSource[] | null;
  onClose: () => void;
  /** Links to the document for whoever may open Conocimiento. */
  canOpenDocuments: boolean;
};

/** «¿Por qué respondió esto?»: the numbered fragments the AI used, with title, section, page and score ([BAN-07]). */
export function SourcesSheet({ sources, onClose, canOpenDocuments }: SourcesSheetProps) {
  return (
    <Sheet open={sources !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="flex-row items-start justify-between gap-2 border-b">
          <div className="flex min-w-0 flex-col gap-1">
            <SheetTitle>¿Por qué respondió esto?</SheetTitle>
            <SheetDescription>Fragmentos del conocimiento que la IA usó para esta respuesta, del más al menos relevante.</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Cerrar">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </SheetHeader>
        <ol className="flex flex-col">
          {(sources ?? []).map((source) => (
            <li key={source.rank} className="flex gap-3 border-b px-4 py-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">{source.rank}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium break-words">{source.title ?? "Documento sin título"}</span>
                <span className="text-xs text-muted-foreground">
                  {[source.section, source.page !== null ? `página ${source.page}` : null, source.score !== null ? `puntuación ${formatNumber(source.score, { maximumFractionDigits: 2 })}` : null]
                    .filter(Boolean)
                    .join(" · ") || "Sin más datos"}
                </span>
                {canOpenDocuments && source.kbId && source.documentId ? (
                  <Link
                    href={`/conocimiento/${source.kbId}/documentos/${source.documentId}`}
                    className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary-text hover:underline"
                  >
                    Abrir el documento
                    <ExternalLink aria-hidden className="size-3" />
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
