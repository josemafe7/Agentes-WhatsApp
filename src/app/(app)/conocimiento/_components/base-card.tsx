import { Bot } from "lucide-react";
import Link from "next/link";
import type { KnowledgeBaseSummary } from "@/data/knowledge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { countLabel } from "../_lib/labels";
import { knowledgeBasePath } from "../_lib/paths";
import { BaseStateBadge } from "./status-badge";

/**
 * Card of a knowledge base (docs/pantallas.md «Bases de conocimiento»): documents and fragments, state, embeddings
 * model, agents that use it and last update. The whole card opens the base.
 */
export function BaseCard({ base, timezone }: { base: KnowledgeBaseSummary; timezone: string }) {
  return (
    <li className="relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="truncate text-base font-semibold">
            <Link href={knowledgeBasePath(base.id)} className="outline-none after:absolute after:inset-0 after:rounded-xl">
              {base.name}
            </Link>
          </h2>
          <p className="truncate text-sm text-muted-foreground">{base.description || "Sin descripción"}</p>
        </div>
        <BaseStateBadge state={base.state} />
      </div>
      <p className="text-sm tabular-nums">
        {countLabel(base.documentCount, "documento", "documentos")} · {countLabel(base.chunkCount, "fragmento", "fragmentos")}
        {base.errorCount > 0 ? <span className="text-destructive-text"> · {countLabel(base.errorCount, "con error", "con error")}</span> : null}
      </p>
      <p className="truncate font-mono text-xs text-muted-foreground" title={base.embeddingModel}>
        {base.embeddingModel}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Usada por:</span>
        {base.agents.length === 0 ? (
          <span className="text-muted-foreground">ningún agente</span>
        ) : (
          base.agents.map((agent) => (
            <span key={agent.id} className="inline-flex h-[22px] items-center gap-1 rounded-full border px-2 font-medium">
              <Bot aria-hidden className="size-3.5 text-ai" />
              {agent.name}
            </span>
          ))
        )}
      </div>
      <p className="mt-auto text-xs text-muted-foreground">
        Actualizada{" "}
        <time dateTime={base.updatedAt.toISOString()} title={formatDateTime(base.updatedAt, timezone)} className="tabular-nums">
          {formatRelative(base.updatedAt, timezone)}
        </time>
      </p>
    </li>
  );
}
