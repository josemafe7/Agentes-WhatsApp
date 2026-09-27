"use client";

import { Check, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MessageItem } from "@/data/messages";
import { requestRealtimePoll } from "@/hooks/use-realtime";
import { discardEmailDraftAction } from "../[id]/_email/actions";
import { useEmailThread } from "../[id]/_email/thread-context";
import { approveDraftAction, discardDraftAction } from "../actions";
import { useInboxAction } from "./use-inbox-action";

/** Same limit as a person's reply (src/data/messages.ts MAX_HUMAN_TEXT). */
const MAX_TEXT = 4_096;

type DraftReviewProps = {
  message: MessageItem;
  /** The draft was discarded: the timeline stops showing it at once. */
  onDiscarded: (messageId: string) => void;
};

/**
 * «Borrador para revisar» ([CAN-07], [MOT-14]): the AI's reply waits here until a person approves it as it is,
 * edits it and sends it, or discards it (it never reaches the customer). Only for who may reply in the channel.
 */
export function DraftReview({ message, onDiscarded }: DraftReviewProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text ?? "");
  const action = useInboxAction();
  const emailThread = useEmailThread();
  const fieldId = useId();
  const trimmed = text.trim();

  function approve(edited?: string) {
    action.run(() => approveDraftAction({ messageId: message.id, ...(edited !== undefined ? { text: edited } : {}) }), {
      onSuccess: (data) => {
        setEditing(false);
        if (data?.status === "failed") toast.error("El borrador no se ha podido enviar. Mira el error y reinténtalo.", { duration: Infinity });
        else toast.success("Borrador enviado.");
      },
    });
  }

  async function discard() {
    // Email: the draft also leaves the mailbox's drafts at once ([COR-14]).
    const result = await (emailThread ? discardEmailDraftAction : discardDraftAction)({ messageId: message.id });
    if (!result.ok) throw new Error(result.error);
    onDiscarded(message.id);
    requestRealtimePoll();
    toast.success("Borrador descartado.");
  }

  if (editing) {
    return (
      <form
        className="flex w-full max-w-[85%] flex-col gap-2 md:max-w-[70%]"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) approve(trimmed);
        }}
      >
        <Label htmlFor={fieldId}>Editar el borrador</Label>
        <Textarea id={fieldId} value={text} onChange={(event) => setText(event.target.value)} maxLength={MAX_TEXT} rows={4} autoFocus />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={action.pending}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!trimmed || action.pending}>
            {action.pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Check aria-hidden />}
            Guardar y enviar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2" role="group" aria-label="Revisar el borrador de la IA">
      <Button type="button" size="xs" onClick={() => approve()} disabled={action.pending}>
        {action.pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Check aria-hidden />}
        Aprobar y enviar
      </Button>
      <Button type="button" variant="outline" size="xs" onClick={() => setEditing(true)} disabled={action.pending}>
        <Pencil aria-hidden />
        Editar
      </Button>
      <ConfirmDialog
        trigger={
          <Button type="button" variant="ghost" size="xs" disabled={action.pending}>
            <Trash2 aria-hidden />
            Descartar
          </Button>
        }
        title="¿Descartar el borrador?"
        description="La respuesta de la IA se borra y el cliente no la recibe. Puedes contestar tú desde el cuadro de abajo."
        confirmLabel="Descartar"
        destructive
        onConfirm={discard}
      />
    </div>
  );
}
