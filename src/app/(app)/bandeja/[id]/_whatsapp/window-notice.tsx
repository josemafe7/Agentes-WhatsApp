"use client";

import { Clock, TimerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { WhatsAppInboxState } from "@/data/whatsapp-send";
import { useNow } from "../../_components/use-now";
import { describeWindow, type WindowView } from "./presentation";
import { TemplateDialog } from "./template-dialog";

/** A moment after closing, so the server also sees it closed. */
const REFRESH_AFTER_CLOSE_MS = 1_000;

const CLOSED_DETAIL: Record<Extract<WindowView, { state: "closed" }>["reason"], (closedAt: string | null) => string> = {
  never: () => "El cliente todavía no ha escrito por WhatsApp.",
  expired: (closedAt) => `Se cerró el ${closedAt}, 24 h después del último mensaje del cliente.`,
  meta: () => "Meta la ha cerrado al rechazar un mensaje. Se abre de nuevo cuando el cliente escriba.",
};

type WindowNoticeProps = {
  conversationId: string;
  state: WhatsAppInboxState;
  canReply: boolean;
  channelDisabled: boolean;
  timezone: string;
  initialNow: Date;
};

/**
 * WhatsApp's 24 h window over the composer ([BAN-08], [WA-43]): «Ventana abierta hasta … · quedan …» or, closed, why
 * and «Elegir plantilla». When it closes with the conversation on screen, the page reloads and the free-text reply
 * gives way to templates.
 */
export function WindowNotice({ conversationId, state, canReply, channelDisabled, timezone, initialNow }: WindowNoticeProps) {
  const router = useRouter();
  const now = useNow(initialNow);
  const view = describeWindow(state.window, now, timezone);
  const closesAt = view.state === "open" ? view.closesAt.getTime() : null;

  useEffect(() => {
    if (closesAt === null) return;
    const timer = window.setTimeout(() => router.refresh(), Math.max(0, closesAt - Date.now()) + REFRESH_AFTER_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closesAt, router]);

  if (view.state === "open") {
    return (
      <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
        <Clock aria-hidden className="size-3.5" />
        Ventana abierta hasta {view.until} · quedan {view.remaining}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <TimerOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="flex flex-col gap-0.5">
          <span>La ventana de 24 h está cerrada: solo puedes enviar una plantilla aprobada.</span>
          <span className="text-xs text-muted-foreground">{CLOSED_DETAIL[view.reason](view.closedAt)}</span>
        </p>
      </div>
      {canReply && !channelDisabled ? <TemplateAction conversationId={conversationId} state={state} /> : null}
    </div>
  );
}

function TemplateAction({ conversationId, state }: { conversationId: string; state: WhatsAppInboxState }) {
  if (state.optedOut) {
    return <p className="text-xs text-muted-foreground sm:max-w-56">El cliente se ha dado de baja en este canal: no se le pueden enviar plantillas.</p>;
  }
  if (state.templates.length === 0) {
    return <p className="text-xs text-muted-foreground sm:max-w-56">Este número no tiene plantillas aprobadas. Se sincronizan desde su panel en Canales.</p>;
  }
  return <TemplateDialog conversationId={conversationId} templates={state.templates} />;
}
