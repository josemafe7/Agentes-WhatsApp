"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { StatusLight } from "@/components/status-light";
import { FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { RegisterResult } from "@/data/whatsapp-activation";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/format";
import { changePinAction, registerNumberAction, requestCodeAction, verifyCodeAction } from "../actions";
import { FIELD_HELP } from "../_lib/help";
import { WaField } from "./wa-field";
import { BusyButton } from "./wizard-footer";

const CODE_METHODS = [
  { value: "SMS", label: "SMS" },
  { value: "VOICE", label: "Llamada" },
] as const;
type CodeMethod = (typeof CODE_METHODS)[number]["value"];

type VerifyNumberProps = { channelId: string; onVerified: () => void };

/** The ownership code by SMS or call, in Spanish, only when the number is not verified yet ([WA-19]). */
export function VerifyNumber({ channelId, onVerified }: VerifyNumberProps) {
  const id = useId();
  const [method, setMethod] = useState<CodeMethod>("SMS");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<ActionResult | undefined>(undefined);
  const [codeErrors, setCodeErrors] = useState<string[] | undefined>(undefined);
  const [requesting, startRequest] = useTransition();
  const [verifying, startVerify] = useTransition();

  function requestCode() {
    startRequest(async () => {
      const result = await requestCodeAction(channelId, { method });
      if (!result.ok) return setMessage(result);
      if (result.data?.status === "already_verified") return onVerified();
      if (result.data?.status === "error") return setMessage({ ok: false, error: result.data.error });
      setSent(true);
      setMessage({ ok: true, message: method === "SMS" ? "Te hemos enviado el código por SMS." : "Vas a recibir una llamada con el código." });
    });
  }

  function verify() {
    startVerify(async () => {
      const result = await verifyCodeAction(channelId, { code });
      if (!result.ok) {
        setCodeErrors(result.fieldErrors?.code);
        return setMessage(result);
      }
      onVerified();
    });
  }

  return (
    <div className="grid gap-4">
      <StatusLight status="warn" label="Número sin verificar" detail="Meta tiene que comprobar que el número es tuyo con un código que llega por SMS o por llamada." />
      <FieldSet>
        <FieldLegend variant="label">¿Cómo quieres recibir el código?</FieldLegend>
        <RadioGroup
          value={method}
          onValueChange={(value) => {
            const option = CODE_METHODS.find((candidate) => candidate.value === value);
            if (option) setMethod(option.value);
          }}
          className="flex flex-wrap gap-4"
        >
          {CODE_METHODS.map((option) => (
            <div key={option.value} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${option.value}`} value={option.value} />
              <FieldLabel htmlFor={`${id}-${option.value}`}>{option.label}</FieldLabel>
            </div>
          ))}
        </RadioGroup>
        <FieldDescription>El mensaje llega en español al número que estás conectando.</FieldDescription>
      </FieldSet>
      <div>
        <BusyButton variant={sent ? "outline" : "default"} pending={requesting} pendingLabel="Pidiendo el código…" onClick={requestCode}>
          {sent ? "Pedir otro código" : "Pedir el código"}
        </BusyButton>
      </div>
      {sent ? (
        <div className="grid gap-3 sm:max-w-xs">
          <WaField id={`${id}-code`} label="Código recibido" value={code} onChange={(value) => setCode(value.trim())} inputMode="numeric" maxLength={10} errors={codeErrors} />
          <div>
            <BusyButton pending={verifying} pendingLabel="Verificando…" disabled={code.length < 4} onClick={verify}>
              Verificar el número
            </BusyButton>
          </div>
        </div>
      ) : null}
      <FormMessage result={message} />
    </div>
  );
}

type RegisterNumberProps = {
  channelId: string;
  /** A PIN is stored (typed in «Avanzado» or kept from a previous registration). */
  hasPin: boolean;
  /** Attempts left of Meta's 10 per 72 h, and from when one frees up if none. */
  initialLeft: number;
  initialNextFreeAt: string | null;
  /** The number must be verified first ([WA-19]). */
  blocked: boolean;
  /** «La app lo registra» ([WA-17]): the first attempt starts by itself; every later one needs the person. */
  autoStart: boolean;
  timezone: string;
  onRegistered: () => void;
  onNeedsVerification: () => void;
};

type Outcome = { kind: "idle" } | { kind: "error"; error: string } | { kind: "limit"; error: string; nextFreeAt: string | null } | { kind: "wrong_pin"; error: string };

/**
 * Registration with a 6-digit PIN ([WA-17], [WA-18]): the one it had or a new one that becomes its PIN. Every attempt
 * after the first asks for confirmation and says how many of Meta's 10 per 72 h are left; a wrong PIN (133005) offers
 * «Cambiar el PIN».
 */
export function RegisterNumber({ channelId, hasPin, initialLeft, initialNextFreeAt, blocked, autoStart, timezone, onRegistered, onNeedsVerification }: RegisterNumberProps) {
  const id = useId();
  const [left, setLeft] = useState(initialLeft);
  const [outcome, setOutcome] = useState<Outcome>(initialLeft === 0 ? { kind: "limit", error: "Se han agotado los intentos de registro (10 cada 72 horas).", nextFreeAt: initialNextFreeAt } : { kind: "idle" });
  const [confirmLeft, setConfirmLeft] = useState<number | null>(null);
  const [newPin, setNewPin] = useState("");
  const [pinResult, setPinResult] = useState<ActionResult | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  function apply(result: RegisterResult) {
    setLeft(result.left);
    switch (result.status) {
      case "registered":
        setOutcome({ kind: "idle" });
        return onRegistered();
      case "needs_confirmation":
        return setConfirmLeft(result.left);
      case "limit":
        return setOutcome({ kind: "limit", error: result.error, nextFreeAt: result.nextFreeAt ? new Date(result.nextFreeAt).toISOString() : null });
      case "wrong_pin":
        return setOutcome({ kind: "wrong_pin", error: result.error });
      case "needs_verification":
        setOutcome({ kind: "error", error: result.error });
        return onNeedsVerification();
      case "error":
        return setOutcome({ kind: "error", error: result.error });
    }
  }

  function register(confirmRetry: boolean) {
    // Any attempt (automatic or by hand) means the automatic first one is no longer due.
    started.current = true;
    startTransition(async () => {
      const result = await registerNumberAction(channelId, { confirmRetry });
      if (!result.ok) return setOutcome({ kind: "error", error: result.error });
      if (result.data) apply(result.data);
    });
  }

  useEffect(() => {
    // Once (Strict Mode mounts twice in development), and only while no attempt counts yet: the server asks for
    // confirmation before any other one ([WA-18]).
    if (started.current || !autoStart || blocked) return;
    register(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first attempt starts once, when the number is known to need it
  }, [autoStart, blocked]);

  function changePinAndRegister() {
    startTransition(async () => {
      const changed = await changePinAction(channelId, { pin: newPin });
      setPinResult(changed);
      if (!changed.ok) return;
      setNewPin("");
      const result = await registerNumberAction(channelId, { confirmRetry: false });
      if (!result.ok) return setOutcome({ kind: "error", error: result.error });
      if (result.data) apply(result.data);
    });
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {hasPin
          ? "Se registra con el PIN de verificación en dos pasos que guardaste."
          : "Si el número no tenía PIN de verificación en dos pasos, se crea uno de 6 cifras que pasa a ser su PIN y se guarda cifrado."}{" "}
        Meta permite 10 intentos de registro cada 72 horas: te quedan {left}.
      </p>
      {outcome.kind === "error" ? <StatusLight status="error" label="No se ha registrado" detail={outcome.error} /> : null}
      {outcome.kind === "limit" ? (
        <StatusLight
          status="error"
          label="Sin intentos de registro"
          detail={`${outcome.error}${outcome.nextFreeAt ? ` Podrás volver a probar a partir del ${formatDateTime(outcome.nextFreeAt, timezone)}.` : ""}`}
        />
      ) : null}
      {outcome.kind === "wrong_pin" ? (
        <div className="grid gap-3 rounded-lg border p-4">
          <StatusLight status="error" label="El PIN no es correcto" detail={`${outcome.error} Puedes cambiarlo por uno nuevo sin saber el anterior y registrar con él.`} />
          <div className="grid gap-3 sm:max-w-xs">
            <WaField
              id={`${id}-new-pin`}
              label="PIN nuevo"
              value={newPin}
              onChange={(value) => setNewPin(value.trim())}
              help={FIELD_HELP.twoStepPin}
              secret
              inputMode="numeric"
              maxLength={6}
              description="6 cifras. Se guarda cifrado."
              errors={pinResult && !pinResult.ok ? (pinResult.fieldErrors?.pin ?? [pinResult.error]) : undefined}
            />
            <div>
              <BusyButton pending={pending} pendingLabel="Cambiando…" disabled={!/^\d{6}$/.test(newPin)} onClick={changePinAndRegister}>
                Cambiar el PIN y registrar
              </BusyButton>
            </div>
          </div>
        </div>
      ) : null}
      <div>
        <BusyButton
          variant={outcome.kind === "wrong_pin" ? "outline" : "default"}
          pending={pending}
          pendingLabel="Registrando…"
          disabled={blocked || left === 0}
          onClick={() => register(false)}
        >
          {outcome.kind === "idle" ? "Registrar el número" : "Registrar otra vez"}
        </BusyButton>
      </div>
      <ConfirmDialog
        open={confirmLeft !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmLeft(null);
        }}
        title="¿Intentar registrar el número otra vez?"
        description={`Meta permite 10 intentos de registro cada 72 horas y cuenta también los fallidos. Te quedan ${confirmLeft ?? left}. Si se agotan, habrá que esperar.`}
        confirmLabel="Intentar otra vez"
        onConfirm={() => register(true)}
      />
    </div>
  );
}
