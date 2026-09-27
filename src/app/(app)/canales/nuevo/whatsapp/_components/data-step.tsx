"use client";

import { ChevronDown, CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WhatsAppValidationView } from "@/data/whatsapp";
import { DEFAULT_GRAPH_API_VERSION, GRAPH_API_VERSIONS } from "@/lib/meta/versions";
import { connectWhatsAppAction, validateWhatsAppAction } from "../actions";
import { FIELD_HELP, wizardErrorAction } from "../_lib/help";
import { wizardHref } from "../_lib/steps";
import { ValidationSummary } from "./validation-summary";
import { WaField } from "./wa-field";
import { WhereToFind } from "./where-to-find";
import { BusyButton, WizardFooter } from "./wizard-footer";

type Values = {
  name: string;
  accessToken: string;
  appSecret: string;
  phoneNumberId: string;
  appId: string;
  wabaId: string;
  twoStepPin: string;
  graphApiVersion: string;
};

type Failure = { message: string; code: number | null; detail: string | null; field: string | null };
type FailedView = Extract<WhatsAppValidationView, { ok: false }>;

export type Reconnect = { channelId: string; name: string };

type DataStepProps = {
  isMetaTestNumber: boolean;
  /** Another number is connected: the App Secret of its app is reused if left empty ([WA-10]). */
  hasOtherNumbers: boolean;
  /** A disconnected number of this installation connected again (same channel, same history). */
  reconnect: Reconnect | null;
  onBack: () => void;
};

const NAME_MAX = 80;

/**
 * Paso 1 · Datos ([WA-04]–[WA-11]): name, permanent token, App Secret and Phone Number ID; in «Avanzado», the 6-digit PIN
 * and the Graph API version. «Validar con Meta» shows «Negocio · Número · Estado» or Meta's error in Spanish; only a
 * validated form can be connected, and the server validates it again before storing anything.
 */
