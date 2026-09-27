import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { isAiConfigured } from "@/data/settings";
import { SearchTester } from "../../_components/search-tester";
import { loadKnowledgePage } from "../../_lib/load";

export const metadata: Metadata = { title: "Probar búsqueda" };
// Embedding the query and, with «Reordenar resultados», the rerank run inside the Server Action.
export const maxDuration = 60;

type TestSearchPageProps = { params: Promise<{ id: string }> };

/** «Probar búsqueda» ([CON-21]): owner, admin and supervisor; viewer and agent get «Sin permiso» ([PER-01]). */
export default async function KnowledgeTestSearchPage({ params }: TestSearchPageProps) {
  const page = await loadKnowledgePage(params, "probar");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  if (!page.canTest) return <NoPermission description={noPermissionDescription(page.actor.role)} />;
  const aiConfigured = await isAiConfigured();

  return (
    <section aria-labelledby="test-search-heading" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="test-search-heading" className="text-lg font-semibold">
          Probar búsqueda
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Los fragmentos que encontraría el agente en «{page.base.name}», numerados como los recibe, con su puntuación y su fuente.
        </p>
      </div>
      <SearchTester kbId={page.base.id} aiConfigured={aiConfigured} />
    </section>
  );
}
