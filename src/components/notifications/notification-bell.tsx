"use client";

import { Bell, Bot, Hand, Inbox, LoaderCircle, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NotificationItem } from "@/data/notifications";
import { useRealtime } from "@/hooks/use-realtime";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction, type NotificationsView } from "./actions";

const EVENT_ICONS: Record<string, LucideIcon> = {
  handoff: Hand,
  new_conversation: Inbox,
  conversation_assigned: UserCheck,
  channel_error: TriangleAlert,
  whatsapp_quality: TriangleAlert,
  model_deprecated: Bot,
};
/** More than this shows «99+». */
const MAX_BADGE = 99;

/** Only in-app paths are followed; anything else (never expected) is ignored. */
function safeLink(link: string | null): string | null {
  return link && link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\") ? link : null;
}

/**
 * Bell of the top bar ([PWA-06]): the person's notices (hand-offs, new or assigned conversations, channel problems)
 * with the unread count; each one opens its screen and is marked read, and «Marcar todo como leído». New ones arrive
 * through /api/realtime.
 */
export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<NotificationsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);

  const load = useCallback((): Promise<void> => {
    const id = ++request.current;
    const apply = (result: Awaited<ReturnType<typeof loadNotificationsAction>> | null) => {
      if (id !== request.current) return;
      if (result?.ok && result.data) {
        setView(result.data);
        setFailed(false);
      } else setFailed(true);
    };
    return loadNotificationsAction().then(apply, () => apply(null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((events) => {
    if (events.some((event) => event.type === "notification.created")) void load();
  });

  /** Opening a notice (its link navigates by itself) closes the bell and marks it read. */
  function openNotification(item: NotificationItem) {
    setOpen(false);
    startTransition(async () => {
      if (!item.readAt) {
        await markNotificationReadAction({ notificationId: item.id }).catch(() => null);
        await load();
      }
    });
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction().catch(() => null);
      await load();
    });
  }

  const unread = view?.unread ?? 0;
  const badge = unread > MAX_BADGE ? `${MAX_BADGE}+` : String(unread);
  const label = unread > 0 ? `Avisos: ${unread} sin leer` : "Avisos";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={label} className={cn("relative", className)}>
              <Bell aria-hidden className="size-5" />
              {unread > 0 ? (
                <span aria-hidden className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs leading-none font-medium text-primary-foreground tabular-nums">
                  {badge}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-base font-semibold">Avisos</h2>
          {unread > 0 ? (
            <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={markAll} disabled={pending}>
              Marcar todo como leído
            </Button>
          ) : null}
        </div>
        <div className="max-h-[min(28rem,70svh)] overflow-y-auto">
          {failed && !view ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No se han podido cargar los avisos. Vuelve a abrirlos en unos segundos.</p>
          ) : !view ? (
            <p role="status" className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              Cargando…
            </p>
          ) : view.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No tienes avisos.</p>
          ) : (
            <ul>
              {view.items.map((item) => {
                const Icon = EVENT_ICONS[item.event] ?? Bell;
                const link = safeLink(item.link);
                const itemClass = cn(
                  "flex w-full items-start gap-3 border-b px-4 py-3 text-left outline-none last:border-b-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  !item.readAt && "bg-primary-soft/60",
                );
                const content = (
                  <>
                    <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={cn("text-sm break-words", !item.readAt && "font-medium")}>{item.title}</span>
                      {item.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span> : null}
                      <span className="text-xs text-muted-foreground">{formatRelative(item.createdAt, view.timezone)}</span>
                    </span>
                    {!item.readAt ? (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">Sin leer</span>
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <li key={item.id}>
                    {/* A notice with a screen is a link (it can also open in a new tab); one without it only marks read. */}
                    {link ? (
                      <Link href={link} onClick={() => openNotification(item)} className={itemClass}>
                        {content}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => openNotification(item)} className={itemClass}>
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
