"use client";

import { Globe, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HelpLink } from "@/components/help-link";
import { StatusLight } from "@/components/status-light";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { subscribeWabaAction, subscribeWebhookAction, webhookVerificationAction } from "../actions";
import { guideHref } from "../_lib/help";
import { CopyField } from "./copy-field";
import { useElapsedSeconds, WaitingPanel } from "./waiting-panel";
import { BusyButton, WizardFooter } from "./wizard-footer";

/** How often the manual way asks whether Meta's verification arrived ([WA-13]). */
const VERIFICATION_POLL_MS = 4_000;

type AppState =
  | { kind: "checking" }
  | { kind: "subscribed" }
  | { kind: "confirm"; currentUrl: string }
  | { kind: "manual"; reason: "no_public_url" | "meta_refused" | "declined" | "error"; error: string | null };

type WabaState = { kind: "checking" } | { kind: "subscribed" } | { kind: "failed"; error: string };

type WebhookStepProps = {
  channelId: string;
  callbackUrl: string;
  verifyToken: string;
  /** ISO time of Meta's last correct verification of this installation's address, or null. */
  verifiedAt: string | null;
  timezone: string;
  /** Webhook fields to subscribe besides «messages» (docs/integracion-whatsapp.md §4.1). */
  recommendedFields: readonly string[];
  nextHref: string;
};

/**
 * Paso 2 · Webhook ([WA-12]–[WA-16]): the automatic subscription of the app to the installation's single address (asking
 * before replacing another address of the app), the manual steps with the address and the token to copy and a live
 * notice when Meta verifies it; and, always, the app subscribed to the number's WABA, checked afterwards.
 */
