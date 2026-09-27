import { Mail } from "lucide-react";
import type { EmailThreadView } from "@/data/email-drafts";

/** The subject of the email thread over its messages, and the mailbox it lives in ([BAN-09], [CAN-12]). */
export function EmailThreadHeader({ thread }: { thread: EmailThreadView }) {
  return (
    <div className="flex items-start gap-2 border-b px-4 py-2">
      <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-channel-email" />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold break-words">{thread.subject ?? "(sin asunto)"}</h2>
        <p className="text-xs text-muted-foreground">{thread.mailbox ? `Hilo de correo · buzón ${thread.mailbox}` : "Hilo de correo"}</p>
      </div>
    </div>
  );
}
