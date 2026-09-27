"use client";

import { EllipsisVertical, FileSearch, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { KbDocumentStatus, KbSourceType } from "@/lib/enums";
import { deleteKnowledgeDocumentAction, reprocessKnowledgeDocumentAction } from "../[id]/actions";
import { deleteDocumentDescription, reprocessActionLabel } from "../_lib/labels";

type DocumentMenuProps = { documentId: string; title: string; href: string; sourceType: KbSourceType; status: KbDocumentStatus };

/** Row actions of a document (owner, admin and supervisor): see its fragments, retry/refresh/re-process, delete. */
export function DocumentMenu({ documentId, title, href, sourceType, status }: DocumentMenuProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reprocess = reprocessActionLabel(sourceType, status);

  async function runReprocess() {
    const result = await reprocessKnowledgeDocumentAction(documentId);
    if (result.ok) toast.success(result.message ?? "Se está procesando de nuevo.");
    else toast.error(result.error);
  }

  async function remove() {
    const result = await deleteKnowledgeDocumentAction(documentId);
    if (result.ok) toast.success(result.message ?? "Documento borrado.");
    else toast.error(result.error);
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={`Acciones de «${title}»`} className="relative z-10">
                <EllipsisVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Acciones</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={href}>
              <FileSearch aria-hidden />
              Ver fragmentos
            </Link>
          </DropdownMenuItem>
          {reprocess ? (
            <DropdownMenuItem onSelect={() => void runReprocess()}>
              {reprocess === "Refrescar" ? <RefreshCw aria-hidden /> : <RotateCcw aria-hidden />}
              {reprocess}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden />
            Borrar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Borrar «${title}»?`}
        description={deleteDocumentDescription(sourceType)}
        confirmLabel="Borrar"
        destructive
        onConfirm={remove}
      />
    </>
  );
}
