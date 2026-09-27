"use client";

import { ChevronDown, Info, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { HelpLink } from "@/components/help-link";
import { SecretField } from "@/components/secret-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MailTestResult } from "@/server/channels/email/imap/connect";
import type { MailPreset, MailSuggestion } from "@/server/channels/email/imap/presets";
import { connectImapAction, suggestEmailServersAction, testImapServersAction } from "../actions";
import { FIELD_HELP, guideHref } from "../_lib/help";
import type { MailSecurityOption, WizardMailbox } from "../_lib/mailbox";
import { emailWizardHref } from "../_lib/steps";
import { WaField } from "../../whatsapp/_components/wa-field";
import { WhereToFind } from "../../whatsapp/_components/where-to-find";
import { BusyButton, WizardFooter } from "../../whatsapp/_components/wizard-footer";
import { BACK_HREF, FormFailure, type ProviderFormProps } from "./form-kit";
import { MailTestSummary } from "./mail-test-summary";

type Server = { host: string; port: string; security: MailSecurityOption };
type ServerKey = "imap" | "smtp";

type ImapFormProps = ProviderFormProps & { saved: WizardMailbox["imap"]; savedEmail: string | null };

const SECURITY_OPTIONS: { value: MailSecurityOption; label: string }[] = [
  { value: "tls", label: "SSL/TLS" },
  { value: "starttls", label: "STARTTLS" },
];
const EMPTY_IMAP: Server = { host: "", port: "993", security: "tls" };
const EMPTY_SMTP: Server = { host: "", port: "465", security: "tls" };

function serverOf(host: string | null, port: number | null, security: MailSecurityOption | null, fallback: Server): Server {
  return host ? { host, port: String(port ?? fallback.port), security: security ?? fallback.security } : fallback;
}

const fromPreset = (server: MailPreset["imap"]): Server => ({ host: server.host, port: String(server.port), security: server.security });

/**
 * Otro (IMAP/SMTP) ([COR-09]–[COR-11]): address, user, password (or app password) and the IMAP and SMTP servers with port
 * and security, filled in by the address's domain and editable. A Microsoft address is sent to the Outlook option.
 * «Probar conexión» checks both and says what fails; «Conectar» stores the mailbox only when both work.
 */
export function ImapForm({ channelId, name, onChannel, onNameErrors, onSwitchProvider, saved, savedEmail }: ImapFormProps) {
  const id = useId();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState(savedEmail ?? "");
  const [username, setUsername] = useState(saved?.username ?? "");
  const [smtpUsername, setSmtpUsername] = useState(saved?.smtpUsername ?? "");
  const [servers, setServers] = useState<Record<ServerKey, Server>>({
    imap: serverOf(saved?.imapHost ?? null, saved?.imapPort ?? null, saved?.imapSecurity ?? null, EMPTY_IMAP),
    smtp: serverOf(saved?.smtpHost ?? null, saved?.smtpPort ?? null, saved?.smtpSecurity ?? null, EMPTY_SMTP),
  });
  /** Servers typed by hand are never overwritten by a suggestion. */
  const [serversEdited, setServersEdited] = useState(Boolean(saved?.imapHost));
  const [suggestion, setSuggestion] = useState<MailSuggestion | null>(null);
  const [suggestedFor, setSuggestedFor] = useState(savedEmail ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(saved?.smtpUsername));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [test, setTest] = useState<MailTestResult | null>(null);
  const [testing, startTesting] = useTransition();
  const [connecting, startConnecting] = useTransition();
  const pending = testing || connecting;

  function applyPreset(preset: MailPreset) {
    setServers({ imap: fromPreset(preset.imap), smtp: fromPreset(preset.smtp) });
    setServersEdited(false);
    setTest(null);
  }

  function suggest() {
    const address = email.trim();
    if (!address || address === suggestedFor) return;
    setSuggestedFor(address);
    suggestEmailServersAction(address)
      .then((result) => {
        const next = result.ok ? (result.data ?? null) : null;
        setSuggestion(next);
        if (next && next.kind !== "microsoft" && !serversEdited) applyPreset(next.preset);
      })
      // Suggestions only save typing: without them the person writes the servers of their provider's help.
      .catch(() => setSuggestion(null));
  }

  function setServer(key: ServerKey, patch: Partial<Server>) {
    setServers((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    setServersEdited(true);
    setTest(null);
    const keys = Object.keys(patch).map((field) => `${key}.${field}`);
    setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => !keys.includes(field))));
  }

  function payload() {
    const form = formRef.current ? new FormData(formRef.current) : null;
    const text = (key: string) => {
      const value = form?.get(key);
      return typeof value === "string" ? value : "";
    };
    return {
      ...(channelId ? { channelId } : {}),
      email,
      username,
      smtpUsername,
      // Only present while being typed: otherwise the saved password is kept for the same servers and users.
      password: text("password"),
      smtpPassword: text("smtpPassword"),
      imap: servers.imap,
      smtp: servers.smtp,
    };
  }

  function showInvalid(result: { error: string; fieldErrors?: Record<string, string[]> }) {
    const errors = result.fieldErrors ?? {};
    if (errors.smtpUsername || errors.smtpPassword) setAdvancedOpen(true);
    setFieldErrors(errors);
    onNameErrors(errors.name);
    setFailure(result.fieldErrors ? null : result.error);
  }

  function runTest() {
    if (pending) return;
    startTesting(async () => {
      const result = await testImapServersAction(payload());
      if (!result.ok) return showInvalid(result);
      setFieldErrors({});
      setFailure(null);
      setTest(result.data ?? null);
    });
  }

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startConnecting(async () => {
      const result = await connectImapAction({ ...payload(), ...(channelId ? {} : { name }) });
      if (!result.ok) return showInvalid(result);
      const outcome = result.data;
      if (!outcome) return;
      setFieldErrors({});
      if (!outcome.ok) {
        setTest(outcome.result);
        setFailure(outcome.result ? null : outcome.error);
        return;
      }
      onChannel(outcome.channelId);
      router.push(emailWizardHref(outcome.channelId, "respuestas"));
    });
  }

  const errorsOf = (key: string) => (fieldErrors[key]?.length ? fieldErrors[key] : undefined);
  const microsoft = suggestion?.kind === "microsoft" || (test !== null && !test.ok && test.microsoft === true);
  const preset = suggestion && suggestion.kind !== "microsoft" ? suggestion.preset : null;

  function serverFields(key: ServerKey, legend: string, description: string) {
    const server = servers[key];
    return (
      <FieldSet className="grid gap-4 rounded-xl border p-4">
        <FieldLegend variant="label">{legend}</FieldLegend>
        <FieldDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {description}
          <WhereToFind help={FIELD_HELP.mailServers} />
        </FieldDescription>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem_10rem]">
          <WaField
            id={`${id}-${key}-host`}
            label="Servidor"
            value={server.host}
            onChange={(value) => setServer(key, { host: value.trim() })}
            placeholder={key === "imap" ? "imap.tudominio.es" : "smtp.tudominio.es"}
            maxLength={253}
            errors={errorsOf(`${key}.host`)}
          />
          <WaField
            id={`${id}-${key}-port`}
            label="Puerto"
            value={server.port}
            onChange={(value) => setServer(key, { port: value.replace(/\D/g, "") })}
            inputMode="numeric"
            maxLength={5}
            errors={errorsOf(`${key}.port`)}
          />
          <Field data-invalid={errorsOf(`${key}.security`) ? true : undefined}>
            <FieldLabel htmlFor={`${id}-${key}-security`}>Seguridad</FieldLabel>
            <Select value={server.security} onValueChange={(value) => setServer(key, { security: value === "starttls" ? "starttls" : "tls" })}>
              <SelectTrigger id={`${id}-${key}-security`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECURITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errorsOf(`${key}.security`) ? <p className="text-sm text-destructive-text">{errorsOf(`${key}.security`)?.[0]}</p> : null}
          </Field>
        </div>
      </FieldSet>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={connect} className="grid gap-6">
      <FormFailure message={failure} hasFieldErrors={Object.keys(fieldErrors).length > 0} />

      {/* The servers are suggested when the address is complete: on leaving the field (focusout bubbles in React). */}
      <div onBlur={suggest}>
        <WaField
          id={`${id}-email`}
          label="Dirección de correo"
          value={email}
          onChange={(value) => {
            setEmail(value.trim());
            setTest(null);
          }}
          placeholder="hola@tunegocio.es"
          maxLength={254}
          mono={false}
          description={
            <>
              La del buzón que atenderá la IA. Al salir del campo rellenamos los servidores. <HelpLink href={guideHref("imap")}>Servidores de los proveedores más usados</HelpLink>
            </>
          }
          errors={errorsOf("email")}
        />
      </div>

      {microsoft ? (
        <Alert className="border-warning/30 bg-warning-soft text-warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Este correo se conecta con «Outlook / Microsoft 365»</AlertTitle>
          <AlertDescription className="grid gap-2 text-warning">
            <p>Microsoft ya no admite IMAP con contraseña y desactiva por defecto el envío SMTP con contraseña a finales de 2026.</p>
            <div>
              <Button type="button" variant="outline" onClick={() => onSwitchProvider("email_outlook")}>
                Usar Outlook / Microsoft 365
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {preset && !microsoft ? (
        <Alert className="border-info/30 bg-info-soft text-info">
          <Info aria-hidden />
          <AlertTitle>Servidores de {preset.name}</AlertTitle>
          <AlertDescription className="grid gap-2 text-info">
            {preset.note ? <p>{preset.note}</p> : null}
            {suggestion?.kind === "own_domain" ? (
              <Field>
                <FieldLabel htmlFor={`${id}-hosting`}>¿Tu correo está en otro proveedor?</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    const chosen = suggestion.hosting.find((option) => option.id === value);
                    if (chosen) applyPreset(chosen);
                  }}
                >
                  <SelectTrigger id={`${id}-hosting`} className="w-full bg-background text-foreground sm:w-72">
                    <SelectValue placeholder="Elige tu proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {suggestion.hosting.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            {serversEdited ? (
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(preset)}>
                  Usar los servidores sugeridos
                </Button>
              </div>
            ) : null}
            {preset.id === "gmail" ? (
              <div>
                <Button type="button" variant="link" className="h-auto p-0 text-info" onClick={() => onSwitchProvider("email_gmail")}>
                  Conectar con «Gmail» en lugar de contraseña
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <WaField
          id={`${id}-username`}
          label="Usuario (opcional)"
          value={username}
          onChange={(value) => setUsername(value.trim())}
          placeholder={email || "hola@tunegocio.es"}
          maxLength={320}
          description="Déjalo vacío si es la propia dirección de correo."
          errors={errorsOf("username")}
        />
        <SecretField
          name="password"
          label="Contraseña"
          masked={saved?.maskedPassword ?? null}
          help={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              La del buzón o una contraseña de aplicación. Se guarda cifrada.
              <WhereToFind help={FIELD_HELP.mailPassword} />
            </span>
          }
          error={errorsOf("password")?.[0]}
        />
      </FieldGroup>

      {serverFields("imap", "Entrada (IMAP)", "Por aquí la app lee el correo que llega.")}
      {serverFields("smtp", "Envío (SMTP)", "Por aquí salen las respuestas. El puerto 25 no se admite: usa 465 o 587.")}

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="grid gap-4 rounded-xl border p-4">
        <CollapsibleTrigger className="flex items-center justify-between gap-2 rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Usuario o contraseña distintos para el envío (SMTP)
          <ChevronDown aria-hidden className={advancedOpen ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-6">
          <WaField
            id={`${id}-smtp-username`}
            label="Usuario SMTP (opcional)"
            value={smtpUsername}
            onChange={(value) => setSmtpUsername(value.trim())}
            maxLength={320}
            description="Solo si tu proveedor usa otro usuario para enviar (por ejemplo, iCloud: la dirección completa)."
            errors={errorsOf("smtpUsername")}
          />
          <SecretField name="smtpPassword" label="Contraseña SMTP (opcional)" help="Solo si es distinta de la de entrada." error={errorsOf("smtpPassword")?.[0]} />
        </CollapsibleContent>
      </Collapsible>

      {test ? <MailTestSummary result={test} /> : null}

      <WizardFooter back={{ href: BACK_HREF }}>
        <BusyButton variant="outline" pending={testing} pendingLabel="Probando…" disabled={connecting} onClick={runTest}>
          Probar conexión
        </BusyButton>
        <BusyButton type="submit" pending={connecting} pendingLabel="Conectando…" disabled={testing}>
          Conectar
        </BusyButton>
      </WizardFooter>
    </form>
  );
}
