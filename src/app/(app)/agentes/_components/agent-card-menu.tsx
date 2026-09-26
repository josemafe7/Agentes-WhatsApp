"use client";

import { Copy, EllipsisVertical, PencilLine, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteAgentAction, duplicateAgentAction } from "../actions";

type AgentCardMenuProps = { agentId: string; agentName: string; activeChannelNames: string[] };

/** Actions of an agent card (owner and admin): open, duplicate and delete with confirmation ([AGE-13]). */
export function AgentCardMenu({ agentId, agentName, activeChannelNames }: AgentCardMenuProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = activeChannelNames.length > 0;

  async function duplicate() {
    const result = await duplicateAgentAction({ agentId });
    if (result.ok) toast.success(result.message ?? "Agente duplicado.");
    else toast.error(result.error);
  }

  async function remove() {
    const result = await deleteAgentAction({ agentId, confirmActiveChannels: active });
    if (result.ok) toast.success(result.message ?? "Agente borrado.");
    else toast.error(result.error);
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={`Acciones de ${agentName}`} className="relative z-10">
                <EllipsisVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Acciones</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/agentes/${agentId}`}>
              <PencilLine aria-hidden />
              Editar
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void duplicate()}>
            <Copy aria-hidden />
            Duplicar
          </DropdownMenuItem>
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
        title={`¿Borrar el agente «${agentName}»?`}
        description={
          active
            ? `Está activo en ${activeChannelNames.join(", ")}. Si lo borras, esos canales se quedarán sin agente y la IA no responderá ahí. Se borran también sus versiones; los mensajes antiguos conservan su nombre.`
            : "Se borran su configuración y sus versiones, y no se puede deshacer. Los mensajes antiguos conservan su nombre."
        }
        confirmLabel="Borrar agente"
        destructive
        requireText={agentName}
        onConfirm={remove}
      />
    </>
  );
}
