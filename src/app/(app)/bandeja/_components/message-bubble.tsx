"use client";

import { BookOpen, Bot, Download, FileText, FlaskConical, Headset, Info, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { MessageItem } from "@/data/messages";
import type { ChannelType } from "@/lib/enums";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmailMessageContent } from "../[id]/_email/email-message-content";
import { MessageCost } from "../[id]/_whatsapp/message-cost";
import { CONTENT_TYPE_LABELS, contactDisplayName, DELIVERY_META, formatFileSize, mediaNotStoredText } from "../_lib/presentation";

/** What stays of a file the daily clean-up removed ([CUM-05]). */
const AUDIO_REMOVED_TEXT = "El audio se borró por la política de conservación";
const MEDIA_REMOVED_TEXT = "El archivo se borró por la política de conservación";
/** Longer transcripts start folded. */
const LONG_TRANSCRIPT = 280;

type MessageBubbleProps = {
  message: MessageItem;
  /** First and last of a run of the same author (DESIGN.md «Burbujas»). */
  first: boolean;
  last: boolean;
  channel: { type: ChannelType; name: string };
  contactName: string | null;
  timezone: string;
  hasSources: boolean;
  onShowSources: () => void;
  /** «Reintentar» on a failed send, for whoever may reply ([BAN-13]). */
  onRetry: (() => void) | null;
  retrying: boolean;
  /** Under a draft of the AI: «Aprobar y enviar», «Editar» and «Descartar», for whoever may review it ([CAN-07]). */
  draftReview?: ReactNode;
  /** More actions in the line under the message, such as «Convertir en FAQ» on a person's reply ([CON-22]). */
  actions?: ReactNode;
};

/**
 * One message with its author (customer, AI with the agent's name, person, system), channel, time and delivery state
 * ([BAN-05]); audio with its transcript, images, videos and documents served by the authenticated file route
 * ([BAN-06], [MED-08]).
 */
