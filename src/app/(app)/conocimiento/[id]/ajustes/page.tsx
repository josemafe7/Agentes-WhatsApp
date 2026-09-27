import type { Metadata } from "next";
import type { ReactNode } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { isAiConfigured } from "@/data/settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { BaseDetailsForm, DeleteBaseButton, EmbeddingsSettings } from "../../_components/base-settings";
import { loadKnowledgePage } from "../../_lib/load";

export const metadata: Metadata = { title: "Ajustes de la base" };
// Changing the model or re-indexing starts the work right after answering (KNOWLEDGE_MAX_DURATION_SEC).
export const maxDuration = 60;

type SettingsPageProps = { params: Promise<{ id: string }> };

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 rounded-xl border p-4 md:p-6">
      <div className="grid gap-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Ajustes of a base (docs/pantallas.md): name, embeddings model (1536 dimensions), «Reindexar» and «Borrar base»
 * typing its name ([CON-11], [CON-13], [CON-15]). Viewer sees the data without actions ([PER-03]).
 */
export default async function KnowledgeBaseSettingsPage({ params }: SettingsPageProps) {
  const page = await loadKnowledgePage(params, "ajustes");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, base, canManage } = page;

  if (!canManage) {
    return (
      <Section id="base-data" title="Datos de la base">
        <dl className="grid gap-3 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">Nombre</dt>
          <dd>{base.name}</dd>
          <dt className="text-muted-foreground">Descripción</dt>
          <dd>{base.description || "Sin descripción"}</dd>
          <dt className="text-muted-foreground">Modelo de embeddings</dt>
          <dd className="font-mono">{base.embeddingModel}</dd>
          <dt className="text-muted-foreground">Dimensiones</dt>
          <dd className="tabular-nums">{base.embeddingDims}</dd>
        </dl>
      </Section>
    );
  }

  const aiConfigured = await isAiConfigured();
  return (
    <div className="grid max-w-3xl gap-6">
      <Section id="base-data" title="Datos de la base">
        <BaseDetailsForm kbId={base.id} name={base.name} description={base.description} />
      </Section>
      <Section id="base-embeddings" title="Búsqueda por significado">
        <EmbeddingsSettings
          kbId={base.id}
          name={base.name}
          model={base.embeddingModel}
          dimensions={base.embeddingDims}
          reindexing={base.reindexing}
          aiConfigured={aiConfigured}
          canManageKey={can(actor, PERMISSIONS.settings.integrations)}
        />
      </Section>
      <Section id="base-delete" title="Borrar la base" description="Borra sus documentos, fragmentos y archivos. Para confirmarlo tendrás que escribir su nombre.">
        <div>
          <DeleteBaseButton kbId={base.id} name={base.name} agentCount={base.agents.length} />
        </div>
      </Section>
    </div>
  );
}
