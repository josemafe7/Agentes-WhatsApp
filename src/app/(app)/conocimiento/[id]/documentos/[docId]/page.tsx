import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { getKnowledgeDocument, type KnowledgeDocumentDetail } from "@/data/knowledge-documents";
import { formatDateTime, formatNumber } from "@/lib/format";
import { NotFoundError } from "@/server/errors";
import { DocumentActions, RefreshSettings } from "../../../_components/document-actions";
import { DocumentKindIcon, DocumentStatus } from "../../../_components/documents-table";
import { LiveRefresh } from "../../../_components/live-refresh";
import { PageNav } from "../../../_components/page-nav";
import { mistralKeyHintFor, toDocumentRows } from "../../../_lib/document-rows";
import { countLabel, formatFileSize, isDocumentInProgress, refreshIntervalLabel } from "../../../_lib/labels";
import { loadKnowledgePage } from "../../../_lib/load";
import { PAGE_PARAM, pageSlice } from "../../../_lib/pagination";
import { knowledgeBasePath, knowledgeDocumentPath } from "../../../_lib/paths";
import { RenameDocumentDialog } from "./_components/rename-document-dialog";

export const metadata: Metadata = { title: "Documento" };
// «Reintentar» / «Refrescar» start the processing right after answering (KNOWLEDGE_MAX_DURATION_SEC).
export const maxDuration = 60;

