import { History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAgentVersion, listAgentVersions, type AgentVersionItem } from "@/data/agents";
import { getBusinessProfile } from "@/data/settings";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { agentPath } from "../../_lib/labels";
import { RestoreVersionButton } from "../_components/restore-version-button";
import { loadEditorPage } from "../_lib/load";
import { versionChanges } from "../_lib/version-diff";

export const metadata: Metadata = { title: "Versiones del agente" };

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string | string[] }> };

/** «?version=3» → 3, or null. */
function versionParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

/** Versiones ([AGE-12]): every save with date and author; «Ver» shows what restoring would change. */
export default async function AgentVersionsPage({ params, searchParams }: PageProps) {
  const page = await loadEditorPage(params, "versiones");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent, canManage } = page;
  const [versions, profile] = await Promise.all([listAgentVersions(actor, agent.id), getBusinessProfile(actor)]);
  const versionsHref = agentPath(agent.id, "versiones");
  const wanted = versionParam((await searchParams).version);
  const selected = versions.find((version) => version.version === wanted) ?? null;

  if (versions.length === 0) {
    return (
      <div className="max-w-2xl rounded-xl border">
        <EmptyState icon={History} title="Todavía no hay versiones" description="Cada vez que guardes el agente se creará una versión." />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <section aria-labelledby="versions-title" className="grid gap-3">
        <h2 id="versions-title" className="text-lg font-semibold">
          Historial
        </h2>
        <ol className="grid divide-y rounded-xl border">
          {versions.map((version) => (
            <li key={version.version} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3", version === selected && "bg-primary-soft")}>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="flex items-center gap-2 text-sm font-medium">
                  Versión {version.version}
                  {version.current ? (
                    <Badge variant="outline" className="h-[22px]">
                      Actual
                    </Badge>
                  ) : null}
                  {/* Keeps «Versión 1» apart from the date in the text read by assistive technology. */}{" "}
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={version.createdAt.toISOString()} className="tabular-nums">
                    {formatDateTime(version.createdAt, profile.timezone)}
                  </time>
                  {" · "}
                  {version.createdByName ?? "Persona borrada"}
                </p>
              </div>
              {version.current ? null : (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`${versionsHref}?version=${version.version}`} aria-current={version === selected ? "true" : undefined}>
                    Ver
                    <span className="sr-only"> la versión {version.version}</span>
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ol>
      </section>
      {selected ? (
        <VersionDetail
          agentId={agent.id}
          version={selected}
          changes={versionChanges(agent, await getAgentVersion(actor, agent.id, selected.version))}
          nextVersion={agent.currentVersion + 1}
          timezone={profile.timezone}
          canRestore={canManage}
          versionsHref={versionsHref}
        />
      ) : null}
    </div>
  );
}

type VersionDetailProps = {
  agentId: string;
  version: AgentVersionItem;
  changes: ReturnType<typeof versionChanges>;
  nextVersion: number;
  timezone: string;
  canRestore: boolean;
  versionsHref: string;
};

function VersionDetail({ agentId, version, changes, nextVersion, timezone, canRestore, versionsHref }: VersionDetailProps) {
  return (
    <section aria-labelledby="version-detail-title" className="grid gap-4 rounded-xl border p-4 lg:sticky lg:top-24">
      <div className="grid gap-1">
        <h2 id="version-detail-title" className="text-base font-semibold">
          Versión {version.version}
        </h2>
        <p className="text-sm text-muted-foreground">
          Guardada el {formatDateTime(version.createdAt, timezone)} por {version.createdByName ?? "una persona borrada"}.
        </p>
      </div>
      {changes.length === 0 ? (
        <p className="text-sm">Es igual que la configuración actual.</p>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Si la restauras, cambia:</p>
          <ul className="grid gap-2">
            {changes.map((change) => (
              <li key={change.field} className="text-sm">
                <span className="font-medium">{change.label}</span>
                {change.detail ? <span className="text-muted-foreground">: {change.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canRestore && changes.length > 0 ? (
          <RestoreVersionButton agentId={agentId} version={version.version} nextVersion={nextVersion} versionsHref={versionsHref} />
        ) : null}
        <Button asChild variant="outline">
          <Link href={versionsHref}>Cerrar</Link>
        </Button>
      </div>
    </section>
  );
}
