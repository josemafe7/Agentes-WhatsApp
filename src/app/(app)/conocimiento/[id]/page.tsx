import { FileText, LoaderCircle } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { listKnowledgeDocuments } from "@/data/knowledge-documents";
import { AddContentDialog } from "../_components/add-content-dialog";
import { DocumentsTable } from "../_components/documents-table";
import { LiveRefresh } from "../_components/live-refresh";
import { PageNav } from "../_components/page-nav";
import { mistralKeyHintFor, toDocumentRows } from "../_lib/document-rows";
import { needsLiveRefresh } from "../_lib/labels";
import { loadKnowledgePage } from "../_lib/load";
import { LIST_PAGE_SIZE, PAGE_PARAM, pageSlice } from "../_lib/pagination";
import { knowledgeBasePath } from "../_lib/paths";

export const metadata: Metadata = { title: "Documentos" };
// Adding content starts its processing right after answering (KNOWLEDGE_MAX_DURATION_SEC).
export const maxDuration = 60;

type DocumentsPageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Documentos of a base (docs/pantallas.md, [CON-04], [CON-05]): each document with its type, live ingest status
 * (en cola → extrayendo → troceando → embeddings → listo o error, with the reason), pages, fragments and date;
 * «Añadir contenido», retry, refresh and delete for owner, admin and supervisor. 25 per page (DESIGN.md).
 */
export default async function KnowledgeDocumentsPage({ params, searchParams }: DocumentsPageProps) {
  const page = await loadKnowledgePage(params);
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, base, canManage, timezone } = page;
  const documents = await listKnowledgeDocuments(actor, base.id);
  const slice = pageSlice((await searchParams)[PAGE_PARAM], documents.length, LIST_PAGE_SIZE);
  const rows = toDocumentRows(documents.slice(slice.start, slice.end), { kbId: base.id, timezone, hint: mistralKeyHintFor(actor) });
  const live = needsLiveRefresh(documents, base.reindexing);

  return (
    <section aria-labelledby="documents-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="documents-heading" className="text-lg font-semibold">
          Documentos
        </h2>
        {canManage && documents.length > 0 ? <AddContentDialog kbId={base.id} /> : null}
      </div>
      {base.reindexing ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
          <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          Reindexando: los agentes siguen buscando en el índice anterior hasta que el nuevo esté completo.
        </p>
      ) : null}
      {documents.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={FileText}
            title="Aún no hay documentos"
            description="Sube archivos PDF, Word, Excel, CSV, texto o Markdown, añade páginas de tu web o escribe preguntas frecuentes."
            action={canManage ? <AddContentDialog kbId={base.id} /> : undefined}
          />
        </div>
      ) : (
        <>
          <DocumentsTable rows={rows} canManage={canManage} />
          <PageNav slice={slice} path={knowledgeBasePath(base.id)} label="Páginas de documentos" />
        </>
      )}
      {live ? <p className="text-xs text-muted-foreground">El estado se actualiza solo mientras se procesan documentos.</p> : null}
      <LiveRefresh active={live} />
    </section>
  );
}
