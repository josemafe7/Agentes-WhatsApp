"use client";

import { Plus, Webhook } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AgentCustomToolRow } from "@/data/custom-tools";
import { HTTP_TOOLS_PATH, NEW_HTTP_TOOL_PATH } from "@/app/(app)/agentes/herramientas/_lib/paths";
import { setAgentCustomToolAction } from "../actions";

/**
 * Herramientas HTTP of one agent ([AGE-08], [HER-11]): one switch per tool of the business; the agent can call only the
 * ones switched on, from its next message (in «Probar» too). Owner and admin only.
 */
export function CustomToolsSection({ agentId, tools }: { agentId: string; tools: AgentCustomToolRow[] }) {
  // One change at a time: each is saved on the server before the next.
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(tool: AgentCustomToolRow, attached: boolean) {
    setBusy(tool.id);
    const result = await setAgentCustomToolAction({ agentId, toolId: tool.id, attached });
    setBusy(null);
    if (result.ok) toast.success(result.message ?? "Herramientas actualizadas.");
    else toast.error(result.error);
  }

  return (
    <section aria-labelledby="http-tools-heading" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="http-tools-heading" className="text-base font-semibold">
            Herramientas HTTP
          </h2>
          <p className="text-sm text-muted-foreground">Conectan el agente con otros programas, como n8n o tu CRM: la IA las llama cuando las necesita.</p>
        </div>
        {tools.length > 0 ? (
          <Button asChild variant="outline">
            <Link href={HTTP_TOOLS_PATH}>Gestionar herramientas HTTP</Link>
          </Button>
        ) : null}
      </div>
      {tools.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Webhook}
            title="Todavía no hay herramientas HTTP"
            description="Crea una para que el agente consulte o envíe datos a otro programa, como un flujo de n8n o tu CRM."
            action={
              <Button asChild>
                <Link href={NEW_HTTP_TOOL_PATH}>
                  <Plus aria-hidden />
                  Nueva herramienta
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid divide-y rounded-xl border">
          {tools.map((tool) => {
            const switchId = `http-tool-${tool.id}`;
            return (
              <li key={tool.id} className="flex items-start gap-4 p-4">
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={switchId} className="font-mono text-sm font-medium break-all">
                      {tool.name}
                    </label>
                    <Badge variant="outline" className="h-[22px] font-mono">
                      {tool.method}
                    </Badge>
                  </div>
                  <p id={`${switchId}-help`} className="line-clamp-2 text-sm text-muted-foreground">
                    {tool.description}
                    {tool.host ? <span className="font-mono"> · {tool.host}</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  <span aria-hidden className="hidden text-sm sm:inline">
                    Usar
                  </span>
                  <Switch
                    id={switchId}
                    checked={tool.attached}
                    disabled={busy !== null}
                    aria-busy={busy === tool.id}
                    aria-describedby={`${switchId}-help`}
                    onCheckedChange={(attached) => void toggle(tool, attached)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
