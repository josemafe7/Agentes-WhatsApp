"use client";
// «Importar contactos» ([CTO-11], [CTO-12]): the file and the prefix, «Revisar archivo» (what would happen, row by
// row), the confirmation of the permissions when the file brings them, «Importar» and what was done, with the skipped
// rows to download. The file goes twice to src/app/api/contacts/import/route.ts, which checks everything again.
import { Download, FileCheck2, FileSpreadsheet, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { skippedRowsCsv, type ImportPreview, type ImportResult, type ImportSkipped } from "@/lib/contact-import";
import { formatNumber } from "@/lib/format";
import { downloadImportTemplateAction } from "../../actions";
import { saveBinaryFile, saveTextFile } from "../../_lib/download";
import { contactPath } from "../../_lib/search-params";

const IMPORT_URL = "/api/contacts/import";
const FILE_NAME_HEADER = "x-file-name";

type Failure = { error: string; fieldErrors?: Record<string, string[]> };

const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;

async function send(file: File, query: Record<string, string>): Promise<{ ok: true; data: unknown } | ({ ok: false } & Failure)> {
  try {
    const response = await fetch(`${IMPORT_URL}?${new URLSearchParams(query).toString()}`, {
      method: "POST",
      headers: { [FILE_NAME_HEADER]: encodeURIComponent(file.name), "content-type": "application/octet-stream" },
      body: file,
    });
    const body = (await response.json().catch(() => ({}))) as Failure;
    if (!response.ok) return { ok: false, error: body.error || "Algo ha fallado. Inténtalo de nuevo.", fieldErrors: body.fieldErrors };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: "No se ha podido enviar el archivo. Comprueba la conexión e inténtalo de nuevo." };
  }
}

function matchText(row: ImportSkipped) {
  if ("line" in row.match) return `la fila ${row.match.line} del archivo`;
  return (
    <Link href={contactPath(row.match.contactId)} className="underline">
      {row.match.name ?? "un contacto sin nombre"}
    </Link>
  );
}

/** As a list of cards, which fits any width ([DESIGN.md «Tablas»]). */
function SkippedList({ skipped }: { skipped: readonly ImportSkipped[] }) {
  return (
    <ul className="grid gap-2">
      {skipped.map((row) => (
        <li key={row.line} className="rounded-lg border px-3 py-2 text-sm">
          <p className="font-medium">
            Fila {row.line}: <span className="break-all">{[row.name, row.phone ? `+${row.phone}` : null, row.email].filter(Boolean).join(" · ")}</span>
          </p>
          <p className="text-muted-foreground">
            Ya está como {matchText(row)} (mismo {row.reason === "email" ? "email" : "teléfono"}).
          </p>
        </li>
      ))}
    </ul>
  );
}

