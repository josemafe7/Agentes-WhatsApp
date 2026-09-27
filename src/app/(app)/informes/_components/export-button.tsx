"use client";

// «Descargar CSV» of one table: the server builds the file (and logs the export, [SEG-10]); the browser saves it.
import { Download, LoaderCircle } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ReportFilter } from "@/data/reports";
import { exportReportTableAction } from "../actions";
import type { ReportTableKey } from "../_lib/tables";

/** Long enough for the browser to start saving before the file's temporary address is released. */
const RELEASE_URL_AFTER_MS = 1_000;
/**
 * The UTF-8 mark a spreadsheet in Spanish needs to read the accents. The server writes it, but a Server Action's answer
 * loses a leading one on the way (its text is decoded as a new stream): the file gets it back here, once.
 */
const BYTE_ORDER_MARK = "\uFEFF";

function saveFile(fileName: string, content: string): void {
  const csv = content.startsWith(BYTE_ORDER_MARK) ? content : BYTE_ORDER_MARK + content;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), RELEASE_URL_AFTER_MS);
}

export function ExportCsvButton({ table, title, filter }: { table: ReportTableKey; title: string; filter: ReportFilter }) {
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const result = await exportReportTableAction({ table, filter });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data) saveFile(result.data.fileName, result.data.csv);
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={pending} aria-label={`${pending ? "Preparando CSV" : "Descargar CSV"}: ${title}`}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Download aria-hidden />}
      {pending ? "Preparando…" : "Descargar CSV"}
    </Button>
  );
}
