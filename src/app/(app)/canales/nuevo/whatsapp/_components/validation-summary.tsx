import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { StatusLight } from "@/components/status-light";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { WhatsAppValidationView } from "@/data/whatsapp";
import { canSendOf, isBusinessVerified, messagingLimitOf, nameStatusOf, numberStatusOf, qualityOf, verificationOf } from "../_lib/labels";

type ValidView = Extract<WhatsAppValidationView, { ok: true }>;

/**
 * «Negocio · Número · Estado» after «Validar con Meta» ([WA-08]): verified name, number, quality and the state of the
 * name and of the verification, with the warnings that do not block ([WA-07]) and Meta's own notes (in English).
 */
export function ValidationSummary({ view, isMetaTestNumber }: { view: ValidView; isMetaTestNumber: boolean }) {
  const { summary } = view;
  const status = numberStatusOf(summary.numberStatus);
  const name = nameStatusOf(summary.nameStatus);
  const quality = qualityOf(summary.qualityRating);
  const verification = verificationOf(summary.codeVerificationStatus);
  const canSend = canSendOf(summary.canSendMessage);
  const heading = [summary.businessName ?? summary.verifiedName ?? "Negocio sin nombre", summary.displayPhoneNumber ?? "Número sin datos", status.label].join(" · ");

  return (
    <section aria-labelledby="whatsapp-summary-title" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
      <div className="grid gap-1">
        <p className="flex items-center gap-2 text-sm text-success">
          <CircleCheck aria-hidden className="size-4" />
          Meta ha validado los datos
        </p>
        <h3 id="whatsapp-summary-title" className="text-lg font-semibold">
          {heading}
        </h3>
        <p className="text-xs text-muted-foreground">Negocio · Número · Estado. Comprueba que es el número que quieres conectar.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatusLight status={name.tone} label="Nombre" detail={`${summary.verifiedName ?? "Sin nombre"} · ${name.label}`} />
        <StatusLight status={quality.tone} label="Calidad" detail={quality.label} />
        <StatusLight status={verification.tone} label="Verificación del número" detail={verification.label} />
        <StatusLight status={canSend.tone} label="Envío" detail={canSend.label} />
        <StatusLight status="off" label="Límite de mensajes" detail={messagingLimitOf(summary.messagingLimit)} />
        <StatusLight
          status={isBusinessVerified(summary.businessVerificationStatus) ? "ok" : "warn"}
          label="Empresa"
          detail={isBusinessVerified(summary.businessVerificationStatus) ? "Verificada en Meta" : "Sin verificar: se aplican los límites de empresa sin verificar"}
        />
      </div>
      {summary.healthNotes.length > 0 ? (
        <div className="grid gap-1 text-xs text-muted-foreground">
          <p>Notas de Meta (en inglés):</p>
          <ul className="list-disc pl-5">
            {summary.healthNotes.map((note) => (
              <li key={note} lang="en">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.warnings.length > 0 ? (
        <Alert className="border-warning/30 bg-warning-soft text-warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Revisa el token</AlertTitle>
          <AlertDescription className="text-warning">
            <ul className="list-disc pl-4">
              {view.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {view.appSecretReused ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Se usa el App Secret que ya tenías guardado de otro número de esta misma app de Meta.
        </p>
      ) : null}
      {isMetaTestNumber ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Número de prueba de Meta: solo reciben mensajes los destinatarios que hayas verificado en Meta (API Setup, campo «To»).
        </p>
      ) : null}
    </section>
  );
}
