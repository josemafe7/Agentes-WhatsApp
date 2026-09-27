"use client";

import { CircleCheck, CircleX, FileUp, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checkFileBeforeUpload, countLabel, formatFileSize, KNOWLEDGE_FILE_ACCEPT, MAX_KB_FILE_MB } from "../_lib/labels";
import { FILE_NAME_HEADER, knowledgeUploadUrl } from "../_lib/paths";

type Upload = { key: string; file: File; state: "ready" | "invalid" | "uploading" | "done" | "error"; message: string | null };

const NETWORK_ERROR = "No se ha podido subir el archivo. Revisa la conexión y vuelve a intentarlo.";
const GENERIC_ERROR = "No se ha podido subir el archivo. Inténtalo de nuevo.";

function toUploads(files: FileList | File[]): Upload[] {
  return Array.from(files).map((file) => {
    const problem = checkFileBeforeUpload(file);
    return { key: crypto.randomUUID(), file, state: problem ? "invalid" : "ready", message: problem };
  });
}

/** The answer of the upload route: its message (success or the reason it was refused). */
async function answerOf(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const text = response.ok ? record.message : record.error;
  return typeof text === "string" ? text : null;
}

/**
 * «Añadir contenido › Archivos» ([CON-04]): PDF, DOCX, XLSX, CSV, TXT or MD up to 25 MB, several at once, chosen or
 * dropped. Each one goes to the upload route in turn; the server checks the real type, the size and duplicates
 * ([CON-14]) and each file shows its own result.
 */
export function FileUploadForm({ kbId }: { kbId: string }) {
  const router = useRouter();
  const inputId = useId();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pending = uploads.filter((upload) => upload.state === "ready");

  function choose(files: FileList | File[] | null) {
    if (!files || files.length === 0 || busy) return;
    // Files already sent stay listed with their result; new ones are added below.
    setUploads((current) => [...current.filter((upload) => upload.state === "done" || upload.state === "error"), ...toUploads(files)]);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    choose(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files);
  }

  function update(key: string, patch: Partial<Upload>) {
    setUploads((current) => current.map((upload) => (upload.key === key ? { ...upload, ...patch } : upload)));
  }

  async function send(upload: Upload): Promise<boolean> {
    update(upload.key, { state: "uploading", message: null });
    try {
      const response = await fetch(knowledgeUploadUrl(kbId), {
        method: "POST",
        body: upload.file,
        credentials: "same-origin",
        headers: { [FILE_NAME_HEADER]: encodeURIComponent(upload.file.name), "content-type": "application/octet-stream" },
      });
      const message = await answerOf(response);
      update(upload.key, { state: response.ok ? "done" : "error", message: message ?? (response.ok ? null : GENERIC_ERROR) });
      return response.ok;
    } catch {
      update(upload.key, { state: "error", message: NETWORK_ERROR });
      return false;
    }
  }

  async function uploadAll() {
    if (busy || pending.length === 0) return;
    setBusy(true);
    let added = 0;
    for (const upload of pending) if (await send(upload)) added += 1;
    setBusy(false);
    if (added > 0) {
      toast.success(`${countLabel(added, "archivo añadido", "archivos añadidos")}. Se están procesando.`);
      router.refresh();
    }
  }

  return (
    <div className="grid gap-4">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors hover:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring",
          dragging && "border-primary bg-primary-soft",
        )}
      >
        <FileUp aria-hidden className="size-6 text-muted-foreground" />
        <span className="font-medium">Elige archivos o suéltalos aquí</span>
        <span id={`${inputId}-help`} className="text-muted-foreground">
          PDF, Word (DOCX), Excel (XLSX), CSV, TXT o Markdown, de hasta {MAX_KB_FILE_MB} MB cada uno.
        </span>
        <input
          id={inputId}
          type="file"
          multiple
          accept={KNOWLEDGE_FILE_ACCEPT}
          onChange={onChange}
          disabled={busy}
          aria-describedby={`${inputId}-help`}
          className="sr-only"
        />
      </label>

      {uploads.length > 0 ? (
        <ul aria-live="polite" className="grid gap-2 text-sm">
          {uploads.map((upload) => (
            <li key={upload.key} className="flex items-start gap-2 rounded-lg border px-3 py-2">
              <UploadIcon state={upload.state} />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium" title={upload.file.name}>
                    {upload.file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatFileSize(upload.file.size)}</span>
                </p>
                {upload.state === "uploading" ? <p className="text-xs text-muted-foreground">Subiendo…</p> : null}
                {upload.message ? (
                  <p className={cn("text-xs", upload.state === "done" ? "text-success" : upload.state === "ready" ? "text-muted-foreground" : "text-destructive-text")}>
                    {upload.message}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" onClick={() => void uploadAll()} disabled={busy || pending.length === 0}>
          {busy ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {busy ? "Subiendo…" : pending.length > 1 ? `Subir ${pending.length} archivos` : "Subir archivo"}
        </Button>
      </div>
    </div>
  );
}

function UploadIcon({ state }: { state: Upload["state"] }) {
  if (state === "uploading") return <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-info motion-reduce:animate-none" />;
  if (state === "done") return <CircleCheck aria-label="Subido" className="mt-0.5 size-4 shrink-0 text-success" />;
  if (state === "invalid" || state === "error") return <CircleX aria-label="No se ha subido" className="mt-0.5 size-4 shrink-0 text-destructive-text" />;
  return <FileUp aria-label="Pendiente de subir" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}
