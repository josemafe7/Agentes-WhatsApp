import { MessageCircleQuestionMark } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { listKnowledgeFaqs } from "@/data/knowledge-documents";
import { FaqForm } from "../../_components/faq-form";
import { FaqList } from "../../_components/faq-list";
import { LiveRefresh } from "../../_components/live-refresh";
import { PageNav } from "../../_components/page-nav";
import { needsLiveRefresh } from "../../_lib/labels";
import { loadKnowledgePage } from "../../_lib/load";
import { LIST_PAGE_SIZE, PAGE_PARAM, pageSlice } from "../../_lib/pagination";
import { knowledgeBasePath } from "../../_lib/paths";

export const metadata: Metadata = { title: "Preguntas frecuentes" };
// Saving a FAQ starts its processing right after answering (KNOWLEDGE_MAX_DURATION_SEC).
export const maxDuration = 60;

type FaqPageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Preguntas frecuentes of a base (docs/pantallas.md, [CON-04]): an editable list of question and answer. Each one is
 * a small document of the base, found by the agents like any other. 25 per page (DESIGN.md).
 */
export default async function KnowledgeFaqPage({ params, searchParams }: FaqPageProps) {
  const page = await loadKnowledgePage(params, "faq");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, base, canManage } = page;
  const faqs = await listKnowledgeFaqs(actor, base.id);
  const slice = pageSlice((await searchParams)[PAGE_PARAM], faqs.length, LIST_PAGE_SIZE);

  return (
    <div className="grid max-w-3xl gap-6">
      {canManage ? (
        <section aria-labelledby="new-faq-heading" className="grid gap-4 rounded-xl border p-4 md:p-6">
          <div className="grid gap-1">
            <h2 id="new-faq-heading" className="text-lg font-semibold">
              Nueva pregunta frecuente
            </h2>
            <p className="text-sm text-muted-foreground">Lo que tus clientes preguntan a menudo, con la respuesta que quieres que den los agentes.</p>
          </div>
          <FaqForm kbId={base.id} idPrefix="new-faq" />
        </section>
      ) : null}
      <section aria-labelledby="faq-list-heading" className="grid gap-4">
        <h2 id="faq-list-heading" className="text-lg font-semibold">
          Preguntas de esta base
        </h2>
        {faqs.length === 0 ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={MessageCircleQuestionMark}
              title="Aún no hay preguntas frecuentes"
              description="Las preguntas con su respuesta son la forma más rápida de que los agentes contesten bien a lo que más se repite."
            />
          </div>
        ) : (
          <>
            <FaqList kbId={base.id} faqs={faqs.slice(slice.start, slice.end)} canManage={canManage} />
            <PageNav slice={slice} path={knowledgeBasePath(base.id, "faq")} label="Páginas de preguntas" />
          </>
        )}
      </section>
      <LiveRefresh active={needsLiveRefresh(faqs, false)} />
    </div>
  );
}
