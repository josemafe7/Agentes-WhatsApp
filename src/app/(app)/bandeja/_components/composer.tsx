"use client";

import { Eye, FileText, ImageIcon, LoaderCircle, MessageSquareText, Paperclip, SendHorizontal, StickyNote, X } from "lucide-react";
import { useId, useRef, useState, useTransition, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { requestRealtimePoll } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import { addNoteAction, sendAttachmentAction, sendMessageAction } from "../actions";
import { aiStateOf, formatFileSize, formatUntil } from "../_lib/presentation";
import { ACTION_FAILED } from "./use-inbox-action";
import { useNow } from "./use-now";

const HOUR_MS = 3_600_000;
/** Same limits as the server (src/data/messages.ts, src/data/notes.ts). */
const MAX_REPLY = 4_096;
const MAX_NOTE = 4_000;
/** Same limits as src/data/messages.ts (MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_CAPTION). */
const MAX_ATTACHMENT_BYTES = 3.5 * 1024 * 1024;
const MAX_CAPTION = 1_024;
const IMAGE_TYPES = "image/png,image/jpeg,image/webp";
const PDF_TYPE = "application/pdf";

type Mode = "reply" | "note";

type ComposerProps = {
  conversationId: string;
  channelDisabled: boolean;
  /** WhatsApp 24 h window ([BAN-08]); null when the channel has none. Closed = no free text, only templates. */
  window: { open: boolean; closesAt: Date | null } | null;
  /** WhatsApp: the window notice and, when closed, «Elegir plantilla» (from ../[id]/_whatsapp, [WA-43]). */
  whatsapp?: ReactNode;
  ai: { aiMode: "ai" | "human"; aiPausedUntil: Date | null };
  aiPauseHours: number;
  timezone: string;
  initialNow: Date;
  canReply: boolean;
  canNote: boolean;
  /** What the channel takes from a person ([BAN-14], [CAN-14]); neither = no «Adjuntar». */
  attachments: { images: boolean; documents: boolean };
  /** Email: to whom the reply goes, its subject and the signature it carries (from ../[id]/_email, [BAN-09], [COR-21]). */
  email?: ReactNode;
  /** Email sends replies through its own actions (they add the business signature); the other channels, these. */
  replyAction?: typeof sendMessageAction;
  attachmentAction?: typeof sendAttachmentAction;
};

/**
 * Reply to the customer or write an internal note ([BAN-07], [BAN-11]). Replying pauses the AI in this conversation
 * (it says until when). Outside WhatsApp's 24 h window only an approved template can be sent; Solo lectura has no
 * composer ([PER-03]).
 */
export function Composer(props: ComposerProps) {
  const { conversationId, channelDisabled, window: serviceWindow, whatsapp, ai, aiPauseHours, timezone, initialNow, canReply, canNote, attachments } = props;
  const { email, replyAction = sendMessageAction, attachmentAction = sendAttachmentAction } = props;
  const id = useId();
  const now = useNow(initialNow);
  const windowClosed = serviceWindow !== null && !serviceWindow.open;
  const replyAvailable = canReply && !channelDisabled && !windowClosed;
  const [chosenMode, setMode] = useState<Mode>("reply");
  const mode: Mode = replyAvailable ? chosenMode : "note";
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const accept = [attachments.images ? IMAGE_TYPES : null, attachments.documents ? PDF_TYPE : null].filter(Boolean).join(",");

  if (!canReply && !canNote) {
    return (
      <p className="flex items-center gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
        <Eye aria-hidden className="size-4" />
        Solo lectura: puedes ver la conversación, pero no responder.
      </p>
    );
  }

  const attaching = mode === "reply" && file !== null;
  const max = mode === "reply" ? (attaching ? MAX_CAPTION : MAX_REPLY) : MAX_NOTE;
  const canSend = (text.trim().length > 0 || attaching) && !pending && (mode === "note" ? canNote : replyAvailable);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!chosen) return;
    if (chosen.size > MAX_ATTACHMENT_BYTES) {
      setError(`El archivo es demasiado grande (${formatFileSize(chosen.size)}). Como mucho, 3,5 MB.`);
      return;
    }
    setError(null);
    setFile(chosen);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const value = text;
    const attached = attaching ? file : null;
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof sendMessageAction>> | Awaited<ReturnType<typeof addNoteAction>> | null;
      try {
        if (attached) {
          const form = new FormData();
          form.set("conversationId", conversationId);
          form.set("text", value);
          form.set("file", attached);
          result = await attachmentAction(form);
        } else {
          result = mode === "reply" ? await replyAction({ conversationId, text: value }) : await addNoteAction({ conversationId, text: value });
        }
      } catch {
        result = null;
      }
      if (!result?.ok) {
        // What was written stays, with the reason (DESIGN.md: «nunca se borra lo escrito»).
        setError(result?.fieldErrors?.file?.[0] ?? result?.fieldErrors?.text?.[0] ?? result?.error ?? ACTION_FAILED);
        return;
      }
      setText("");
      setFile(null);
      setError(null);
      requestRealtimePoll();
      if (result.data && "status" in result.data && result.data.status === "failed") {
        toast.error("No se ha podido enviar el mensaje. Puedes reintentarlo desde el propio mensaje.", { duration: Infinity });
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter adds a line; on touch screens Enter always adds a line.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    submit();
  }

  const state = aiStateOf(ai, now);
  const pauseUntil = formatUntil(new Date(now.getTime() + aiPauseHours * HOUR_MS), timezone, now);
  const hint =
    mode === "note"
      ? "Solo la ve el equipo; nunca se envía al cliente."
      : state.kind === "human"
        ? "La IA no responde en esta conversación mientras la atienda una persona."
        : `Al enviar, la IA se pausa en esta conversación hasta ${pauseUntil}.`;

  return (
    <div className="flex flex-col gap-2 border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
      {whatsapp}
      {mode === "reply" ? email : null}
      {canReply && channelDisabled ? <p className="rounded-lg bg-muted px-3 py-2 text-sm">El canal está desactivado: no se pueden enviar mensajes.</p> : null}

      {replyAvailable || canNote ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          {replyAvailable && canNote ? (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={mode}
              onValueChange={(value) => {
                if (value === "reply" || value === "note") setMode(value);
              }}
              aria-label="Tipo de mensaje"
              className="w-fit"
            >
              <ToggleGroupItem value="reply" className="px-3 pointer-coarse:min-h-11">
                <MessageSquareText aria-hidden />
                Responder
              </ToggleGroupItem>
              <ToggleGroupItem value="note" className="px-3 pointer-coarse:min-h-11">
                <StickyNote aria-hidden />
                Nota interna
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          <Label htmlFor={`${id}-texto`} className="sr-only">
            {mode === "reply" ? "Respuesta al cliente" : "Nota interna"}
          </Label>
          {attaching && file ? (
            <p className="flex w-fit max-w-full items-center gap-2 rounded-lg border bg-muted px-2 py-1 text-sm">
              {file.type === PDF_TYPE ? <FileText aria-hidden className="size-4 shrink-0" /> : <ImageIcon aria-hidden className="size-4 shrink-0" />}
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Quitar el archivo" onClick={() => setFile(null)} disabled={pending}>
                <X aria-hidden />
              </Button>
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            {mode === "reply" && accept ? (
              <>
                <input ref={fileInput} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={chooseFile} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={attachments.documents ? "Adjuntar una imagen o un PDF" : "Adjuntar una imagen"}
                  className="shrink-0 pointer-coarse:size-11"
                  onClick={() => fileInput.current?.click()}
                  disabled={pending}
                >
                  <Paperclip aria-hidden />
                </Button>
              </>
            ) : null}
            <Textarea
              id={`${id}-texto`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              maxLength={max}
              rows={1}
              placeholder={mode === "reply" ? (attaching ? "Añade un texto al archivo (opcional)…" : "Escribe tu respuesta…") : "Escribe una nota para el equipo…"}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-ayuda${error ? ` ${id}-error` : ""}`}
              className={cn("max-h-48 min-h-11", mode === "note" && "border-dashed border-warning bg-warning-soft dark:bg-warning-soft")}
            />
            <Button type="submit" disabled={!canSend} aria-label={mode === "reply" ? "Enviar" : "Guardar nota"} className="shrink-0">
              {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : mode === "reply" ? <SendHorizontal aria-hidden /> : <StickyNote aria-hidden />}
              <span className="hidden sm:inline">{mode === "reply" ? "Enviar" : "Guardar nota"}</span>
            </Button>
          </div>
          {error ? (
            <p id={`${id}-error`} role="alert" className="text-xs text-destructive-text">
              {error}
            </p>
          ) : null}
          <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        </form>
      ) : null}
    </div>
  );
}
