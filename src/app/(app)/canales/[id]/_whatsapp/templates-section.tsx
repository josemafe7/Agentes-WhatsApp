import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { WhatsAppTemplateItem } from "@/data/whatsapp-templates";
import { formatDateTime } from "@/lib/format";
import { rejectionReasonText } from "@/server/channels/whatsapp/template-changes";
import { templateCategoryLabel, templateStatusView } from "./_lib/view";
import { NewTemplateDialog } from "./new-template-dialog";
import { StatusPill } from "./status-pill";
import { SyncTemplatesButton } from "./sync-templates-button";
import { TemplateButtonsForm } from "./template-buttons-form";

type TemplatesSectionProps = {
  channelId: string;
  templates: WhatsAppTemplateItem[];
  canSync: boolean;
  /** «Nueva plantilla» and what each button does: owner and admin, with the number connected or on a demo one. */
  canCreate: boolean;
  timezone: string;
  /** For the models and warnings of «Nueva plantilla» ([CUM-14]). */
  healthData: boolean;
  businessName: string;
  /** «desde Meta» or «desde YCloud». */
  provider?: string;
};

function variablesText(variables: string[]): string {
  if (variables.length === 0) return "Sin variables";
  return `Variables: ${variables.map((name) => `{{${name}}}`).join(", ")}`;
}

function ttlText(seconds: number): string {
  if (seconds % 3_600 === 0) return seconds === 3_600 ? "1 hora" : `${seconds / 3_600} horas`;
  if (seconds % 60 === 0) return `${seconds / 60} minutos`;
  return `${seconds} segundos`;
}

/** What happened to its category ([WA-60]): approved in another one, moved after, or announced for a date. */
function CategoryNotes({ template, timezone }: { template: WhatsAppTemplateItem; timezone: string }) {
  const notes: string[] = [];
  const asked = template.requestedCategory;
  if (asked && template.category && asked.toUpperCase() !== template.category.toUpperCase() && !template.previousCategory) {
    notes.push(`Pedida como ${templateCategoryLabel(asked).toLowerCase()}; Meta la ha aprobado como ${templateCategoryLabel(template.category).toLowerCase()}.`);
  }
  if (template.previousCategory && template.categoryChangedAt) {
    notes.push(
      `Meta la pasó de ${templateCategoryLabel(template.previousCategory).toLowerCase()} a ${templateCategoryLabel(template.category).toLowerCase()} el ${formatDateTime(template.categoryChangedAt, timezone, { preset: "date" })}.`,
    );
  }
  if (template.upcomingCategory) {
    const when = template.upcomingCategoryAt ? ` el ${formatDateTime(template.upcomingCategoryAt, timezone)}` : "";
    notes.push(`Meta la pasará a ${templateCategoryLabel(template.upcomingCategory).toLowerCase()}${when}.`);
  }
  if (template.category?.toUpperCase() === "MARKETING" && (template.requestedCategory?.toUpperCase() === "UTILITY" || template.previousCategory?.toUpperCase() === "UTILITY")) {
    notes.push("Ya no sirve para los recordatorios: salen por el siguiente canal marcado hasta que elijas otra.");
  }
  if (notes.length === 0) return null;
  return (
    <div className="grid gap-0.5 text-xs text-warning">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

/**
 * Plantillas of the number ([WA-22], [WA-57]–[WA-60]): each one with its status, category, language and variables, what
 * happened to its category, its own time-to-live and what each button does; «Sincronizar» and «Nueva plantilla». Meta
 * updates their status on its own through its notices; only approved ones can be sent outside the 24 h window.
 */
export function TemplatesSection({ channelId, templates, canSync, canCreate, timezone, healthData, businessName, provider = "desde Meta" }: TemplatesSectionProps) {
  const lastSync = templates.reduce<Date | null>((latest, template) => (template.lastSyncedAt && (!latest || template.lastSyncedAt > latest) ? template.lastSyncedAt : latest), null);

  return (
    <section aria-labelledby="whatsapp-templates" className="grid gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="whatsapp-templates" className="text-base font-semibold">
            Plantillas
          </h2>
          <p className="text-sm text-muted-foreground">
            Fuera de la ventana de 24 horas solo se puede escribir con una plantilla aprobada por Meta. Se crean aquí y se editan o se borran en WhatsApp
            Manager.
            {lastSync ? ` Última sincronización: ${formatDateTime(lastSync, timezone)}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate ? <NewTemplateDialog channelId={channelId} healthData={healthData} businessName={businessName} /> : null}
          {canSync ? <SyncTemplatesButton channelId={channelId} /> : null}
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Todavía no hay plantillas"
          description={canSync ? `Pulsa «Sincronizar» para traer las plantillas de este número ${provider}, o crea una.` : `Aún no se han traído las plantillas de este número ${provider}.`}
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
                  {template.createdInApp ? <span className="text-xs text-muted-foreground">Creada desde la app</span> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {variablesText(template.variables)}
                  {template.ttlSeconds ? ` · Caducidad: ${ttlText(template.ttlSeconds)}` : ""}
                </p>
                <CategoryNotes template={template} timezone={timezone} />
                {template.status?.toUpperCase() === "REJECTED" ? <p className="text-xs text-destructive-text">Rechazada: {rejectionReasonText(template.rejectedReason)}</p> : null}
                {canCreate && template.quickReplies.length > 0 ? <TemplateButtonsForm templateId={template.id} buttons={template.quickReplies} roles={template.buttonRoles} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
