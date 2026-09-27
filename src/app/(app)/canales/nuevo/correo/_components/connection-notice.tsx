import { CircleX, ShieldCheck, TriangleAlert } from "lucide-react";
import { HelpLink } from "@/components/help-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { EmailChannelType } from "@/server/channels/email/config";
import type { ConnectionOutcome } from "../_lib/connection";
import { guideHref } from "../_lib/help";
import { GOOGLE_PERMISSIONS, MICROSOFT_PERMISSIONS } from "../_lib/permissions";
import { PermissionList } from "./permission-list";

type ConnectionNoticeProps = {
  type: EmailChannelType;
  outcome: ConnectionOutcome | null;
  /** «Requiere reconexión» and why ([COR-22]). */
  reconnectReason: string | null;
};

/**
 * On top of «Conectar»: why the return from Google or Microsoft did not connect, in Spanish and with nothing stored
 * ([COR-03], [COR-23]); the permissions to grant when some were missing; the administrator's consent given; or why the
 * mailbox needs reconnecting ([COR-22]).
 */
export function ConnectionNotice({ type, outcome, reconnectReason }: ConnectionNoticeProps) {
  if (outcome?.kind === "failed") {
    const permissions = type === "email_gmail" ? GOOGLE_PERMISSIONS : type === "email_outlook" ? MICROSOFT_PERMISSIONS : [];
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <CircleX aria-hidden />
        <AlertTitle>No se ha conectado el buzón</AlertTitle>
        <AlertDescription className="grid gap-2">
          <p>{outcome.message}</p>
          {outcome.reason === "missing_scopes" && permissions.length > 0 ? (
            <>
              <p>Hay que conceder todos estos permisos:</p>
              <PermissionList items={permissions} className="text-foreground" />
            </>
          ) : null}
          <HelpLink href={guideHref(outcome.reason === "missing_scopes" && type === "email_outlook" ? "permisos" : "problemas")}>Qué hacer</HelpLink>
        </AlertDescription>
      </Alert>
    );
  }
  if (outcome?.kind === "admin_consent") {
    return (
      <Alert role="status" className="max-w-2xl border-success/30 bg-success-soft text-success">
        <ShieldCheck aria-hidden />
        <AlertTitle>El administrador ha dado su consentimiento</AlertTitle>
        <AlertDescription className="text-success">Ahora pulsa «Conectar con Microsoft» para conectar el buzón.</AlertDescription>
      </Alert>
    );
  }
  if (reconnectReason) {
    return (
      <Alert className="max-w-2xl border-warning/30 bg-warning-soft text-warning">
        <TriangleAlert aria-hidden />
        <AlertTitle>Requiere reconexión</AlertTitle>
        <AlertDescription className="grid gap-1 text-warning">
          <p>{reconnectReason}</p>
          <p>Vuelve a conectarlo: se conservan las conversaciones y se sigue leyendo desde donde se quedó.</p>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
