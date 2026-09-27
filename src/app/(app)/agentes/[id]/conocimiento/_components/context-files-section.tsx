"use client";

import { CircleAlert, ClipboardPaste, EllipsisVertical, Eye, FileText, FileUp, FolderInput, LoaderCircle, PencilLine, Trash2 } from "lucide-react";
import { useId, useRef, useState, useTransition, type ChangeEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ContextFileItem, ContextFilesBudget } from "@/data/knowledge-context-files";
import { formatNumber } from "@/lib/format";
import { deleteContextFileAction, getContextFileAction, uploadContextFileAction } from "../actions";
import { CONTEXT_UPLOAD_ACCEPT, CONTEXT_UPLOAD_MAX_LABEL, uploadProblem } from "../_lib/view";
import { BudgetMeter } from "./budget-meter";
import { ContextFileDialog, type ContextFileEditor } from "./context-file-dialog";
import { MoveToBaseDialog } from "./move-to-base-dialog";

type ContextFilesSectionProps = {
  agentId: string;
  files: ContextFileItem[];
  budget: ContextFilesBudget;
  cost: { modelId: string; perMessage: number | null };
  /** Owner and admin: add, edit and delete ([PER-01] «archivos de contexto»). The rest only read. */
  canManage: boolean;
  /** Also edits knowledge: «Pasar a una base de conocimiento». */
  canMove: boolean;
  /** Bases a file can be moved to. */
  bases: { id: string; name: string }[];
};

