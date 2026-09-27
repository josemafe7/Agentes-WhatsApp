import { Signature, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { EmailThreadView } from "@/data/email-drafts";
import { formatAddresses } from "./presentation";

/**
 * Over the composer of an email conversation: to whom the reply goes and with which subject (the same thread,
 * [COR-06]), the business signature it carries ([COR-21]) and, when the mailbox lost its access, that nothing leaves
 * until it is reconnected ([COR-22]).
 */
export function EmailReplyInfo({ thread }: { thread: EmailThreadView }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {thread.reconnect ? (
        <p role="status" className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            El buzón requiere reconexión: hasta entonces, lo que envíes quedará sin enviar y podrás reintentarlo después. {thread.reconnect}{" "}
            {thread.channelHref ? (
              <Link href={thread.channelHref} className="font-medium underline underline-offset-2">
                Ir al canal
              </Link>
            ) : null}
          </span>
        </p>
      ) : null}
      <p className="break-words">
        {thread.reply.to.length > 0 ? (
          <>
            <span className="font-medium text-foreground">Para:</span> {formatAddresses(thread.reply.to)} ·{" "}
          </>
        ) : null}
        <span className="font-medium text-foreground">Asunto:</span> {thread.reply.subject}
      </p>
      {thread.replySignature ? (
        <p className="flex items-start gap-1.5" title={thread.replySignature}>
          <Signature aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 truncate">Tu respuesta lleva la firma del canal: {thread.replySignature.replace(/^-- \n/, "").replace(/\n+/g, " · ")}</span>
        </p>
      ) : null}
    </div>
  );
}
