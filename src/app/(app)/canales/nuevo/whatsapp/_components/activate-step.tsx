"use client";

import { FlaskConical, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { StatusLight } from "@/components/status-light";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkNumberAction } from "../actions";
import { isNumberRegistered, isNumberVerified, numberStatusOf } from "../_lib/labels";
import { LiveChecklist, PaymentChecklist, TemplatesSync, type LegalUrls } from "./activation-checklist";
import { RegisterNumber, VerifyNumber } from "./number-activation";
import { WizardFooter } from "./wizard-footer";

/** Meta's registrations per number in 72 h ([WA-18]): with all of them left, nothing has been tried yet. */
const REGISTER_ATTEMPTS = 10;

type NumberState =
  | { kind: "checking" }
  | { kind: "known"; verified: boolean; registered: boolean; statusLabel: string }
  /** Meta could not be asked: registration stays available. */
  | { kind: "unknown"; error: string };

type ActivateStepProps = {
  channelId: string;
  isMetaTestNumber: boolean;
  hasPin: boolean;
  register: { left: number; nextFreeAt: string | null };
  appLiveConfirmed: boolean;
  paymentConfirmed: boolean;
  templates: number;
  legalUrls: LegalUrls;
  timezone: string;
  backHref: string;
  nextHref: string;
};

/**
 * Paso 3 · Activar ([WA-17]–[WA-22]): the number as Meta sees it now; its ownership code if it is not verified; its
 * registration if it is not registered; the «App publicada (Live)» and «Método de pago» checks; and the templates.
 * Meta's test number comes registered and needs no payment method ([WA-03]).
 */
export function ActivateStep(props: ActivateStepProps) {
  const { channelId, isMetaTestNumber } = props;
  const [number, setNumber] = useState<NumberState>({ kind: "checking" });
  const [paymentConfirmed, setPaymentConfirmed] = useState(props.paymentConfirmed);
  const [checking, startChecking] = useTransition();
  const started = useRef(false);

  function check() {
    setNumber({ kind: "checking" });
    startChecking(async () => {
      const result = await checkNumberAction(channelId);
      if (!result.ok) return setNumber({ kind: "unknown", error: result.error });
      const view = result.data;
      if (!view) return;
      if (!view.ok) return setNumber({ kind: "unknown", error: view.error });
      const { numberStatus, codeVerificationStatus } = view.summary;
      setNumber({ kind: "known", verified: isNumberVerified(codeVerificationStatus), registered: isNumberRegistered(numberStatus), statusLabel: numberStatusOf(numberStatus).label });
    });
  }

  useEffect(() => {
    // Once per visit (Strict Mode mounts twice in development); the test number needs nothing from Meta here.
    if (started.current || isMetaTestNumber) return;
    started.current = true;
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on arrival; check() only uses the channel id
  }, []);

  const registered = isMetaTestNumber || (number.kind === "known" && number.registered);
  const canContinue = isMetaTestNumber || (registered && paymentConfirmed);

  return (
    <div className="grid max-w-3xl gap-6">
      {isMetaTestNumber ? (
        <Alert className="border-info/30 bg-info-soft text-info">
          <FlaskConical aria-hidden />
          <AlertTitle>Número de prueba de Meta</AlertTitle>
          <AlertDescription className="text-info">
            Ya viene registrado: no hace falta verificarlo, registrarlo ni añadir un método de pago. Recuerda que solo reciben mensajes los
            destinatarios que hayas verificado en Meta (API Setup, campo «To»).
          </AlertDescription>
        </Alert>
      ) : (
        <section aria-labelledby="wa-number" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
          <h3 id="wa-number" className="font-semibold">
            Activar el número
          </h3>
          {number.kind === "checking" ? <StatusLight status="pending" label="Comprobando el número con Meta" /> : null}
          {number.kind === "unknown" ? (
            <div className="grid gap-3">
              <StatusLight status="off" label="No se ha podido comprobar el número" detail={number.error} />
              <div>
                <Button type="button" variant="outline" onClick={check} disabled={checking}>
                  <RefreshCw aria-hidden />
                  Volver a comprobar
                </Button>
              </div>
            </div>
          ) : null}
          {number.kind === "known" && !number.verified ? (
            <VerifyNumber channelId={channelId} onVerified={() => setNumber({ ...number, verified: true })} />
          ) : null}
          {number.kind === "known" && number.verified ? <StatusLight status="ok" label="Número verificado" /> : null}
          {number.kind === "known" && number.registered ? (
            <StatusLight status="ok" label="Número registrado en la API de WhatsApp" detail={`Estado en Meta: ${number.statusLabel}.`} />
          ) : null}
          {(number.kind === "known" && !number.registered) || number.kind === "unknown" ? (
            <RegisterNumber
              channelId={channelId}
              hasPin={props.hasPin}
              initialLeft={props.register.left}
              initialNextFreeAt={props.register.nextFreeAt}
              blocked={number.kind === "known" && !number.verified}
              autoStart={number.kind === "known" && number.verified && props.register.left === REGISTER_ATTEMPTS}
              timezone={props.timezone}
              onRegistered={() => setNumber({ kind: "known", verified: true, registered: true, statusLabel: numberStatusOf("CONNECTED").label })}
              onNeedsVerification={() => setNumber({ kind: "known", verified: false, registered: false, statusLabel: numberStatusOf("PENDING").label })}
            />
          ) : null}
        </section>
      )}

      <LiveChecklist channelId={channelId} initialChecked={props.appLiveConfirmed} legalUrls={props.legalUrls} />
      {isMetaTestNumber ? null : <PaymentChecklist channelId={channelId} checked={paymentConfirmed} onChecked={setPaymentConfirmed} />}
      <TemplatesSync channelId={channelId} initialCount={props.templates} />

      <WizardFooter back={{ href: props.backHref }}>
        {canContinue ? (
          <Button asChild>
            <Link href={props.nextHref}>Continuar</Link>
          </Button>
        ) : (
          <Button type="button" disabled aria-describedby="wa-activate-missing">
            Continuar
          </Button>
        )}
      </WizardFooter>
      {canContinue ? null : (
        <p id="wa-activate-missing" className="-mt-4 text-right text-xs text-muted-foreground">
          {registered ? "Falta confirmar el método de pago." : "Falta registrar el número."}
        </p>
      )}
    </div>
  );
}