/** Level 1 of the agent's knowledge ([CON-01], [CON-02]): the context files, their size against the cap and actions. */
export function ContextFilesSection({ agentId, files, budget, cost, canManage, canMove, bases }: ContextFilesSectionProps) {
  const [editor, setEditor] = useState<ContextFileEditor | null>(null);
  const [moving, setMoving] = useState<ContextFileItem | null>(null);
  const [deleting, setDeleting] = useState<ContextFileItem | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadHelpId = useId();
  const full = budget.level === "full";

  function open(file: ContextFileItem, mode: "edit" | "view") {
    setEditor({ mode, fileId: file.id, status: "loading" });
    // Only the answer for the file still open is shown (the person may have closed it or opened another one).
    const show = (next: ContextFileEditor) => setEditor((current) => (current && current.mode !== "create" && current.fileId === file.id ? next : current));
    const failed = (error: string) => show({ mode, fileId: file.id, status: "error", error });
    getContextFileAction({ agentId, fileId: file.id }).then(
      (result) => {
        if (!result.ok) failed(result.error);
        else if (result.data) show({ mode, fileId: file.id, status: "ready", file: result.data });
        else failed("No se ha podido abrir el archivo.");
      },
      () => failed("No se ha podido abrir el archivo. Inténtalo de nuevo."),
    );
  }

  async function remove(file: ContextFileItem) {
    const result = await deleteContextFileAction({ agentId, fileId: file.id });
    if (result.ok) toast.success(result.message ?? "Archivo de contexto borrado.");
    else toast.error(result.error);
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid max-w-prose gap-1">
          <h2 id="context-files-heading" className="text-base font-semibold">
            Archivos de contexto
          </h2>
          <p className="text-sm text-muted-foreground">
            Textos que el agente lee enteros antes de cada respuesta, como normas, tarifas o la carta de servicios. Úsalos para lo corto que
            siempre necesita; lo largo va mejor en una base de conocimiento.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <UploadButton agentId={agentId} disabled={full} onError={setUploadError} describedBy={uploadHelpId} />
            <Button type="button" variant="outline" disabled={full} onClick={() => setEditor({ mode: "create" })}>
              <ClipboardPaste aria-hidden />
              Pegar texto
            </Button>
          </div>
        ) : null}
      </div>
      {canManage ? (
        <div id={uploadHelpId} className="-mt-2 grid gap-1">
          <p className="text-xs text-muted-foreground">
            Archivos PDF, DOCX, TXT o MD de hasta {CONTEXT_UPLOAD_MAX_LABEL}. Se convierten en texto que puedes revisar y editar.
          </p>
          {uploadError ? (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive-text">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {uploadError}
            </p>
          ) : null}
        </div>
      ) : null}

      <BudgetMeter totalTokens={budget.totalTokens} maxTokens={budget.maxTokens} level={budget.level} cost={cost} canMove={canMove} />

      {files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Sin archivos de contexto"
          description={
            canManage
              ? "Sube un PDF, DOCX, TXT o MD, o pega texto: se convierte en texto que puedes editar y el agente lo lee antes de cada respuesta."
              : "Este agente no tiene archivos de contexto."
          }
        />
      ) : (
        <ul className="grid divide-y rounded-xl border" aria-labelledby="context-files-heading">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <FileText aria-hidden className="size-5" />
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <button
                  type="button"
                  onClick={() => open(file, canManage ? "edit" : "view")}
                  className="w-fit max-w-full truncate rounded-sm text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {file.title}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatNumber(file.tokenCount)} tokens</span>
                  {" · "}
                  {file.sourceFileName ? `Desde ${file.sourceFileName}` : "Texto pegado"}
                </p>
              </div>
              {canManage ? (
                <FileMenu
                  title={file.title}
                  canMove={canMove}
                  onEdit={() => open(file, "edit")}
                  onMove={() => setMoving(file)}
                  onDelete={() => setDeleting(file)}
                />
              ) : (
                <Button type="button" variant="ghost" onClick={() => open(file, "view")}>
                  <Eye aria-hidden />
                  Ver
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ContextFileDialog
        agentId={agentId}
        editor={editor}
        onClose={() => setEditor(null)}
        totalTokens={budget.totalTokens}
        limits={{ maxTokens: budget.maxTokens, warnTokens: budget.warnTokens }}
      />
      {canMove ? <MoveToBaseDialog agentId={agentId} file={moving} bases={bases} onClose={() => setMoving(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={`¿Borrar «${deleting?.title ?? ""}»?`}
        description="El agente dejará de tenerlo en cuenta en sus respuestas. No se puede deshacer."
        confirmLabel="Borrar archivo"
        destructive
        onConfirm={async () => {
          if (deleting) await remove(deleting);
        }}
      />
    </>
  );
}

type FileMenuProps = { title: string; canMove: boolean; onEdit: () => void; onMove: () => void; onDelete: () => void };

function FileMenu({ title, canMove, onEdit, onMove, onDelete }: FileMenuProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={`Acciones de ${title}`}>
              <EllipsisVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Acciones</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <PencilLine aria-hidden />
          Editar
        </DropdownMenuItem>
        {canMove ? (
          <DropdownMenuItem onSelect={onMove}>
            <FolderInput aria-hidden />
            Pasar a una base de conocimiento
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 aria-hidden />
          Borrar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type UploadButtonProps = {
  agentId: string;
  disabled: boolean;
  /** The reason of a refused file, or null when a new try starts. */
  onError: (error: string | null) => void;
  describedBy?: string;
};

/**
 * «Subir archivo»: PDF, DOCX, TXT or MD up to CONTEXT_UPLOAD_MAX_BYTES, checked here before sending and again (type
 * by content, size, cap) on the server.
 */
function UploadButton({ agentId, disabled, onError, describedBy }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // The same file can be chosen again after fixing it.
    event.target.value = "";
    if (!file) return;
    const problem = uploadProblem(file);
    onError(problem);
    if (problem) return;
    startTransition(async () => {
      const data = new FormData();
      data.append("file", file);
      const result = await uploadContextFileAction(agentId, data);
      if (result.ok) {
        toast.success(result.message ?? "Archivo añadido.");
        return;
      }
      onError(result.fieldErrors?.file?.[0] ?? result.fieldErrors?.contentMd?.[0] ?? result.error);
    });
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={CONTEXT_UPLOAD_ACCEPT} onChange={handleChange} className="sr-only" tabIndex={-1} aria-hidden />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || pending}
        aria-busy={pending}
        aria-describedby={describedBy}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <FileUp aria-hidden />}
        {pending ? "Convirtiendo…" : "Subir archivo"}
      </Button>
    </>
  );
}
