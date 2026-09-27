import { BellOff, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { WhatsAppAccountNotice } from "@/data/whatsapp-account-alerts";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { accountNoticeView, type NoticeSeverity } from "./_lib/view";

const SEVERITY: Record<NoticeSeverity, { icon: LucideIcon; className: string; word: string }> = {
  error: { icon: CircleX, className: "text-destructive-text", word: "Importante" },
  warn: { icon: TriangleAlert, className: "text-warning", word: "Aviso" },
  info: { icon: Info, className: "text-info", word: "Información" },
};

/**
 * «Avisos de Meta» ([WA-29]): the account, quality, name, template and security notices Meta sent about this number,
 * newest first, with our Spanish title and, under it, Meta's own words shown as data.
 */
export function NoticesSection({ notices, timezone }: { notices: WhatsAppAccountNotice[]; timezone: string }) {
  return (
    <section aria-labelledby="whatsapp-notices" className="grid gap-4 rounded-xl border p-4">
      <div className="grid gap-1">
        <h2 id="whatsapp-notices" className="text-base font-semibold">
          Avisos de Meta
        </h2>
        <p className="text-sm text-muted-foreground">
          Lo que Meta ha avisado sobre la cuenta, la calidad, el nombre y las plantillas de este número. Se ven mientras se conservan los avisos
          recibidos.
        </p>
      </div>
      {notices.length === 0 ? (
        <EmptyState icon={BellOff} title="Sin avisos de Meta" description="Cuando Meta avise de algo sobre este número, aparecerá aquí y en tus notificaciones." />
      ) : (
        <ul className="grid gap-3">
          {notices.map((notice) => {
            const view = accountNoticeView(notice);
            const { icon: Icon, className, word } = SEVERITY[view.severity];
            return (
              <li key={notice.id} className="flex items-start gap-2 text-sm">
                <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
                <div className="grid min-w-0 gap-0.5">
                  <p>
                    <span className="sr-only">{word}: </span>
                    <span className="font-medium">{view.title}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(notice.receivedAt, timezone)}</p>
                  {notice.metaText ? <p className="text-xs break-words text-muted-foreground">Meta dice: {notice.metaText}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