export function MessageBubble({ message, first, last, channel, contactName, timezone, hasSources, onShowSources, onRetry, retrying, draftReview, actions }: MessageBubbleProps) {
  const time = formatDateTime(message.createdAt, timezone, { preset: "time" });
  if (message.senderType === "system") {
    return (
      <div className="flex items-start justify-center gap-1.5 px-6 text-center text-xs text-muted-foreground">
        <Info aria-hidden className="mt-px size-3.5 shrink-0" />
        <p>
          <span className="sr-only">Sistema: </span>
          {message.text ?? CONTENT_TYPE_LABELS.system} · <time dateTime={message.createdAt.toISOString()}>{time}</time>
        </p>
      </div>
    );
  }

  const outbound = message.direction === "outbound";
  const draft = message.status === "draft";
  const human = message.senderType === "human" && !draft;
  const bubble = cn(
    "max-w-[85%] rounded-2xl px-3 py-2 text-base break-words md:max-w-[70%] md:text-sm",
    draft
      ? "border border-dashed border-warning bg-card"
      : message.senderType === "ai"
        ? "border border-ai/25 bg-ai-soft text-foreground"
        : human
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground",
    last && (outbound ? "rounded-br-sm" : "rounded-bl-sm"),
  );
  const delivery = outbound && message.status !== "received" ? DELIVERY_META[message.status] : null;
  const DeliveryIcon = delivery?.icon;

  return (
    <div className={cn("flex flex-col gap-1", outbound ? "items-end" : "items-start")}>
      {first ? <AuthorLine message={message} channel={channel} contactName={contactName} /> : null}
      <div className={bubble}>
        {/* In an email thread each email is a card with its headers ([BAN-09]); any other message, as it is. */}
        <EmailMessageContent message={message} onPrimary={human} timezone={timezone} fallback={<MessageContent message={message} onPrimary={human} />} />
      </div>
      {message.reactions.length > 0 ? (
        <p className="text-sm" aria-label={`Reacciones: ${message.reactions.map((reaction) => reaction.emoji).join(" ")}`}>
          {message.reactions.map((reaction) => reaction.emoji).join(" ")}
        </p>
      ) : null}
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", outbound && "justify-end")}>
        <time dateTime={message.createdAt.toISOString()} className="tabular-nums">
          {time}
        </time>
        {delivery && DeliveryIcon ? (
          <span className={cn("inline-flex items-center gap-1", delivery.className)}>
            <DeliveryIcon aria-hidden className="size-3.5" />
            {draft ? "Borrador de la IA · pendiente de revisar" : delivery.label}
          </span>
        ) : null}
        {message.simulated ? (
          <span className="inline-flex items-center gap-1">
            <FlaskConical aria-hidden className="size-3.5" />
            Simulado
          </span>
        ) : null}
        {outbound ? <MessageCost pricing={message.pricing} /> : null}
        {hasSources ? (
          <Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs text-primary-text" onClick={onShowSources}>
            <BookOpen aria-hidden />
            Ver fuentes
          </Button>
        ) : null}
        {actions}
      </div>
      {draft && draftReview ? draftReview : null}
      {message.status === "failed" ? (
        <div role="alert" className="flex max-w-[85%] flex-wrap items-center justify-end gap-2 text-xs text-destructive-text md:max-w-[70%]">
          <span>{message.error?.message ?? "No se ha podido enviar el mensaje."}</span>
          {onRetry ? (
            <Button type="button" variant="outline" size="xs" onClick={onRetry} disabled={retrying}>
              {retrying ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden />}
              Reintentar
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AuthorLine({ message, channel, contactName }: { message: MessageItem; channel: { type: ChannelType; name: string }; contactName: string | null }) {
  const { icon: ChannelIcon, iconClassName, label } = CHANNEL_IDENTITY[channel.type];
  const channelMark = (
    <span title={`${label} · ${channel.name}`} className="inline-flex">
      <ChannelIcon aria-hidden className={cn("size-3.5", iconClassName)} />
      <span className="sr-only">
        {" "}
        por {label} · {channel.name}
      </span>
    </span>
  );
  if (message.senderType === "ai") {
    return (
      <p className="flex items-center gap-1 text-xs font-medium text-ai">
        <Bot aria-hidden className="size-3.5" />
        IA · {message.authorName ?? "Agente"}
        {channelMark}
      </p>
    );
  }
  if (message.senderType === "human") {
    return (
      <p className="flex items-center gap-1 text-xs font-medium">
        <Headset aria-hidden className="size-3.5" />
        {message.authorName ?? "Persona del equipo"}
        {channelMark}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-xs font-medium">
      {contactDisplayName(contactName)}
      {channelMark}
    </p>
  );
}

function MessageContent({ message, onPrimary }: { message: MessageItem; onPrimary: boolean }) {
  // On the business colour the text keeps its full contrast; elsewhere secondary text is muted.
  const secondary = onPrimary ? "" : "text-muted-foreground";
  const text = message.text ? <p className="whitespace-pre-wrap">{message.text}</p> : null;
  const media = message.media;

  const withFile = ["image", "sticker", "audio", "video", "document"].includes(message.contentType);
  // The daily clean-up removed the file ([CUM-05]): a voice note still shows what the customer said ([MED-04]).
  if (!media && withFile && message.mediaRemoved) {
    if (message.contentType === "audio") {
      return <AudioContent url={null} transcript={message.transcript} failed={message.transcriptionFailed} secondary={secondary} />;
    }
    return (
      <div className="flex flex-col gap-1">
        <p className={secondary}>{MEDIA_REMOVED_TEXT}</p>
        {text}
      </div>
    );
  }
  if (!media || !withFile) {
    return text ?? <p className={secondary}>{CONTENT_TYPE_LABELS[message.contentType]}</p>;
  }
  if (!media.url) {
    const pending = media.downloadStatus === "pending";
    return (
      <div className="flex flex-col gap-1">
        <p className={cn("inline-flex items-center gap-1.5", secondary)}>
          {pending ? <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
          {mediaNotStoredText(message.contentType, media.downloadStatus)}
        </p>
        {text}
      </div>
    );
  }
  if (message.contentType === "audio") {
    return <AudioContent url={media.url} transcript={message.transcript} failed={message.transcriptionFailed} secondary={secondary} />;
  }
  if (message.contentType === "image" || message.contentType === "sticker") {
    return (
      <div className="flex flex-col gap-2">
        <ImagePreview url={media.url} sticker={message.contentType === "sticker"} />
        {text}
      </div>
    );
  }
  if (message.contentType === "video") {
    return (
      <div className="flex flex-col gap-2">
        <video controls preload="metadata" src={media.url} className="max-h-60 max-w-60 rounded-lg bg-black" aria-label="Vídeo" />
        {text}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <a
        href={media.url}
        download={media.fileName ?? undefined}
        className={cn(
          "flex max-w-72 items-center gap-3 rounded-lg border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          onPrimary ? "border-primary-foreground/30" : "bg-background text-foreground",
        )}
      >
        <FileText aria-hidden className="size-5 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{media.fileName ?? "Documento"}</span>
          <span className={cn("text-xs", secondary)}>{media.size !== null ? formatFileSize(media.size) : (media.mimeType ?? "")}</span>
        </span>
        <Download aria-hidden className="size-4 shrink-0" />
        <span className="sr-only">Descargar</span>
      </a>
      {text}
    </div>
  );
}

/**
 * Player and, underneath, the transcript the agent received ([BAN-06], [MED-04]); folded when long. Without `url` the
 * clean-up removed the audio: the transcript stays.
 */
function AudioContent({ url, transcript, failed, secondary }: { url: string | null; transcript: string | null; failed: boolean; secondary: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = (transcript?.length ?? 0) > LONG_TRANSCRIPT;
  return (
    <div className="flex flex-col gap-2">
      {url ? (
        <audio controls preload="metadata" src={url} className="w-64 max-w-full" aria-label="Nota de voz" />
      ) : (
        <p className={cn("text-xs", secondary)}>{AUDIO_REMOVED_TEXT}</p>
      )}
      {transcript ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-medium">Transcripción</p>
          <p className="whitespace-pre-wrap">{long && !expanded ? `${transcript.slice(0, LONG_TRANSCRIPT)}…` : transcript}</p>
          {long ? (
            <Button type="button" variant="link" size="xs" className="h-auto w-fit p-0 text-inherit underline" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Ver menos" : "Ver toda la transcripción"}
            </Button>
          ) : null}
        </div>
      ) : (
        // [MED-03]: too big or rejected by every model; the AI asked the customer to write it.
        <p className={cn("text-xs", secondary)}>{failed ? "No se pudo transcribir" : "Sin transcripción"}</p>
      )}
    </div>
  );
}

/** Thumbnail up to 240 px that opens full size in a dialog. */
function ImagePreview({ url, sticker }: { url: string; sticker: boolean }) {
  const [open, setOpen] = useState(false);
  const alt = sticker ? "Sticker" : "Imagen";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="w-fit rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Ampliar ${alt.toLowerCase()}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private file behind the authenticated /api/files route: the image optimizer would fetch it without the session */}
        <img src={url} alt={alt} className="max-h-60 max-w-60 rounded-lg object-contain" loading="lazy" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-w-[calc(100%-2rem)] p-2 sm:max-w-3xl">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">{alt} a tamaño completo.</DialogDescription>
          {/* eslint-disable-next-line @next/next/no-img-element -- same private file as the thumbnail */}
          <img src={url} alt={alt} className="max-h-[80svh] w-full rounded-lg object-contain" />
          <DialogClose asChild>
            <Button variant="secondary" size="icon" className="absolute top-3 right-3" aria-label="Cerrar">
              <X aria-hidden />
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}
