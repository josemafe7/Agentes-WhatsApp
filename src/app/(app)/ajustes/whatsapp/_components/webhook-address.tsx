import { CircleCheck, TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import type { WhatsAppWebhookSetup } from "@/data/whatsapp";
import { formatDateTime } from "@/lib/format";

function CopyRow({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <div className="grid gap-1.5">
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <output aria-labelledby={id} className="min-w-0 flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-xs break-all">
          {value}
        </output>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

/**
 * The installation's single webhook address and its verify token ([WA-12], [WA-13], [WA-16]): data to copy into the
 * Meta app when the automatic subscription is not possible. Owner and admin only.
 */
export function WebhookAddress({ setup, timezone }: { setup: WhatsAppWebhookSetup; timezone: string }) {
  return (
    <div className="grid gap-4 rounded-xl border p-4">
      <CopyRow id="webhook-url" label="Dirección de avisos (Callback URL)" value={setup.callbackUrl} />
      <CopyRow id="webhook-token" label="Token de verificación (Verify token)" value={setup.verifyToken} />
      {setup.publicHttps ? null : (
        <p className="flex items-start gap-2 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          La app no tiene una dirección pública con HTTPS: puedes validar los datos de Meta, pero no llegarán mensajes reales.
        </p>
      )}
      {setup.verifiedAt ? (
        <p className="flex items-start gap-2 text-sm text-success">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          Meta verificó esta dirección el {formatDateTime(setup.verifiedAt, timezone)}.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Meta todavía no ha verificado esta dirección.</p>
      )}
    </div>
  );
}