export function WebhookStep({ channelId, callbackUrl, verifyToken, verifiedAt, timezone, recommendedFields, nextHref }: WebhookStepProps) {
  const [app, setApp] = useState<AppState>({ kind: "checking" });
  const [waba, setWaba] = useState<WabaState>({ kind: "checking" });
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  function subscribeWaba() {
    setWaba({ kind: "checking" });
    startTransition(async () => {
      const result = await subscribeWabaAction(channelId);
      if (!result.ok) return setWaba({ kind: "failed", error: result.error });
      setWaba(result.data?.subscribed ? { kind: "subscribed" } : { kind: "failed", error: result.data?.error ?? "Meta no muestra la app suscrita a la cuenta." });
    });
  }

  function subscribeApp(confirmReplace: boolean) {
    setApp({ kind: "checking" });
    startTransition(async () => {
      const result = await subscribeWebhookAction(channelId, { confirmReplace });
      if (!result.ok) return setApp({ kind: "manual", reason: "error", error: result.error });
      const outcome = result.data;
      if (!outcome) return;
      if (outcome.status === "subscribed") setApp({ kind: "subscribed" });
      else if (outcome.status === "needs_confirmation") setApp({ kind: "confirm", currentUrl: outcome.currentUrl });
      else setApp({ kind: "manual", reason: outcome.reason, error: outcome.error });
    });
  }

  useEffect(() => {
    // Once per visit (Strict Mode mounts twice in development): the app first, then the WABA, always.
    if (started.current) return;
    started.current = true;
    subscribeApp(false);
    subscribeWaba();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on arrival; both actions are stable server functions
  }, []);

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="wa-app-webhook" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h3 id="wa-app-webhook" className="font-semibold">
            Dirección de avisos de la app de Meta
          </h3>
          <p className="text-sm text-muted-foreground">
            Por aquí llegan los mensajes de tus clientes. Hay una sola dirección para toda la instalación, en su dominio de producción.
          </p>
        </div>
        {app.kind === "checking" ? <StatusLight status="pending" label="Conectando la dirección de avisos" /> : null}
        {app.kind === "subscribed" ? <StatusLight status="ok" label="La app de Meta envía los avisos a esta instalación" detail={callbackUrl} /> : null}
        {app.kind === "manual" ? (
          <ManualWebhook
            reason={app.reason}
            error={app.error}
            callbackUrl={callbackUrl}
            verifyToken={verifyToken}
            verifiedAt={verifiedAt}
            timezone={timezone}
            recommendedFields={recommendedFields}
            retrying={pending}
            onRetry={() => subscribeApp(false)}
          />
        ) : null}
      </section>

      <section aria-labelledby="wa-waba" className="grid gap-3 rounded-xl border bg-card p-4 sm:p-6">
        <h3 id="wa-waba" className="font-semibold">
          App suscrita a la cuenta de WhatsApp Business
        </h3>
        {waba.kind === "checking" ? <StatusLight status="pending" label="Suscribiendo la app a la cuenta del número" /> : null}
        {waba.kind === "subscribed" ? <StatusLight status="ok" label="Suscrita y comprobada" detail="Meta enviará a la app los avisos de este número." /> : null}
        {waba.kind === "failed" ? (
          <div className="grid gap-3">
            <StatusLight status="error" label="Sin suscribir" detail={`${waba.error} Sin esto no llegan los mensajes y el canal no pasa a «Conectado».`} />
            <div>
              <Button type="button" variant="outline" onClick={subscribeWaba} disabled={pending}>
                <RefreshCw aria-hidden />
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <HelpLink href={guideHref("webhook")}>Ver la guía de este paso</HelpLink>

      <ConfirmDialog
        open={app.kind === "confirm"}
        onOpenChange={(open) => {
          // Closed without «Sustituir»: the manual way. After «Sustituir» the state is no longer «confirm».
          if (!open) setApp((current) => (current.kind === "confirm" ? { kind: "manual", reason: "declined", error: null } : current));
        }}
        title="¿Sustituir la dirección de avisos de la app?"
        description={
          app.kind === "confirm"
            ? `La app de Meta ya envía sus avisos a ${app.currentUrl}. Cada app tiene una sola dirección: si la sustituyes, esa dirección dejará de recibir los avisos de todos los números de la app. Si no, te enseñamos cómo hacerlo a mano.`
            : undefined
        }
        confirmLabel="Sustituir"
        destructive
        onConfirm={() => subscribeApp(true)}
      />

      <WizardFooter back={null}>
        {waba.kind === "subscribed" ? (
          <Button asChild>
            <Link href={nextHref}>Continuar</Link>
          </Button>
        ) : (
          <Button type="button" disabled>
            Continuar
          </Button>
        )}
      </WizardFooter>
    </div>
  );
}

type ManualWebhookProps = {
  reason: "no_public_url" | "meta_refused" | "declined" | "error";
  error: string | null;
  callbackUrl: string;
  verifyToken: string;
  verifiedAt: string | null;
  timezone: string;
  recommendedFields: readonly string[];
  retrying: boolean;
  onRetry: () => void;
};

/** The manual way ([WA-13], docs §4.2): address and token to copy, the steps in Meta's panel and the live notice. */
function ManualWebhook({ reason, error, callbackUrl, verifyToken, verifiedAt, timezone, recommendedFields, retrying, onRetry }: ManualWebhookProps) {
  const [openedAt] = useState(() => Date.now());
  const elapsed = useElapsedSeconds(openedAt);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(verifiedAt);
  // Compared with what the server said when the page opened: clocks of the browser and the server never mix.
  const verifiedNow = lastVerifiedAt !== null && lastVerifiedAt !== verifiedAt;

  useEffect(() => {
    if (verifiedNow) return;
    const timer = window.setInterval(async () => {
      const result = await webhookVerificationAction();
      if (result.ok && result.data?.verifiedAt) setLastVerifiedAt(new Date(result.data.verifiedAt).toISOString());
    }, VERIFICATION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [verifiedNow]);

  return (
    <div className="grid gap-4">
      {reason === "no_public_url" ? (
        <Alert className="border-info/30 bg-info-soft text-info">
          <Globe aria-hidden />
          <AlertTitle>La app no tiene una dirección pública con HTTPS</AlertTitle>
          <AlertDescription className="text-info">Puedes validar los datos, pero no llegarán mensajes reales hasta que la app esté publicada en su dominio.</AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          {reason === "declined"
            ? "Has decidido no sustituir la dirección actual. Si quieres usar esta instalación, cámbiala a mano en el panel de la app:"
            : `No se ha podido conectar la dirección automáticamente${error ? ` (${error})` : ""}. Hazlo a mano en el panel de la app de Meta:`}
        </p>
      )}
      <CopyField label="URL de devolución de llamada (Callback URL)" value={callbackUrl} />
      <CopyField label="Token de verificación (Verify token)" value={verifyToken} />
      <ol className="grid list-decimal gap-2 pl-5 text-sm">
        <li>
          Abre tu app en el panel de desarrolladores de Meta y ve a <span className="font-medium">WhatsApp › Configuración</span>. Si la creaste con el
          caso de uso «Connect with customers through WhatsApp», está en <span className="font-medium">Casos de uso › Personalizar › Configuración</span>.
        </li>
        <li>
          En «Webhook», pega la URL y el token de arriba y pulsa <span className="font-medium">«Verificar y guardar»</span>.
        </li>
        <li>
          Suscribe el campo <code className="font-mono text-xs">messages</code> (imprescindible) y, además, los recomendados:{" "}
          <span className="font-mono text-xs break-words">{recommendedFields.join(", ")}</span>.
        </li>
      </ol>
      {verifiedNow ? (
        <StatusLight status="ok" label="Meta ha verificado la dirección" detail={`Verificación recibida el ${formatDateTime(lastVerifiedAt, timezone)}.`} />
      ) : (
        <WaitingPanel
          label="Esperando la verificación de Meta…"
          detail={verifiedAt ? `La última verificación de esta dirección fue el ${formatDateTime(verifiedAt, timezone)}. Se pondrá en verde cuando pulses «Verificar y guardar».` : "Se pondrá en verde cuando pulses «Verificar y guardar» en el panel de Meta."}
          elapsedSeconds={elapsed}
        />
      )}
      {reason !== "no_public_url" ? (
        <div>
          <BusyButton variant="outline" pending={retrying} pendingLabel="Probando…" onClick={onRetry}>
            Probar otra vez automáticamente
          </BusyButton>
        </div>
      ) : null}
    </div>
  );
}