type DocumentPageProps = {
  params: Promise<{ id: string; docId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

const isWebAddress = (value: string) => /^https?:\/\//i.test(value);

/**
 * A document of a base (docs/pantallas.md «Documento», [CON-05], [CON-09], [CON-10], [CON-15]): status, origin (file,
 * or web page with its date and refresh), summary and its fragments with section and page, 25 per page; «Cambiar
 * título» for files, web pages and texts.
 */
export default async function KnowledgeDocumentPage({ params, searchParams }: DocumentPageProps) {
  const { docId } = await params;
  const page = await loadKnowledgePage(params, `documentos/${encodeURIComponent(docId)}`);
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, base, canManage, timezone } = page;

  let doc: KnowledgeDocumentDetail;
  try {
    doc = await getKnowledgeDocument(actor, docId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  // A document is only shown under its own base.
  if (doc.kbId !== base.id) notFound();

  const [row] = toDocumentRows([doc], { kbId: base.id, timezone, hint: mistralKeyHintFor(actor) });
  const slice = pageSlice((await searchParams)[PAGE_PARAM], doc.chunks.length);
  const chunks = doc.chunks.slice(slice.start, slice.end);
  const listHref = doc.sourceType === "faq" ? knowledgeBasePath(base.id, "faq") : knowledgeBasePath(base.id);

  return (
    <article aria-labelledby="document-title" className="grid max-w-4xl gap-8">
      <div className="grid gap-3">
        <Link href={knowledgeBasePath(base.id)} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-4" />
          Documentos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <h2 id="document-title" className="text-xl font-semibold break-words">
              {doc.title}
            </h2>
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <DocumentKindIcon label={row.kindLabel} sourceType={doc.sourceType} />
              {row.kindLabel} · {countLabel(doc.chunkCount, "fragmento", "fragmentos")}
              {doc.pageCount !== null ? ` · ${countLabel(doc.pageCount, "página", "páginas")}` : ""}
            </p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {/* A FAQ's title is its question: it is changed in «Preguntas frecuentes». */}
              {doc.sourceType !== "faq" ? <RenameDocumentDialog documentId={doc.id} title={doc.title} /> : null}
              <DocumentActions documentId={doc.id} title={doc.title} sourceType={doc.sourceType} status={doc.status} listHref={listHref} />
            </div>
          ) : null}
        </div>
        <DocumentStatus row={row} />
      </div>

      <Section id="document-origin" title="Origen">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          {doc.sourceType === "file" ? (
            <>
              <Detail label="Archivo">
                {doc.fileName ?? doc.title} <span className="text-muted-foreground">· {formatFileSize(doc.sizeBytes)}</span>
              </Detail>
              <Detail label="Subido">{formatDateTime(doc.createdAt, timezone)}</Detail>
            </>
          ) : null}
          {doc.sourceType === "url" && doc.url ? (
            <>
              <Detail label="Página web">
                {isWebAddress(doc.url) ? (
                  <a href={doc.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary-text underline-offset-4 hover:underline">
                    <span className="break-all">{doc.url}</span>
                    <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                    <span className="sr-only">(se abre en otra pestaña)</span>
                  </a>
                ) : (
                  <span className="break-all">{doc.url}</span>
                )}
              </Detail>
              <Detail label="Leída">{doc.fetchedAt ? formatDateTime(doc.fetchedAt, timezone) : "Aún no se ha leído"}</Detail>
              {doc.sitemapUrl ? <Detail label="Mapa del sitio">Añadida desde {doc.sitemapUrl}</Detail> : null}
              {canManage ? null : (
                <Detail label="Refresco">
                  {doc.refreshEnabled ? refreshIntervalLabel(doc.refreshIntervalHours) : "Sin refresco automático"}
                  {doc.refreshEnabled && doc.nextRefreshAt ? ` · próximo el ${formatDateTime(doc.nextRefreshAt, timezone)}` : ""}
                </Detail>
              )}
            </>
          ) : null}
          {doc.sourceType === "faq" ? (
            <>
              <Detail label="Pregunta">{doc.faqQuestion ?? doc.title}</Detail>
              <Detail label="Respuesta">
                <span className="whitespace-pre-wrap">{doc.contentMd}</span>
              </Detail>
            </>
          ) : null}
          {doc.sourceType === "text" ? <Detail label="Texto">Pegado en la aplicación el {formatDateTime(doc.createdAt, timezone)}</Detail> : null}
        </dl>
        {doc.sourceType === "url" && canManage ? (
          <div className="max-w-xl">
            <RefreshSettings documentId={doc.id} enabled={doc.refreshEnabled} intervalHours={doc.refreshIntervalHours} />
          </div>
        ) : null}
        {doc.sourceType === "faq" && canManage ? (
          <Link href={knowledgeBasePath(base.id, "faq")} className="w-fit text-sm font-medium text-primary-text underline-offset-4 hover:underline">
            Editarla en Preguntas frecuentes
          </Link>
        ) : null}
      </Section>

      <Section id="document-summary" title="Resumen">
        <p className="text-sm text-muted-foreground">
          {doc.summary ?? "Aún no hay resumen: se escribe al procesar el documento y acompaña a cada fragmento en la búsqueda."}
        </p>
      </Section>

      <Section id="document-fragments" title="Fragmentos">
        {doc.chunks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isDocumentInProgress(doc.status) ? "Los fragmentos aparecerán cuando termine de procesarse." : "Este documento no tiene fragmentos."}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground tabular-nums">
              {slice.pages > 1
                ? `Del ${formatNumber(slice.start + 1)} al ${formatNumber(slice.end)} de ${formatNumber(doc.chunks.length)}`
                : countLabel(doc.chunks.length, "fragmento", "fragmentos")}
              , cortados por encabezados, con su sección y página, tal como los encuentran los agentes.
            </p>
            <ol className="grid gap-3">
              {chunks.map((chunk) => (
                <li key={chunk.id} className="grid gap-2 rounded-xl border p-4">
                  <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground tabular-nums">Fragmento {formatNumber(chunk.ord + 1)}</span>
                    {chunk.section ? <span>· {chunk.section}</span> : null}
                    {chunk.page !== null ? <span className="tabular-nums">· pág. {formatNumber(chunk.page)}</span> : null}
                    <span className="tabular-nums">· {countLabel(chunk.tokenCount, "token", "tokens")}</span>
                    {chunk.hasEmbedding ? null : <span>· solo texto</span>}
                  </p>
                  <p className="text-sm break-words whitespace-pre-wrap">{chunk.content}</p>
                </li>
              ))}
            </ol>
            <PageNav slice={slice} path={knowledgeDocumentPath(base.id, doc.id)} label="Páginas de fragmentos" />
          </>
        )}
      </Section>
      <LiveRefresh active={isDocumentInProgress(doc.status) || base.reindexing} />
    </article>
  );
}