export function DataStep({ isMetaTestNumber, hasOtherNumbers, reconnect, onBack }: DataStepProps) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    name: reconnect?.name ?? "WhatsApp",
    accessToken: "",
    appSecret: "",
    phoneNumberId: "",
    appId: "",
    wabaId: "",
    twoStepPin: "",
    graphApiVersion: DEFAULT_GRAPH_API_VERSION,
  });
  const [validated, setValidated] = useState<Extract<WhatsAppValidationView, { ok: true }> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [askAppId, setAskAppId] = useState(false);
  const [askWabaId, setAskWabaId] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [validating, startValidating] = useTransition();
  const [connecting, startConnecting] = useTransition();
  const pending = validating || connecting;

  function set(key: keyof Values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    // What Meta validated is no longer what is on screen: validate again before connecting.
    setValidated(null);
    setFieldErrors((current) => (current[key] ? { ...current, [key]: [] } : current));
  }

  function payload() {
    return { ...values, isMetaTestNumber, ...(reconnect ? { channelId: reconnect.channelId } : {}) };
  }

  function showFailure(view: FailedView) {
    if (view.needsAppId) setAskAppId(true);
    if (view.needsWabaId) setAskWabaId(true);
    if (view.field === "graphApiVersion") setAdvancedOpen(true);
    setValidated(null);
    setFieldErrors(view.field ? { [view.field]: [view.error] } : {});
    setFailure({ message: view.error, code: view.code, detail: view.metaDetail ?? null, field: view.field });
  }

  function showInvalid(result: { error: string; fieldErrors?: Record<string, string[]> }) {
    const errors = result.fieldErrors ?? {};
    if (errors.twoStepPin || errors.graphApiVersion) setAdvancedOpen(true);
    if (errors.appId) setAskAppId(true);
    if (errors.wabaId) setAskWabaId(true);
    setValidated(null);
    setFieldErrors(errors);
    setFailure({ message: result.error, code: null, detail: null, field: null });
  }

  function validate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    startValidating(async () => {
      const result = await validateWhatsAppAction(payload());
      if (!result.ok) return showInvalid(result);
      const view = result.data;
      if (!view) return;
      if (!view.ok) return showFailure(view);
      setFieldErrors({});
      setFailure(null);
      setValidated(view);
    });
  }

  function connect() {
    if (pending || !validated) return;
    startConnecting(async () => {
      const result = await connectWhatsAppAction(payload());
      if (!result.ok) return showInvalid(result);
      const outcome = result.data;
      if (!outcome) return;
      if (!outcome.channelId) {
        if (!outcome.validation.ok) showFailure(outcome.validation);
        return;
      }
      router.push(wizardHref(outcome.channelId, "webhook"));
    });
  }

  const errorsOf = (key: keyof Values) => (fieldErrors[key]?.length ? fieldErrors[key] : undefined);
  const action = wizardErrorAction(failure?.code);

  return (
    <form noValidate onSubmit={validate} className="grid max-w-2xl gap-6">
      {failure ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>{failure.field ? "Meta no ha aceptado los datos" : failure.message}</AlertTitle>
          <AlertDescription>
            {failure.field ? <p>{failure.message}</p> : null}
            {action && action !== failure.message ? <p>Qué hacer: {action}</p> : null}
            {failure.detail ? <p lang="en">Meta dice: {failure.detail}</p> : null}
            {failure.code !== null ? <p className="text-xs">Código de Meta: {failure.code}</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <WaField
          id={`${id}-name`}
          label="Nombre"
          value={values.name}
          onChange={(value) => set("name", value)}
          maxLength={NAME_MAX}
          mono={false}
          description="Para tu equipo: se ve en Canales y en la bandeja, no en WhatsApp."
          errors={errorsOf("name")}
        />
        <WaField
          id={`${id}-token`}
          label="Token permanente"
          value={values.accessToken}
          onChange={(value) => set("accessToken", value)}
          help={FIELD_HELP.accessToken}
          secret
          description="El token de un usuario del sistema, con caducidad «Nunca». Se guarda cifrado."
          errors={errorsOf("accessToken")}
        />
        <WaField
          id={`${id}-secret`}
          label={hasOtherNumbers ? "App Secret (opcional si ya conectaste otro número de la misma app)" : "App Secret"}
          value={values.appSecret}
          onChange={(value) => set("appSecret", value)}
          help={FIELD_HELP.appSecret}
          secret
          description={
            hasOtherNumbers
              ? "Si este número es de la misma app de Meta que otro que ya tienes conectado, déjalo vacío: se usa el que ya está guardado."
              : "Con él se comprueba que los avisos vienen de Meta. Se guarda cifrado."
          }
          errors={errorsOf("appSecret")}
        />
        <WaField
          id={`${id}-phone`}
          label="Phone Number ID"
          value={values.phoneNumberId}
          onChange={(value) => set("phoneNumberId", value.trim())}
          help={FIELD_HELP.phoneNumberId}
          inputMode="numeric"
          maxLength={32}
          description="Solo números. No es el número de teléfono."
          errors={errorsOf("phoneNumberId")}
        />
        {askAppId ? (
          <WaField
            id={`${id}-app`}
            label="App ID"
            value={values.appId}
            onChange={(value) => set("appId", value.trim())}
            help={FIELD_HELP.appId}
            inputMode="numeric"
            maxLength={32}
            description="Meta no ha dicho a qué app pertenece el número: escribe el identificador de tu app."
            errors={errorsOf("appId")}
          />
        ) : null}
        {askWabaId ? (
          <WaField
            id={`${id}-waba`}
            label="WABA ID"
            value={values.wabaId}
            onChange={(value) => set("wabaId", value.trim())}
            help={FIELD_HELP.wabaId}
            inputMode="numeric"
            maxLength={32}
            description="Meta no ha dicho de qué cuenta de WhatsApp Business es el número: escribe su identificador."
            errors={errorsOf("wabaId")}
          />
        ) : null}
      </FieldGroup>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="grid gap-4 rounded-xl border p-4">
        <CollapsibleTrigger className="flex items-center justify-between gap-2 rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Avanzado
          <ChevronDown aria-hidden className={advancedOpen ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-6">
          <WaField
            id={`${id}-pin`}
            label="PIN de verificación en dos pasos (opcional)"
            value={values.twoStepPin}
            onChange={(value) => set("twoStepPin", value.trim())}
            help={FIELD_HELP.twoStepPin}
            secret
            inputMode="numeric"
            maxLength={6}
            description="6 cifras, solo si el número ya tenía verificación en dos pasos. Se guarda cifrado."
            errors={errorsOf("twoStepPin")}
          />
          <Field data-invalid={errorsOf("graphApiVersion") ? true : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <FieldLabel htmlFor={`${id}-version`}>Versión de la API de Meta</FieldLabel>
              <WhereToFind help={FIELD_HELP.graphApiVersion} />
            </div>
            <Select value={values.graphApiVersion} onValueChange={(value) => set("graphApiVersion", value)}>
              <SelectTrigger id={`${id}-version`} className="w-full sm:w-60" aria-describedby={`${id}-version-help`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRAPH_API_VERSIONS.map((entry) => (
                  <SelectItem key={entry.version} value={entry.version}>
                    {entry.version}
                    {entry.version === DEFAULT_GRAPH_API_VERSION ? " (recomendada)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription id={`${id}-version-help`}>Todas las llamadas a Meta de este número usan esta versión.</FieldDescription>
            {errorsOf("graphApiVersion") ? <p className="text-sm text-destructive">{errorsOf("graphApiVersion")?.[0]}</p> : null}
          </Field>
        </CollapsibleContent>
      </Collapsible>

      {validated ? <ValidationSummary view={validated} isMetaTestNumber={isMetaTestNumber} /> : null}

      <WizardFooter back={{ onClick: onBack }}>
        {validated ? (
          <>
            <BusyButton type="submit" variant="outline" pending={validating} pendingLabel="Validando…" disabled={connecting}>
              Validar de nuevo
            </BusyButton>
            <BusyButton pending={connecting} pendingLabel="Conectando…" disabled={validating} onClick={connect}>
              Conectar este número
            </BusyButton>
          </>
        ) : (
          <BusyButton type="submit" pending={validating} pendingLabel="Validando con Meta…" disabled={connecting}>
            Validar con Meta
          </BusyButton>
        )}
      </WizardFooter>
    </form>
  );
}
