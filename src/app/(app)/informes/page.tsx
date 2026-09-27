import { ChartColumn, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { agendaWords } from "@/app/(app)/agenda/_lib/labels";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getReport, type Report, type ReportFilter } from "@/data/reports";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { instantToLocal } from "@/server/booking/time";
import { ValidationError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { ChannelsChart, CostsChart, OriginsChart, ResponseChart } from "./_components/charts";
import { KpiGrid } from "./_components/kpi-grid";
import { ReportCard } from "./_components/report-card";
import { ReportToolbar } from "./_components/report-toolbar";
import { countOf } from "./_lib/format";
import { NO_DATA, RESPONSE_LAW_NOTE } from "./_lib/labels";
import { parseReportsQuery, REPORTS_PATH, reportFilterOf } from "./_lib/search-params";
import { buildReportTable, type ReportTableKey } from "./_lib/tables";
import { channelBars, costBars, emptyCharts, hasActivity, originBars, reportKpis, responseBars } from "./_lib/view";

export const metadata: Metadata = { title: "Informes" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const NEW_CHANNEL_PATH = "/canales/nuevo";
const WHATSAPP_RATES_PATH = "/ajustes/whatsapp";
const NO_ANSWERS = "Ningún traspaso atendido por una persona en este periodo";

/**
 * Informes ([INF-01]–[INF-08], [CUM-11]): the current month by default, or another month or some days, in the business
 * time zone, for every channel or one. Indicators, four charts with «Ver datos», the reasons of the hand-offs and
 * «Descargar CSV» of each table. Owner, admin, supervisor and viewer; «Descargar CSV» only owner and admin ([INF-09]);
 * the server checks it again for every read and every export ([PER-01] «Informes»).
 */
export default async function ReportsPage({ searchParams }: PageProps) {
  const actor = await requirePageActor({ next: REPORTS_PATH });
  if (!can(actor, PERMISSIONS.reports.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const query = parseReportsQuery(await searchParams);
  const filter = reportFilterOf(query);
  const report = await loadReport(actor, filter);
  if (!report) {
    return (
      <>
        <PageHeader title="Informes" description="Conversaciones, traspasos y costes de cada periodo, en la hora del negocio." />
        <ErrorState
          title="Algún filtro no es válido"
          description="Revisa el periodo (un año como mucho) y el canal, o vuelve al mes actual."
          retry={
            <Button asChild variant="outline">
              <Link href={REPORTS_PATH}>Ver este mes</Link>
            </Button>
          }
        />
      </>
    );
  }

  const words = agendaWords(report.terminology);
  const description = `Conversaciones, traspasos, ${words.bookings} y costes de cada periodo, en la hora del negocio.`;

  // A new business: nothing to count yet ([INF-01]).
  if (report.channels.length === 0 && !hasActivity(report)) {
    return (
      <>
        <PageHeader title="Informes" description={description} />
        <div className="rounded-xl border">
          <EmptyState
            icon={ChartColumn}
            title="Todavía no hay datos"
            description={`Cuando tus canales reciban conversaciones, aquí verás cuántas resuelve la IA, los traspasos, las ${words.bookings} creadas por la IA y los costes de cada mes.`}
            action={
              can(actor, PERMISSIONS.channels.manage) ? (
                <Button asChild>
                  <Link href={NEW_CHANNEL_PATH}>Añadir un canal</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      </>
    );
  }

  const { period, firstResponse, costs } = report;
  const currentMonth = instantToLocal(new Date(), period.timezone).date.slice(0, 7);
  const empty = emptyCharts(report);
  const table = (key: ReportTableKey) => buildReportTable(report, key);
  const byDay = firstResponse.granularity === "day";
  // «Descargar CSV»: owner and admin ([INF-09]); the action checks it again.
  const canExport = can(actor, PERMISSIONS.reports.export);

  return (
    <>
      <PageHeader title="Informes" description={description} />
      <ReportToolbar query={query} period={period} currentMonth={currentMonth} channels={report.channels} />
      <KpiGrid kpis={reportKpis(report)} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ReportCard
          table={table("canales")}
          description="Conversaciones en las que el cliente escribió en el periodo, y las que resolvió la IA sin traspaso ni personas."
          filter={filter}
          canExport={canExport}
          chart={<ChannelsChart data={channelBars(report)} />}
          empty={empty.channels ? NO_DATA : null}
        />
        <ReportCard
          table={table("traspasos")}
          description="Quién pasó la conversación a una persona: la IA, una regla del agente o alguien del equipo."
          filter={filter}
          canExport={canExport}
          chart={<OriginsChart data={originBars(report)} />}
          empty={empty.origins ? NO_DATA : null}
        />
        <ReportCard
          table={table("primera-respuesta")}
          description={`Mediana ${byDay ? "por día" : "por mes"} del tiempo desde el traspaso hasta el primer mensaje de una persona.`}
          filter={filter}
          canExport={canExport}
          chart={<ResponseChart data={responseBars(report)} />}
          empty={empty.response === "no-handoffs" ? NO_DATA : empty.response === "no-answers" ? NO_ANSWERS : null}
          note={<Note>{RESPONSE_LAW_NOTE}</Note>}
        />
        <ReportCard
          table={table("costes")}
          description="Coste de la IA según OpenRouter y coste estimado de WhatsApp, en US$, de los últimos meses."
          filter={filter}
          canExport={canExport}
          chart={<CostsChart data={costBars(report)} />}
          empty={empty.costs ? NO_DATA : null}
          note={
            costs.whatsappUnpriced > 0 ? (
              <Note>
                {costs.whatsappUnpriced === 1
                  ? "1 mensaje de WhatsApp cobrado en este periodo no tiene tarifa para su país: no se ha estimado."
                  : `${countOf(costs.whatsappUnpriced, "mensaje", "mensajes")} de WhatsApp cobrados en este periodo no tienen tarifa para su país: no se han estimado.`}
                {can(actor, PERMISSIONS.settings.business) ? (
                  <>
                    {" "}
                    <Link href={WHATSAPP_RATES_PATH} className="font-medium underline underline-offset-4">
                      Añadir tarifas
                    </Link>
                  </>
                ) : null}
              </Note>
            ) : null
          }
        />
        <ReportCard table={table("motivos")} description="Lo que se anotó al pasar cada conversación a una persona, de más a menos frecuente." filter={filter} canExport={canExport} className="xl:col-span-2" />
      </div>
    </>
  );
}

/** The report, or null when the URL asks for a period or channel that is not valid ([SEG-05]). */
async function loadReport(actor: Actor, filter: ReportFilter): Promise<Report | null> {
  try {
    return await getReport(actor, filter);
  } catch (error) {
    if (error instanceof ValidationError) return null;
    throw error;
  }
}

/** A short explanation under a chart, as information (DESIGN.md «Colores semánticos»). */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
      <Info aria-hidden className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
