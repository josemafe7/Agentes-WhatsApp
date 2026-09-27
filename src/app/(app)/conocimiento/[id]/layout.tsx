import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { BaseTabs } from "../_components/base-tabs";
import { BaseStateBadge } from "../_components/status-badge";
import { loadKnowledgePage } from "../_lib/load";
import { KNOWLEDGE_BASE_TABS, KNOWLEDGE_PATH, knowledgeBasePath } from "../_lib/paths";

type BaseLayoutProps = { children: ReactNode; params: Promise<{ id: string }> };

/**
 * A knowledge base (docs/pantallas.md «Base de conocimiento»): header with its state and one tab per route. Viewer
 * sees it read-only and without «Probar búsqueda»; each tab checks its own permission again ([SEG-04]).
 */
export default async function KnowledgeBaseLayout({ children, params }: BaseLayoutProps) {
  const page = await loadKnowledgePage(params);
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { base, canManage, canTest } = page;

  const tabs = KNOWLEDGE_BASE_TABS.filter((tab) => tab.key !== "test" || canTest).map((tab) => ({
    key: tab.key,
    label: tab.label,
    href: knowledgeBasePath(base.id, tab.segment),
  }));

  return (
    <div className="flex flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Conocimiento", href: KNOWLEDGE_PATH }, { label: base.name }]}
        title={base.name}
        description={base.description ?? undefined}
        actions={
          <>
            <BaseStateBadge state={base.state} />
            {canManage ? null : (
              <Badge variant="outline" className="h-[22px] gap-1">
                <Eye aria-hidden />
                Solo lectura
              </Badge>
            )}
          </>
        }
      />
      <BaseTabs tabs={tabs} baseHref={knowledgeBasePath(base.id)} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
