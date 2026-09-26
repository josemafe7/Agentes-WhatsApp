import { ChevronLeft, ChevronRight, History, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listActivity, listActivityActions, type ActivityPage } from "@/data/activity";
import { getBusinessProfile } from "@/data/settings";
import { formatDateTime, formatNumber } from "@/lib/format";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { ValidationError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { ActivityFilters } from "./_components/activity-filters";
import { ActivityTable, type ActivityRow } from "./_components/activity-table";
import { ACTOR_TYPE_LABELS, actionLabel, detailLines, targetLabel } from "./_lib/labels";
import { ACTIVITY_PATH, activityHref, activityQueryFromSearchParams } from "./_lib/search-params";

export const metadata: Metadata = { title: "Registro de actividad" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Ajustes › Registro de actividad ([AJU-10], [SEG-10]): what people, the AI and the system did. Read-only. */
export default async function ActivityPage({ searchParams }: PageProps) {
  const actor = await requirePageActor({ next: ACTIVITY_PATH });
  if (!can(actor, PERMISSIONS.settings.auditLog)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const { query, filter } = activityQueryFromSearchParams(await searchParams);
  const [actions, profile] = await Promise.all([listActivityActions(actor), getBusinessProfile(actor)]);

  let page: ActivityPage | null = null;
  try {
    page = await listActivity(actor, filter);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }

  const header = (
    <>
      <PageHeader
        title="Registro de actividad"
        description="Lo que hacen las personas del equipo, la IA y el sistema. Nadie puede editarlo ni borrarlo."
      />
      <ActivityFilters key={JSON.stringify(query)} query={query} actions={actions.map((value) => ({ value, label: actionLabel(value) }))} />
    </>
  );

  if (!page) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Algún filtro no es válido"
          description="Revisa las fechas (la de inicio va antes que la de fin) o quita los filtros."
          retry={
            <Button asChild variant="outline">
              <Link href={ACTIVITY_PATH}>Quitar filtros</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const hasFilters = Object.keys(query).length > 0;
  const rows: ActivityRow[] = page.entries.map((entry) => ({
    id: entry.id,
    when: formatDateTime(entry.createdAt, profile.timezone),
    actorType: entry.actorType,
    who: entry.actorType === "user" ? (entry.actorName ?? "Persona borrada") : ACTOR_TYPE_LABELS[entry.actorType],
    action: actionLabel(entry.action),
    actionCode: entry.action,
    target: targetLabel(entry.targetType),
    details: detailLines(entry.details),
  }));

  return (
    <div className="space-y-6">
      {header}
      {rows.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="Nada coincide con estos filtros"
            action={
              <Button asChild variant="outline">
                <Link href={ACTIVITY_PATH}>Quitar filtros</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={History}
            title="Todavía no hay actividad"
            description="Aquí aparecerán las invitaciones, los cambios de rol y de ajustes, las conexiones de canales y lo que haga la IA."
          />
        )
      ) : (
        <>
          <ActivityTable rows={rows} />
          <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground tabular-nums">
              {formatNumber(page.total)} {page.total === 1 ? "entrada" : "entradas"} · Página {page.page} de {page.pageCount}
            </p>
            <div className="flex gap-2">
              {page.page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={activityHref(query, page.page - 1)}>
                    <ChevronLeft aria-hidden />
                    Anterior
                  </Link>
                </Button>
              ) : null}
              {page.page < page.pageCount ? (
                <Button asChild variant="outline">
                  <Link href={activityHref(query, page.page + 1)}>
                    Siguiente
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