function Summary({ preview, imported }: { preview: ImportPreview; imported?: number }) {
  return (
    <div className="grid gap-4">
      <p aria-live="polite" className="text-sm">
        {imported === undefined
          ? `«${preview.fileName}»: ${plural(preview.rows, "fila", "filas")}. ${plural(preview.toImport, "contacto entrará", "contactos entrarán")}, ${plural(preview.skipped.length, "se salta porque ya existe", "se saltan porque ya existen")} y ${plural(preview.errors.length, "tiene errores", "tienen errores")}.`
          : `${plural(imported, "contacto importado", "contactos importados")} de «${preview.fileName}». ${plural(preview.skipped.length, "fila se ha saltado", "filas se han saltado")} porque ya existían y ${plural(preview.errors.length, "tenía errores", "tenían errores")}.`}
      </p>
      {preview.unknownColumns.length > 0 ? (
        <p className="text-sm text-muted-foreground">Columnas que la app no conoce y se dejan fuera: {preview.unknownColumns.map((title) => `«${title}»`).join(", ")}.</p>
      ) : null}
      {preview.errors.length > 0 ? (
        <section aria-labelledby="importar-errores" className="grid gap-2">
          <h3 id="importar-errores" className="text-sm font-semibold">
            Filas con errores (no se importan)
          </h3>
          <ul className="grid gap-2">
            {preview.errors.map((row) => (
              <li key={row.line} className="rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">Fila {row.line}:</span> {row.errors.join(" ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {preview.skipped.length > 0 ? (
        <section aria-labelledby="importar-saltadas" className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="importar-saltadas" className="text-sm font-semibold">
              Filas que se saltan porque ya existen
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => saveTextFile({ fileName: "contactos-saltados.csv", mimeType: "text/csv;charset=utf-8", content: skippedRowsCsv(preview.skipped) })}
            >
              <Download aria-hidden />
              Descargar la lista
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">La importación nunca cambia un contacto que ya existía.</p>
          <SkippedList skipped={preview.skipped} />
        </section>
      ) : null}
    </div>
  );
}

export function ContactImportForm({ maxMegabytes, defaultPrefix }: { maxMegabytes: number; defaultPrefix: string }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [prefix, setPrefix] = useState(defaultPrefix);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"review" | "import">("review");
  const reviewing = pending && step === "review";
  const importing = pending && step === "import";
  const [downloading, startDownload] = useTransition();

  function reset(next: File | null) {
    setFile(next);
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    setFailure(null);
  }

  function downloadTemplate() {
    startDownload(async () => {
      const answer = await downloadImportTemplateAction();
      if (!answer.ok || !answer.data) {
        toast.error(answer.ok ? "No se ha podido descargar. Inténtalo de nuevo." : answer.error);
        return;
      }
      saveBinaryFile(answer.data);
    });
  }

  function review() {
    if (!file) return;
    setStep("review");
    startTransition(async () => {
      const answer = await send(file, { paso: "revisar", prefijo: prefix });
      if (!answer.ok) {
        setFailure(answer);
        setPreview(null);
        return;
      }
      setFailure(null);
      setPreview(answer.data as ImportPreview);
    });
  }

  function importNow() {
    if (!file) return;
    setStep("import");
    startTransition(async () => {
      const answer = await send(file, { paso: "importar", prefijo: prefix, ...(confirmed ? { confirmar: "1" } : {}) });
      if (!answer.ok) {
        setFailure(answer);
        return;
      }
      const done = answer.data as ImportResult;
      setFailure(null);
      setResult(done);
      toast.success(done.imported === 1 ? "1 contacto importado." : `${formatNumber(done.imported)} contactos importados.`);
    });
  }

  const fieldError = (name: string) => failure?.fieldErrors?.[name]?.map((message) => ({ message }));

  if (result) {
    return (
      <div className="grid max-w-[880px] gap-6 rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileCheck2 aria-hidden className="size-5 text-success" />
          Importación terminada
        </h2>
        <Summary preview={result} imported={result.imported} />
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/contactos">Ir a Contactos</Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => reset(null)}>
            Importar otro archivo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid max-w-[880px] gap-6">
      <section aria-labelledby={`${id}-archivo`} className="grid gap-4 rounded-xl border p-4">
        <h2 id={`${id}-archivo`} className="text-base font-semibold">
          1. El archivo
        </h2>
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>
            Un Excel (.xlsx) o un CSV de hasta 5.000 contactos y {maxMegabytes} MB. La primera fila lleva los títulos: <strong>Nombre</strong>, <strong>Teléfono</strong>,{" "}
            <strong>Email</strong> y <strong>Etiquetas</strong> (separadas por comas). Cada contacto necesita teléfono o email.
          </p>
          <p>
            Para cada permiso, <strong>Avisos de sus citas</strong> y <strong>Novedades y publicidad</strong>, «sí» o «no»; y si quieres, su fecha (<strong>Fecha avisos</strong>,{" "}
            <strong>Fecha novedades</strong>, como 15/09/2026) y cómo lo dio (<strong>Cómo dio avisos</strong>, <strong>Cómo dio novedades</strong>: en persona, por escrito, en la web…).
            Sin fecha se pone la de hoy y, sin cómo, «importado». <strong>Avisos de sus citas</strong> se da por hecho: déjalo vacío o pon «sí» para avisarles, y «no»
            solo para quien no quiere avisos.
          </p>
        </div>
        <div>
          <Button type="button" variant="outline" onClick={downloadTemplate} disabled={downloading} aria-busy={downloading}>
            {downloading ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <FileSpreadsheet aria-hidden />}
            {downloading ? "Descargando…" : "Descargar plantilla"}
          </Button>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-fichero`}>Archivo</Label>
          <Input id={`${id}-fichero`} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => reset(event.target.files?.[0] ?? null)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-prefijo`}>Prefijo de los teléfonos que no lo llevan</Label>
          <Input
            id={`${id}-prefijo`}
            className="w-28"
            inputMode="tel"
            value={prefix}
            onChange={(event) => {
              setPrefix(event.target.value);
              setPreview(null);
            }}
            aria-describedby={`${id}-prefijo-ayuda`}
          />
          <p id={`${id}-prefijo-ayuda`} className="text-sm text-muted-foreground">
            España es +34. Los que empiezan por + o por 00 conservan el suyo.
          </p>
          <FieldError errors={fieldError("prefix")} />
        </div>
        {failure && !failure.fieldErrors ? (
          <p role="alert" className="text-sm text-destructive-text">
            {failure.error}
          </p>
        ) : null}
        <div>
          {/* One main button: once the file is checked, the main one is «Importar». */}
          <Button type="button" variant={preview ? "outline" : "default"} onClick={review} disabled={!file || pending} aria-busy={reviewing}>
            {reviewing ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            {reviewing ? "Revisando…" : "Revisar archivo"}
          </Button>
        </div>
      </section>

      {preview ? (
        <section aria-labelledby={`${id}-revision`} className="grid gap-4 rounded-xl border p-4">
          <h2 id={`${id}-revision`} className="text-base font-semibold">
            2. Lo que se importará
          </h2>
          <Summary preview={preview} />
          {preview.grantsPermissions ? (
            <div className="grid gap-2 rounded-lg bg-warning-soft p-3">
              <p className="flex items-start gap-2 text-sm text-warning">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>El archivo marca permisos como dados. Solo valen si los clientes los dieron de verdad: queda anotado que tú lo confirmas.</span>
              </p>
              <div className="flex items-start gap-2">
                <Checkbox id={`${id}-confirmo`} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
                <Label htmlFor={`${id}-confirmo`} className="font-normal">
                  Confirmo que estos clientes dieron de verdad los permisos que marca el archivo
                </Label>
              </div>
              <FieldError errors={fieldError("confirmPermissions")} />
            </div>
          ) : null}
          <div>
            <Button type="button" onClick={importNow} disabled={pending || preview.toImport === 0 || (preview.grantsPermissions && !confirmed)} aria-busy={importing}>
              {importing ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {importing ? "Importando…" : preview.toImport === 1 ? "Importar 1 contacto" : `Importar ${formatNumber(preview.toImport)} contactos`}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
