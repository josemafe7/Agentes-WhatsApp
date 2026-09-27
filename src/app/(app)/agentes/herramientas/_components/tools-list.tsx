import { TriangleAlert, Webhook } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { CustomToolSummary } from "@/data/custom-tools";
import { httpToolPath } from "../_lib/paths";
import { DeleteToolButton } from "./delete-tool-button";

function usedBy(tool: CustomToolSummary): string {
  if (tool.agents.length === 0) return "Ningún agente la usa todavía.";
  return `La usa${tool.agents.length > 1 ? "n" : ""}: ${tool.agents.map((agent) => agent.name).join(", ")}.`;
}

/** One row per tool: name, what it does, where it calls and which agents use it ([HER-11], [AGE-08]). */
export function ToolsList({ tools }: { tools: CustomToolSummary[] }) {
  return (
    <ul className="grid divide-y rounded-xl border">
      {tools.map((tool) => (
        <li key={tool.id} className="flex items-start gap-4 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Webhook aria-hidden className="size-5" />
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={httpToolPath(tool.id)} className="font-mono text-sm font-medium break-all text-primary-text underline-offset-4 hover:underline">
                {tool.name}
              </Link>
              <Badge variant="outline" className="h-[22px] font-mono">
                {tool.method}
              </Badge>
              {!tool.headersReadable ? (
                <Badge variant="outline" className="h-[22px] border-transparent bg-warning-soft text-warning">
                  <TriangleAlert aria-hidden />
                  Cabeceras ilegibles
                </Badge>
              ) : null}
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{tool.description}</p>
            <p className="text-sm text-muted-foreground">
              {tool.host ? <span className="font-mono">{tool.host}</span> : null}
              {tool.host ? " · " : null}
              {usedBy(tool)}
            </p>
          </div>
          <DeleteToolButton toolId={tool.id} name={tool.name} agents={tool.agents} compact />
        </li>
      ))}
    </ul>
  );
}
