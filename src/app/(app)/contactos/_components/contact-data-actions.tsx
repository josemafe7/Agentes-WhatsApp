"use client";

import { Download, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { eraseContactAction, exportContactDataAction } from "../actions";
import { saveTextFile } from "../_lib/download";
import { CONTACTS_PATH } from "../_lib/search-params";

type ContactDataActionsProps = {
  contactId: string;
  /** The name as the card shows it: what the person types to confirm the erasure. */
  displayName: string;
  canExport: boolean;
  canErase: boolean;
};

/**
 * «Exportar datos» and «Borrar contacto» of the card ([CTO-06], [CTO-07], [CUM-07]); only for whoever may do them
 * (the server checks it again). Erasing asks for the contact's name (DESIGN.md «Diálogos y confirmaciones»).
 */
export function ContactDataActions({ contactId, displayName, canExport, canErase }: ContactDataActionsProps) {
  const router = useRouter();
  const [exporting, startExport] = useTransition();

  function exportData() {
    startExport(async () => {
      const result = await exportContactDataAction(contactId);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "No se ha podido exportar. Inténtalo de nuevo." : result.error);
        return;
      }
      saveTextFile(result.data);
      toast.success(result.message ?? "Datos exportados.");
    });
  }

  async function erase() {
    const result = await eraseContactAction(contactId, { confirmName: displayName });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Contacto borrado.");
    router.push(CONTACTS_PATH);
  }

  return (
    <>
      {canExport ? (
        <Button type="button" variant="outline" onClick={exportData} disabled={exporting} aria-busy={exporting}>
          {exporting ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Download aria-hidden />}
          {exporting ? "Exportando…" : "Exportar datos"}
        </Button>
      ) : null}
      {canErase ? (
        <ConfirmDialog
          trigger={
            <Button type="button" variant="destructive">
              <Trash2 aria-hidden />
              Borrar contacto
            </Button>
          }
          title={`¿Borrar a «${displayName}» y todos sus datos?`}
          description="Se borran sus datos, identidades, consentimientos, conversaciones, mensajes, notas y archivos, y no se puede deshacer. Sus citas se quedan sin nombre para que los informes cuadren. Si lo necesitas, exporta antes sus datos."
          confirmLabel="Borrar contacto"
          destructive
          requireText={displayName}
          onConfirm={erase}
        />
      ) : null}
    </>
  );
}
