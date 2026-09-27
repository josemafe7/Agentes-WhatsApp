"use client";

import { Ellipsis, LoaderCircle, Mail, Paperclip, UserCheck } from "lucide-react";
import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { EmailMessageView, EmailThreadView } from "@/data/email-drafts";
import type { MessageItem } from "@/data/messages";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACTION_FAILED } from "../../_components/use-inbox-action";
import { loadQuotedTextAction } from "./actions";
import { approvalLabel, emailBody, formatAddress, formatAddresses, originalTextLabels, splitSignature } from "./presentation";
import { useEmailThread } from "./thread-context";

type EmailMessageContentProps = {
  message: MessageItem;
  /** On the business colour (a person's reply): secondary text keeps its contrast. */
  onPrimary: boolean;
  timezone: string;
  /** What any other channel shows: files, audio, and the plain text until the email's details arrive. */
  fallback: ReactNode;
};

/**
 * Inside the bubble of an email conversation, each email is a card (DESIGN.md «Correo», [BAN-09]): from, to, CC, its
 * subject when it is not the thread's, date, the body as text and the quoted text folded ([COR-19]). Attachments keep
 * their own bubble below the email. Outside an email thread it renders `fallback`.
 */
export function EmailMessageContent({ message, onPrimary, timezone, fallback }: EmailMessageContentProps) {
  const email = useEmailThread();
  const view = email?.details[message.id];
  const describable = message.contentType === "text" && message.senderType !== "system";
  const request = email?.request;

  useEffect(() => {
    if (request && describable && !view) request(message.id);
  }, [request, describable, view, message.id]);

  if (!email || !describable || !view) return fallback;
  return <EmailCard message={message} view={view} thread={email.thread} onPrimary={onPrimary} timezone={timezone} />;
}

type EmailCardProps = { message: MessageItem; view: EmailMessageView; thread: EmailThreadView; onPrimary: boolean; timezone: string };

function EmailCard({ message, view, thread, onPrimary, timezone }: EmailCardProps) {
  const muted = onPrimary ? "text-primary-foreground/80" : "text-muted-foreground";
  const text = emailBody(message.text, view.subjectLine);
  // A person's reply carries the business signature in its text: shown apart and quieter, as an email program does.
  const { body, signature } = message.direction === "outbound" ? splitSignature(text) : { body: text, signature: null };
  // The AI's draft gets its signature and AI notice when it leaves ([COR-21]): the person sees them before approving.
  const pendingSignature = message.status === "draft" && message.senderType === "ai" && !signature ? thread.draftSignature : null;
  const approval = approvalLabel(view);
  const labels = originalTextLabels(view);

  return (
    <div className="flex flex-col gap-2">
      <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs", muted)}>
        {view.from ? <HeaderField label="De">{formatAddress(view.from)}</HeaderField> : null}
        {view.to.length > 0 ? <HeaderField label="Para">{formatAddresses(view.to)}</HeaderField> : null}
        {view.cc.length > 0 ? <HeaderField label="CC">{formatAddresses(view.cc)}</HeaderField> : null}
        {view.subject ? <HeaderField label="Asunto">{view.subject}</HeaderField> : null}
        {view.date ? (
          <HeaderField label="Fecha">
            <time dateTime={view.date.toISOString()}>{formatDateTime(view.date, timezone)}</time>
          </HeaderField>
        ) : null}
      </dl>
      {body ? <p className="whitespace-pre-wrap">{body}</p> : null}
      {signature ? <p className={cn("text-xs whitespace-pre-wrap", muted)}>{`-- \n${signature}`}</p> : null}
      {pendingSignature ? (
        <div className={cn("flex flex-col gap-0.5 border-t border-dashed pt-2 text-xs", muted)}>
          <p className="font-medium">Firma que se añadirá al enviarlo</p>
          <p className="whitespace-pre-wrap">{pendingSignature}</p>
        </div>
      ) : null}
      {labels ? <OriginalText messageId={message.id} labels={labels} onPrimary={onPrimary} muted={muted} /> : null}
      {view.attachments.length > 0 ? (
        <p className={cn("flex items-start gap-1.5 text-xs", muted)}>
          <Paperclip aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            {view.attachments.length === 1 ? "1 adjunto" : `${view.attachments.length} adjuntos`}: {view.attachments.join(", ")}
          </span>
        </p>
      ) : null}
      {view.fromMailbox ? (
        <p className={cn("flex items-center gap-1.5 text-xs", muted)}>
          <Mail aria-hidden className="size-3.5 shrink-0" />
          Escrito desde el buzón de correo
        </p>
      ) : null}
      {approval ? (
        <p className={cn("flex items-center gap-1.5 text-xs", muted)}>
          <UserCheck aria-hidden className="size-3.5 shrink-0" />
          {approval}
        </p>
      ) : null}
    </div>
  );
}

function HeaderField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-medium">{label}</dt>
      <dd className="break-words">{children}</dd>
    </>
  );
}

type OriginalTextProps = { messageId: string; labels: { show: string; hide: string }; onPrimary: boolean; muted: string };

/** The quoted history (or the whole email when it was cut), read only when the person unfolds it ([COR-19]). */
function OriginalText({ messageId, labels, onPrimary, muted }: OriginalTextProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const regionId = useId();

  function toggle() {
    if (open || text !== null) {
      setOpen(!open);
      return;
    }
    startLoading(async () => {
      let result: Awaited<ReturnType<typeof loadQuotedTextAction>> | null;
      try {
        result = await loadQuotedTextAction({ messageId });
      } catch {
        result = null;
      }
      if (!result?.ok || !result.data) {
        toast.error(result && !result.ok ? result.error : ACTION_FAILED);
        return;
      }
      setText(result.data.text);
      setOpen(true);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn("h-auto w-fit px-1 py-0.5 pointer-coarse:min-h-11", muted, onPrimary && "hover:bg-primary-foreground/10 hover:text-primary-foreground")}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={toggle}
        disabled={loading}
      >
        {loading ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Ellipsis aria-hidden />}
        {open ? labels.hide : labels.show}
      </Button>
      <div
        id={regionId}
        hidden={!open}
        role="region"
        aria-label={labels.show}
        // Scrollable, so it must be reachable with the keyboard.
        tabIndex={open ? 0 : -1}
        className={cn("max-h-80 overflow-y-auto border-l-2 pl-3 text-xs whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring", onPrimary ? "border-primary-foreground/40" : "border-border", muted)}
      >
        {text}
      </div>
    </div>
  );
}
