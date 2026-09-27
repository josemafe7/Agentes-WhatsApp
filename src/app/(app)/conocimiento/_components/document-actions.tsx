"use client";

import { LoaderCircle, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { KbDocumentStatus, KbSourceType } from "@/lib/enums";
import { deleteKnowledgeDocumentAction, reprocessKnowledgeDocumentAction, setKnowledgeDocumentRefreshAction } from "../[id]/actions";
import { deleteDocumentDescription, REFRESH_INTERVAL_OPTIONS, refreshIntervalLabel, reprocessActionLabel } from "../_lib/labels";

type DocumentActionsProps = { documentId: string; title: string; sourceType: KbSourceType; status: KbDocumentStatus; listHref: string };

/** «Reintentar», «Refrescar» or «Reprocesar», and «Borrar» (fragments and file) of one document ([CON-05], [CON-15]). */
export function DocumentActions({ documentId, title, sourceType, status, listHref }: DocumentActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const reprocess = reprocessActionLabel(sourceType, status);

  function runReprocess() {
    startTransition(async () => {
      const result = await reprocessKnowledgeDocumentAction(documentId);
      if (result.ok) toast.success(result.message ?? "Se está procesando de nuevo.");
      else toast.error(result.error);
    });
  }

  async function remove() {
    const result = await deleteKnowledgeDocumentAction(documentId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Documento borrado.");
    router.push(listHref);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {reprocess ? (
        <Button type="button" variant="outline" onClick={runReprocess} disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : reprocess === "Refrescar" ? (
            <RefreshCw aria-hidden />
          ) : (
            <RotateCcw aria-hidden />
          )}
          {reprocess}
        </Button>
      ) : null}
      <ConfirmDialog
        trigger={
          <Button type="button" variant="ghost">
            <Trash2 aria-hidden />
            Borrar
          </Button>
        }
        title={`¿Borrar «${title}»?`}
        description={deleteDocumentDescription(sourceType)}
        confirmLabel="Borrar"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}

/** «Reintentar» right next to the reason of an error in the documents list ([CON-05]). */
export function RetryButton({ documentId, title }: { documentId: string; title: string }) {
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const result = await reprocessKnowledgeDocumentAction(documentId);
      if (result.ok) toast.success(result.message ?? "Se está procesando de nuevo.");
      else toast.error(result.error);
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={retry} disabled={pending} aria-label={`Reintentar «${title}»`} className="relative z-10">
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden />}
      Reintentar
    </Button>
  );
}

type RefreshSettingsProps = { documentId: string; enabled: boolean; intervalHours: number | null };

/** Periodic refresh of a web page: on or off and how often; only changed pages are processed again ([CON-09]). */
export function RefreshSettings({ documentId, enabled, intervalHours }: RefreshSettingsProps) {
  const [pending, startTransition] = useTransition();
  const current = String(intervalHours ?? REFRESH_INTERVAL_OPTIONS[1].hours);
  const known = REFRESH_INTERVAL_OPTIONS.some((option) => String(option.hours) === current);

  function save(next: { enabled: boolean; intervalHours?: number }) {
    startTransition(async () => {
      const result = await setKnowledgeDocumentRefreshAction(documentId, next);
      if (result.ok) toast.success(result.message ?? "Cambios guardados.");
      else toast.error(result.error);
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <label htmlFor="doc-refresh" className="text-sm font-medium">
            Volver a leerla de vez en cuando
          </label>
          <p id="doc-refresh-help" className="text-sm text-muted-foreground">
            Si ha cambiado, se procesa de nuevo; si no, se deja como está.
          </p>
        </div>
        <Switch
          id="doc-refresh"
          checked={enabled}
          disabled={pending}
          onCheckedChange={(checked) => save({ enabled: checked, intervalHours: Number(current) })}
          aria-describedby="doc-refresh-help"
          className="mt-0.5"
        />
      </div>
      {enabled ? (
        <Select value={current} onValueChange={(value) => save({ enabled: true, intervalHours: Number(value) })} disabled={pending}>
          <SelectTrigger aria-label="Cada cuánto se vuelve a leer" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {known ? null : <SelectItem value={current}>{refreshIntervalLabel(Number(current))}</SelectItem>}
            {REFRESH_INTERVAL_OPTIONS.map((option) => (
              <SelectItem key={option.hours} value={String(option.hours)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
