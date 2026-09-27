import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { WhatsAppTemplateItem } from "@/data/whatsapp-templates";
import { formatDateTime } from "@/lib/format";
import { templateCategoryLabel, templateStatusView } from "./_lib/view";
import { StatusPill } from "./status-pill";
import { SyncTemplatesButton } from "./sync-templates-button";

type TemplatesSectionProps = { channelId: string; templates: WhatsAppTemplateItem[]; canSync: boolean; timezone: string };

function variablesText(variables: string[]): string {
  if (variables.length === 0) return "Sin variables";
  return `Variables: ${variables.map((name) => `{{${name}}}`).join(", ")}`;
}

/**
 * Plantillas of the number ([WA-22]): each one with its status and category, language and variables, and «Sincronizar».
 * Meta updates their status on its own through its notices; only approved ones can be sent outside the 24 h window.
 */
export function TemplatesSection({ channelId, templates, canSync, timezone }: TemplatesSectionProps) {
  const lastSync = templates.reduce<Date | null>((latest, template) => (template.lastSyncedAt && (!latest || template.lastSyncedAt > latest) ? template.lastSyncedAt : latest), null);

  return (
    <section aria-labelledby="whatsapp-templates" className="grid gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="whatsapp-templates" className="text-base font-semibold">
            Plantillas
          </h2>
          <p className="text-sm text-muted-foreground">
            Fuera de la ventana de 24 horas solo se puede escribir con una plantilla aprobada por Meta. Se crean en WhatsApp Manager.
            {lastSync ? ` Última sincronización: ${formatDateTime(lastSync, timezone)}.` : ""}
          </p>
        </div>
        {canSync ? <SyncTemplatesButton channelId={channelId} /> : null}
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Todavía no hay plantillas"
          description={canSync ? "Pulsa «Sincronizar» para traer las plantillas de este número desde Meta." : "Aún no se han traído las plantillas de este número desde Meta."}
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {templates.map((template) => {
            const status = templateStatusView(template.status);
            return (
              <li key={template.id} className="grid gap-1.5 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium break-all">{template.name}</span>
                  <span className="text-xs text-muted-foreground">{template.language}</span>
                  <StatusPill status={status.status} label={status.label} />
                  <span className="text-xs text-muted-foreground">{templateCategoryLabel(template.category)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{variablesText(template.variables)}</p>
                {template.rejectedReason ? <p className="text-xs text-muted-foreground">Motivo que da Meta: {template.rejectedReason}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
