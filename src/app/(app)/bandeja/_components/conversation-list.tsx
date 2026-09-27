"use client";

import { FlaskConical, Inbox, LoaderCircle, RadioTower, Search, WifiOff } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConversationListItem, InboxCounts } from "@/data/conversations";
import { useRealtime, useRealtimeStatus, type RealtimeEvent } from "@/hooks/use-realtime";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadInboxAction } from "../actions";
import {
  activeFilterCount,
  clearFilters,
  inboxHref,
  inboxQueryString,
  parseInboxQuery,
  toConversationFilters,
  type InboxQuery,
  type InboxView,
} from "../_lib/filters";
import { ConversationRow } from "./conversation-row";
import { InboxFilters, type InboxChannel } from "./inbox-filters";
import { ListSkeleton } from "./list-skeleton";
import { useNow } from "./use-now";

const INBOX_PATH = "/bandeja";
const PAGE_SIZE = 30;
/** The server answers at most this many per page. */
const MAX_PAGE = 100;
const SEARCH_DELAY_MS = 300;
/** News often come in bursts (message + status + read): one reload for all of them. */
const RELOAD_DELAY_MS = 400;

const TABS: { view: InboxView; label: string; count?: keyof InboxCounts }[] = [
  { view: "all", label: "Todas" },
  { view: "pending", label: "Pendientes de humano", count: "pendingHuman" },
  { view: "mine", label: "Mías", count: "mine" },
];

type Loaded = { key: string; items: ConversationListItem[]; nextCursor: string | null; counts: InboxCounts };

type ConversationListProps = {
  channels: InboxChannel[];
  timezone: string;
  initialNow: Date;
  canConnectChannel: boolean;
  canUseSimulator: boolean;
};

/**
 * The inbox list ([BAN-01]–[BAN-03]): quick tabs, search and filters in the URL, unread counters, and what changes
 * appears on its own through /api/realtime without losing what is loaded. «Sin conexión. Reintentando…» keeps the list.
 */
