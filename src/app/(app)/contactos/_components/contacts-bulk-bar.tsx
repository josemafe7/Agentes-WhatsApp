"use client";

import { Download, GitMerge, LoaderCircle, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { eraseContactsAction, exportContactsCsvAction } from "../actions";
import { saveTextFile } from "../_lib/download";
import { mergePath } from "../_lib/search-params";

/** What the person may do with the selected contacts; the server checks it again. */
export type BulkActions = { merge: boolean; export: boolean; erase: boolean };

type ContactsBulkBarProps = {
  selected: { id: string; displayName: string }[];
  actions: BulkActions;
  onClear: () => void;
};

/**
 * The bar that appears on selecting contacts (DESIGN.md «Tablas y listas»): «Fusionar» two of them ([CTO-05]),
 * «Exportar» the selected ones as CSV ([CTO-06]) or «Borrar» them with all their data, typing how many ([CTO-07]).
 */
export function ContactsBulkBar({ selected, actions, onClear }: ContactsBulkBarProps) {
  const router = useRouter();
  const [exporting, startExport] = useTransition();
  const count = selected.length;

  function exportSelected() {
    startExport(async () => {
      const result = await exportContactsCsvAction({ ids: selected.map((contact) => contact.id) });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "No se ha podido exportar. Inténtalo de nuevo." : result.error);
        return;
      }
      saveTextFile(result.data);
      toast.success(result.message ?? "Contactos exportados.");
    });
  }

  async function eraseSelected() {
    const result = await eraseContactsAction({ ids: selected.map((contact) => contact.id), confirmCount: String(count) });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Contactos borrados.");
    onClear();
    router.refresh();
  }

  return (
    <div role="toolbar" aria-label="Acciones con los contactos seleccionados" className="flex flex-wrap items-center gap-2 rounded-xl border bg-primary-soft px-4 py-2 text-sm">
      <span className="mr-auto font-medium tabular-nums" aria-live="polite">
        {count === 1 ? "1 contacto seleccionado" : `${formatNumber(count)} contactos seleccionados`}
      </span>
      {actions.merge ? (
        <Button type="button" size="sm" disabled={count !== 2} title={count === 2 ? undefined : "Elige exactamente dos contactos para fusionarlos"} onClick={() => router.push(mergePath(selected[0].id, selected[1].id))}>
          <GitMerge aria-hidden />
          Fusionar
        </Button>
      ) : null}
      {actions.export ? (
        <Button type="button" size="sm" variant="outline" onClick={exportSelected} disabled={exporting} aria-busy={exporting}>
          {exporting ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Download aria-hidden />}
          {exporting ? "Exportando…" : "Exportar"}
        </Button>
      ) : null}
      {actions.erase ? (
        <ConfirmDialog
          trigger={
            <Button type="button" size="sm" variant="destructive">
              <Trash2 aria-hidden />
              Borrar
            </Button>
          }
          title={count === 1 ? "¿Borrar este contacto y todos sus datos?" : `¿Borrar estos ${formatNumber(count)} contactos y todos sus datos?`}
          description="Se borran sus datos, identidades, consentimientos, conversaciones, mensajes, notas y archivos, y no se puede deshacer. Sus citas se quedan sin nombre para que los informes cuadren. Si lo necesitas, exporta antes sus datos."
          confirmLabel={count === 1 ? "Borrar contacto" : "Borrar contactos"}
          destructive
          requireText={String(count)}
          onConfirm={eraseSelected}
        />
      ) : null}
      <Button type="button" size="sm" variant="ghost" onClick={onClear}>
        <X aria-hidden />
        Quitar selección
      </Button>
    </div>
  );
}
