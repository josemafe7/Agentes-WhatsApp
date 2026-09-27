"use server";
// Server Action of Informes: «Descargar CSV» of one table ([INF-01]–[INF-07]). Thin: session and permission here, then
// src/data/reports.ts, which checks the permission again and validates the period and the channel ([SEG-04],
// [SEG-05]). The CSV is the same table «Ver datos» shows. Every export goes to the activity log, with the table and the
// period and nothing personal ([SEG-10]).
import { z } from "zod";
import { writeAudit } from "@/data/audit";
import { getReport } from "@/data/reports";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { parseInput, toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { tableToCsv } from "./_lib/csv";
import { buildReportTable, csvFileName, REPORT_TABLE_KEYS } from "./_lib/tables";

export type ReportCsv = { fileName: string; csv: string };

const exportSchema = z
  .object({
    table: z.enum(REPORT_TABLE_KEYS, { error: "Elige una tabla del informe." }),
    /** The period and channel on screen; src/data/reports.ts validates it. */
    filter: z.unknown(),
  })
  .strict();

export async function exportReportTableAction(input: unknown): Promise<ActionResult<ReportCsv>> {
  try {
    const actor = await requirePermission(PERMISSIONS.reports.view);
    const { table, filter } = parseInput(exportSchema, input);
    const report = await getReport(actor, filter ?? {});
    const csv = tableToCsv(buildReportTable(report, table));
    await writeAudit({
      actor,
      action: "report.exported",
      targetType: "report",
      metadata: { table, firstDay: report.period.firstDay, lastDay: report.period.lastDay, channelFiltered: report.channelId !== null },
    });
    return ok({ fileName: csvFileName(table, report.period), csv });
  } catch (error) {
    return toActionFailure(error);
  }
}
