import { FileSpreadsheet, FileText, Globe, MessageCircleQuestionMark, TextQuote, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { AI_SETTINGS_HREF } from "@/components/banners/openrouter-banner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { KbDocumentStatus, KbSourceType } from "@/lib/enums";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { documentStatusView } from "../_lib/labels";
import { RetryButton } from "./document-actions";
import { DocumentMenu } from "./document-menu";
import { DocumentStatusBadge } from "./status-badge";

/** A scanned PDF waits for the Mistral OCR key: who can open Ajustes › IA gets the link, the rest are told whom to ask. */
export type MistralKeyHint = "manage" | "ask" | null;

export type DocumentRowView = {
  id: string;
  href: string;
  title: string;
  /** Address of a web page, or the file name when it differs from the title. */
  source: string | null;
  kindLabel: string;
  sourceType: KbSourceType;
  status: { status: KbDocumentStatus; error: string | null; textOnly: boolean };
  mistralHint: MistralKeyHint;
  pages: number | null;
  chunks: number;
  added: { relative: string; full: string; iso: string };
};

const KIND_ICONS: Record<string, LucideIcon> = { Excel: FileSpreadsheet, CSV: FileSpreadsheet, "Página web": Globe, "Pregunta frecuente": MessageCircleQuestionMark };

export function DocumentKindIcon({ label, sourceType, className }: { label: string; sourceType: KbSourceType; className?: string }) {
  const Icon = sourceType === "text" ? TextQuote : (KIND_ICONS[label] ?? FileText);
  return <Icon aria-hidden className={cn("size-4 shrink-0 text-muted-foreground", className)} />;
}

/** Status with the reason of an error and, for a scanned PDF without the Mistral key, what to do ([CON-05], [CON-07]). */
export function DocumentStatus({ row, canRetry = false }: { row: Pick<DocumentRowView, "id" | "title" | "status" | "mistralHint">; canRetry?: boolean }) {
  const { detail } = documentStatusView(row.status);
  return (
    <div className="grid justify-items-start gap-1">
      <DocumentStatusBadge doc={row.status} />
      {detail ? <p className="max-w-80 text-xs text-destructive-text">{detail}</p> : null}
      {row.mistralHint === "manage" ? (
        <Link href={AI_SETTINGS_HREF} className="relative z-10 text-xs font-medium text-primary-text underline-offset-4 hover:underline">
          Añadir la clave de Mistral OCR
        </Link>
      ) : row.mistralHint === "ask" ? (
        <p className="text-xs text-muted-foreground">Pide al propietario que añada la clave de Mistral OCR.</p>
      ) : null}
      {canRetry && row.status.status === "error" ? <RetryButton documentId={row.id} title={row.title} /> : null}
    </div>
  );
}

function TitleLink({ row, stretched }: { row: DocumentRowView; stretched?: boolean }) {
  return (
    <Link
      href={row.href}
      className={cn(
        "rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none",
        stretched ? "after:absolute after:inset-0 after:rounded-xl" : "focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      {row.title}
    </Link>
  );
}

const count = (value: number | null) => (value === null ? "—" : formatNumber(value));

/**
 * Documents of a base (docs/pantallas.md «Documentos»): type, title, ingest status, pages, fragments and date; a table
 * from 768 px and cards below. The title opens the document with its fragments.
 */
export function DocumentsTable({ rows, canManage }: { rows: DocumentRowView[]; canManage: boolean }) {
  return (
    <>
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Documento</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Páginas</TableHead>
              <TableHead className="text-right">Fragmentos</TableHead>
              <TableHead>Añadido</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-80">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="truncate">
                      <TitleLink row={row} />
                    </span>
                    {row.source ? (
                      <span className="truncate text-xs text-muted-foreground" title={row.source}>
                        {row.source}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <DocumentKindIcon label={row.kindLabel} sourceType={row.sourceType} />
                    {row.kindLabel}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <DocumentStatus row={row} canRetry={canManage} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{count(row.pages)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(row.chunks)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <time dateTime={row.added.iso} title={row.added.full} className="tabular-nums">
                    {row.added.relative}
                  </time>
                </TableCell>
                {canManage ? (
                  <TableCell className="w-10">
                    <DocumentMenu documentId={row.id} title={row.title} href={row.href} sourceType={row.sourceType} status={row.status.status} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="relative grid gap-2 rounded-xl border p-4 text-sm hover:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <DocumentKindIcon label={row.kindLabel} sourceType={row.sourceType} />
                <span className="min-w-0 truncate">
                  <TitleLink row={row} stretched />
                </span>
              </span>
              {canManage ? (
                <DocumentMenu documentId={row.id} title={row.title} href={row.href} sourceType={row.sourceType} status={row.status.status} />
              ) : null}
            </div>
            <DocumentStatus row={row} canRetry={canManage} />
            <p className="text-xs text-muted-foreground tabular-nums">
              {row.kindLabel} · {row.pages !== null ? `${formatNumber(row.pages)} pág. · ` : ""}
              {formatNumber(row.chunks)} fragm. · <time dateTime={row.added.iso}>{row.added.relative}</time>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