export function ConversationList({ channels, timezone, initialNow, canConnectChannel, canUseSimulator }: ConversationListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = useParams<{ id?: string }>().id ?? null;
  const now = useNow(initialNow);
  const connection = useRealtimeStatus();

  const query = useMemo(() => parseInboxQuery(searchParams), [searchParams]);
  const key = inboxQueryString(query);
  // Keyed by the URL text: opening a conversation keeps the same filters and does not reload the list.
  const filters = useMemo(() => toConversationFilters(parseInboxQuery(new URLSearchParams(key))), [key]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const current = useRef<Loaded | null>(null);
  useEffect(() => {
    current.current = loaded;
  });

  // First page of each filter combination.
  useEffect(() => {
    const id = ++request.current;
    loadInboxAction({ ...filters, limit: PAGE_SIZE }).then(
      (result) => {
        if (id !== request.current) return;
        if (result.ok && result.data) {
          setLoaded({ key, items: result.data.page.items, nextCursor: result.data.page.nextCursor, counts: result.data.counts });
          setFailedKey(null);
        } else setFailedKey(key);
      },
      () => {
        if (id === request.current) setFailedKey(key);
      },
    );
  }, [key, filters, retries]);

  // News: reload what is already shown (same filters, as many rows as loaded), without a skeleton.
  const reloadTimer = useRef<number | null>(null);
  const reload = useCallback(() => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      const shown = current.current;
      if (!shown || shown.key !== key) return;
      const id = ++request.current;
      const limit = Math.min(MAX_PAGE, Math.max(PAGE_SIZE, shown.items.length));
      loadInboxAction({ ...filters, limit }).then(
        (result) => {
          if (id !== request.current || !result.ok || !result.data) return;
          setLoaded({ key, items: result.data.page.items, nextCursor: result.data.page.nextCursor, counts: result.data.counts });
        },
        // A failed reload keeps the list; the connection notice already says it is retrying.
        () => undefined,
      );
    }, RELOAD_DELAY_MS);
  }, [key, filters]);
  useEffect(
    () => () => {
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    },
    [],
  );
  useRealtime((events: RealtimeEvent[]) => {
    if (events.some((event) => event.type !== "notification.created")) reload();
  });

  async function loadMore() {
    const shown = current.current;
    if (!shown?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await loadInboxAction({ ...filters, cursor: shown.nextCursor, limit: PAGE_SIZE });
      if (result.ok && result.data && current.current?.key === shown.key) {
        const page = result.data.page;
        setLoaded((previous) => {
          if (!previous || previous.key !== shown.key) return previous;
          const ids = new Set(previous.items.map((item) => item.id));
          return { ...previous, items: [...previous.items, ...page.items.filter((item) => !ids.has(item.id))], nextCursor: page.nextCursor, counts: result.data?.counts ?? previous.counts };
        });
      } else if (!result.ok) toast.error(result.error);
    } catch {
      toast.error("No se han podido cargar más conversaciones. Inténtalo de nuevo.");
    } finally {
      setLoadingMore(false);
    }
  }

  const navigate = useCallback((next: InboxQuery) => router.replace(inboxHref(pathname, next), { scroll: false }), [router, pathname]);

  const view = loaded?.key === key ? loaded : null;
  const failed = failedKey === key && !view;
  const filtered = activeFilterCount(query) > 0 || query.search !== "";
  // One H1 per page: the conversation has its own when one is open.
  const Heading = selectedId ? "h2" : "h1";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <Heading className="text-lg font-semibold tracking-tight">Bandeja</Heading>
          {view && view.counts.unreadConversations > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(view.counts.unreadConversations)} sin leer</span>
          ) : null}
        </div>
        <SearchBox query={query} onSearch={(search) => navigate({ ...query, search })} />
        <nav aria-label="Vistas de la bandeja" className="-mb-3 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const active = query.view === tab.view;
            const count = tab.count && view ? view.counts[tab.count] : 0;
            return (
              <Link
                key={tab.view}
                href={inboxHref(pathname, { ...query, view: tab.view })}
                replace
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {count > 0 ? <span className="rounded-full bg-muted px-1.5 text-xs text-foreground tabular-nums">{formatNumber(count)}</span> : null}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="border-b px-4 py-2">
        <InboxFilters query={query} channels={channels} onChange={navigate} />
      </div>
      {connection === "offline" ? (
        <p role="status" className="flex items-center gap-2 border-b bg-warning-soft px-4 py-2 text-sm text-warning">
          <WifiOff aria-hidden className="size-4" />
          Sin conexión. Reintentando…
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <div className="p-4">
            <ErrorState
              title="No se ha podido cargar la bandeja"
              retry={
                <Button variant="outline" size="sm" onClick={() => setRetries((value) => value + 1)}>
                  Reintentar
                </Button>
              }
            />
          </div>
        ) : !view ? (
          <ListSkeleton />
        ) : view.items.length === 0 ? (
          <div className="p-4">
            <ListEmpty
              query={query}
              filtered={filtered}
              hasChannels={channels.length > 0}
              canConnectChannel={canConnectChannel}
              canUseSimulator={canUseSimulator}
              onClear={() => navigate({ ...clearFilters(query), view: "all" })}
            />
          </div>
        ) : (
          <>
            <ul aria-label="Conversaciones">
              {view.items.map((item) => (
                <ConversationRow
                  key={item.id}
                  item={item}
                  href={inboxHref(`${INBOX_PATH}/${item.id}`, query)}
                  selected={item.id === selectedId}
                  timezone={timezone}
                  now={now}
                />
              ))}
            </ul>
            {view.nextCursor ? (
              <div className="flex justify-center p-4">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                  {loadingMore ? "Cargando…" : "Cargar más"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Search by contact or text; typing waits a moment before asking, and the URL keeps it. */
function SearchBox({ query, onSearch }: { query: InboxQuery; onSearch: (search: string) => void }) {
  const [text, setText] = useState(query.search);
  const [urlSearch, setUrlSearch] = useState(query.search);
  // «Atrás» or a link changed the search: show it (unless it is what is being typed).
  if (query.search !== urlSearch) {
    setUrlSearch(query.search);
    if (query.search !== text.trim()) setText(query.search);
  }
  const latest = useRef(onSearch);
  useEffect(() => {
    latest.current = onSearch;
  });
  useEffect(() => {
    const value = text.trim();
    if (value === urlSearch) return;
    const id = window.setTimeout(() => latest.current(value), SEARCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [text, urlSearch]);

  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Buscar por contacto o texto"
        aria-label="Buscar conversaciones"
        maxLength={100}
        className="pl-8"
      />
    </div>
  );
}

type ListEmptyProps = {
  query: InboxQuery;
  filtered: boolean;
  hasChannels: boolean;
  canConnectChannel: boolean;
  canUseSimulator: boolean;
  onClear: () => void;
};

function ListEmpty({ query, filtered, hasChannels, canConnectChannel, canUseSimulator, onClear }: ListEmptyProps) {
  if (filtered) {
    return (
      <EmptyState
        icon={Search}
        title="Nada coincide con estos filtros"
        action={
          <Button variant="outline" onClick={onClear}>
            Quitar filtros
          </Button>
        }
      />
    );
  }
  if (query.view === "pending") return <EmptyState icon={Inbox} title="No hay conversaciones pendientes de humano" description="Cuando la IA pase una conversación a una persona, aparecerá aquí." />;
  if (query.view === "mine") return <EmptyState icon={Inbox} title="No tienes conversaciones asignadas" description="Las que te asignen o tomes tú aparecerán aquí." />;
  return (
    <EmptyState
      icon={Inbox}
      title="Todavía no hay conversaciones"
      description="Cuando un cliente escriba por WhatsApp, correo o el chat web, aparecerá aquí."
      action={
        canConnectChannel || canUseSimulator ? (
          <div className="flex flex-wrap justify-center gap-2">
            {canConnectChannel && !hasChannels ? (
              <Button asChild>
                <Link href="/canales/nuevo">
                  <RadioTower aria-hidden />
                  Conectar un canal
                </Link>
              </Button>
            ) : null}
            {canUseSimulator ? (
              <Button asChild variant="outline">
                <Link href="/ajustes/diagnostico/simulador">
                  <FlaskConical aria-hidden />
                  Probar con el simulador
                </Link>
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    />
  );
}

