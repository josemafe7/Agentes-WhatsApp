"use client";

import { CircleCheck, CircleDashed, CircleX, Library, LoaderCircle, RefreshCw, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { KnowledgeBaseState } from "@/data/knowledge";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setAgentKnowledgeBaseAction } from "../actions";
import type { AgentBaseRow } from "../_lib/load";
import { KNOWLEDGE_BASE_STATE_LABELS } from "../_lib/view";

const STATE_STYLE: Record<KnowledgeBaseState, { icon: LucideIcon; className: string }> = {
  ready: { icon: CircleCheck, className: "bg-success-soft text-success" },
  processing: { icon: LoaderCircle, className: "bg-info-soft text-info" },
  reindexing: { icon: RefreshCw, className: "bg-info-soft text-info" },
  errors: { icon: CircleX, className: "bg-destructive-soft text-destructive-text" },
  empty: { icon: CircleDashed, className: "bg-muted text-muted-foreground" },
};

type KnowledgeBasesListProps = {
  agentId: string;
  bases: AgentBaseRow[];
  /** Owner and admin switch bases on and off; the rest see the ones the agent uses. */
  canManage: boolean;
  /** May open the base in Conocimiento. */
  canOpen: boolean;
};

/** Level 2 of the agent's knowledge ([AGE-07], [CON-03]): one switch per base; the agent searches only these. */
export function KnowledgeBasesList({ agentId, bases, canManage, canOpen }: KnowledgeBasesListProps) {
  // One change at a time: each one is computed on the server from the bases saved at that moment.
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(base: AgentBaseRow, attached: boolean) {
    setBusy(base.id);
    const result = await setAgentKnowledgeBaseAction({ agentId, kbId: base.id, attached });
    setBusy(null);
    if (result.ok) toast.success(result.message ?? "Bases actualizadas.");
    else toast.error(result.error);
  }

  return (
    <ul className="grid divide-y rounded-xl border" aria-labelledby="knowledge-bases-heading">
      {bases.map((base) => {
        const switchId = `knowledge-base-${base.id}`;
        const style = base.state ? STATE_STYLE[base.state] : null;
        const StateIcon = style?.icon;
        const details = [base.description, base.documentCount === null ? null : base.documentCount === 1 ? "1 documento" : `${formatNumber(base.documentCount)} documentos`]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={base.id} className="flex items-start gap-4 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Library aria-hidden className="size-5" />
            </span>
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                {canManage ? (
                  <label htmlFor={switchId} className="text-sm font-medium break-words">
                    {base.name}
                  </label>
                ) : (
                  <span className="text-sm font-medium break-words">{base.name}</span>
                )}
                {base.state && style && StateIcon ? (
                  <Badge variant="outline" className={cn("h-[22px] border-transparent", style.className)}>
                    <StateIcon aria-hidden />
                    {KNOWLEDGE_BASE_STATE_LABELS[base.state]}
                  </Badge>
                ) : null}
              </div>
              {details ? (
                <p id={`${switchId}-help`} className="line-clamp-2 text-sm text-muted-foreground">
                  {details}
                </p>
              ) : null}
              {canOpen ? (
                <Link href={`/conocimiento/${base.id}`} className="w-fit text-sm text-primary-text underline-offset-4 hover:underline">
                  Abrir la base
                </Link>
              ) : null}
            </div>
            {canManage ? (
              <div className="flex items-center gap-2 pt-0.5">
                <span aria-hidden className="hidden text-sm sm:inline">
                  Usar
                </span>
                <Switch
                  id={switchId}
                  checked={base.selected}
                  disabled={busy !== null}
                  aria-busy={busy === base.id}
                  aria-describedby={details ? `${switchId}-help` : undefined}
                  onCheckedChange={(attached) => void toggle(base, attached)}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
