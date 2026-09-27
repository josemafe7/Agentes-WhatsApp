import { CircleCheck, CircleDashed, CircleX, Clock, LoaderCircle, type LucideIcon } from "lucide-react";
import type { KnowledgeBaseState } from "@/data/knowledge";
import type { KbDocumentStatus } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { baseStateView, documentStatusView, type StatusTone } from "../_lib/labels";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  error: "bg-destructive-soft text-destructive-text",
};

type StatusBadgeProps = { tone: StatusTone; label: string; icon: LucideIcon; spin?: boolean; className?: string };

/** Status pill (DESIGN.md «Insignia de estado»): soft background, icon and word in the colour of the state. */
export function StatusBadge({ tone, label, icon: Icon, spin = false, className }: StatusBadgeProps) {
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap", TONE_CLASSES[tone], className)}>
      <Icon aria-hidden className={cn("size-3.5", spin && "animate-spin motion-reduce:animate-none")} />
      {label}
    </span>
  );
}

/** En cola → extrayendo → troceando → embeddings → listo (o «Listo (solo texto)») or error ([CON-05], [CON-12]). */
export function DocumentStatusBadge({ doc }: { doc: { status: KbDocumentStatus; error: string | null; textOnly: boolean } }) {
  const view = documentStatusView(doc);
  const icon = doc.status === "error" ? CircleX : doc.status === "ready" ? CircleCheck : doc.status === "queued" ? Clock : LoaderCircle;
  return <StatusBadge tone={view.tone} label={view.label} icon={icon} spin={view.busy && doc.status !== "queued"} />;
}

const BASE_STATE_ICONS: Record<KnowledgeBaseState, LucideIcon> = {
  ready: CircleCheck,
  processing: LoaderCircle,
  reindexing: LoaderCircle,
  errors: CircleX,
  empty: CircleDashed,
};

/** Lista, indexando, reindexando, con errores o vacía (docs/pantallas.md «Bases de conocimiento»). */
export function BaseStateBadge({ state }: { state: KnowledgeBaseState }) {
  const view = baseStateView(state);
  return <StatusBadge tone={view.tone} label={view.label} icon={BASE_STATE_ICONS[state]} spin={state === "processing" || state === "reindexing"} />;
}
