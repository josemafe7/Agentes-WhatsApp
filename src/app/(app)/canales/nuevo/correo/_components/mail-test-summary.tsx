import { HelpLink } from "@/components/help-link";
import { StatusLight } from "@/components/status-light";
import type { MailTestResult } from "@/server/channels/email/imap/connect";
import { guideHref } from "../_lib/help";

/**
 * «Probar conexión» ([COR-11], [COR-13]): IMAP and SMTP as traffic lights, each failure in Spanish with what to do. A
 * Microsoft mailbox is not shown here: the form already sends it to the Outlook option ([COR-09]).
 */
export function MailTestSummary({ result }: { result: MailTestResult }) {
  if (!result.ok && result.microsoft) return null;
  return (
    <section aria-label="Resultado de la prueba" role="status" className="grid gap-3 rounded-xl border bg-card p-4">
      {result.ok ? (
        <>
          <StatusLight
            status="ok"
            label="Entrada (IMAP)"
            detail={result.draftsPath ? `Conecta y encuentra tus carpetas. Los borradores de la IA irán a «${result.draftsPath}».` : "Conecta y lee la bandeja de entrada."}
          />
          <StatusLight
            status="ok"
            label="Envío (SMTP)"
            detail={
              result.savesSent
                ? "Envía, y tu proveedor guarda solo una copia en Enviados."
                : result.sentPath
                  ? `Envía, y guardaremos una copia en «${result.sentPath}».`
                  : "Envía. No hemos encontrado la carpeta de enviados."
            }
          />
        </>
      ) : (
        <>
          <StatusLight status={result.imap ? "error" : "ok"} label="Entrada (IMAP)" detail={result.imap ?? "Funciona."} />
          <StatusLight status={result.smtp ? "error" : "ok"} label="Envío (SMTP)" detail={result.smtp ?? "Funciona."} />
          {result.wrongPassword ? (
            <p className="text-sm text-muted-foreground">
              Si tu proveedor usa la verificación en dos pasos, crea una contraseña de aplicación y pégala en «Contraseña».{" "}
              <HelpLink href={guideHref("contrasena-de-aplicacion")}>Cómo crearla</HelpLink>
            </p>
          ) : (
            <HelpLink href={guideHref("problemas")}>Qué hacer si no conecta</HelpLink>
          )}
        </>
      )}
    </section>
  );
}
