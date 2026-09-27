"use client";

import { ShieldCheck } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { HelpLink } from "@/components/help-link";
import { SecretField } from "@/components/secret-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { startOutlookConnectAction } from "../actions";
import { FIELD_HELP, guideHref } from "../_lib/help";
import { MICROSOFT_PERMISSIONS } from "../_lib/permissions";
import { WaField } from "../../whatsapp/_components/wa-field";
import { WhereToFind } from "../../whatsapp/_components/where-to-find";
import { BusyButton, WizardFooter } from "../../whatsapp/_components/wizard-footer";
import { CopyWithHelp } from "./copy-with-help";
import { BACK_HREF, FormFailure, useStartConnect, type ProviderFormProps } from "./form-kit";
import { PermissionList } from "./permission-list";

type OutlookFormProps = ProviderFormProps & {
  redirectUri: string;
  /** Saved values when the mailbox is resumed or reconnected; the secret only masked. */
  saved: { clientId: string | null; tenant: string | null; secretExpiresOn: string | null; maskedSecret: string | null } | null;
  /** Earliest and latest expiry the date input offers (today and 24 months ahead, [COR-07]). */
  secretExpiry: { min: string; max: string };
  /** Microsoft answered that an administrator must consent ([COR-07], AADSTS65001). */
  needsAdminConsent: boolean;
};

const DEFAULT_TENANT = "common";

/**
 * Outlook / Microsoft 365 ([COR-07], [COR-24]): the business's own Entra app. Client ID, Client Secret and its expiry
 * (24 months at most; warned 30 days before), Tenant ID (`common` or the business's), the redirect URI and «Conectar con
 * Microsoft», which asks for Mail.ReadWrite, Mail.Send, offline_access and User.Read. When Microsoft asks for an
 * administrator's consent, the link to give it.
 */
export function OutlookForm({ channelId, name, onChannel, onNameErrors, redirectUri, saved, secretExpiry, needsAdminConsent }: OutlookFormProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [clientId, setClientId] = useState(saved?.clientId ?? "");
  const [tenant, setTenant] = useState(saved?.tenant ?? DEFAULT_TENANT);
  const [expiresOn, setExpiresOn] = useState(saved?.secretExpiresOn ?? "");
  const { pending, start, errorsOf, failure, hasFieldErrors } = useStartConnect({ onChannel, onNameErrors });

  function run(adminConsent: boolean) {
    if (pending || !formRef.current) return;
    // Only present while the secret is being typed: otherwise the saved one is kept for the same app and tenant.
    const secret = new FormData(formRef.current).get("clientSecret");
    start(() =>
      startOutlookConnectAction({
        ...(channelId ? { channelId } : { name }),
        clientId,
        clientSecret: typeof secret === "string" ? secret : "",
        clientSecretExpiresAt: expiresOn,
        tenant,
        ...(adminConsent ? { adminConsent: true } : {}),
      }),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(false);
  }

  const expiryErrors = errorsOf("clientSecretExpiresAt");

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="grid gap-6">
      <FormFailure message={failure} hasFieldErrors={hasFieldErrors} />

      <section aria-labelledby={`${id}-before`} className="grid gap-3 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 id={`${id}-before`} className="font-semibold">
            Antes de empezar, en Microsoft Entra
          </h3>
          <HelpLink href={guideHref("outlook")}>Ver la guía de Outlook</HelpLink>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Registra una app del negocio en Microsoft Entra, en «App registrations», con la dirección de redirección de abajo como plataforma «Web».{" "}
            <HelpLink href={guideHref("entra")}>Cómo registrarla</HelpLink>
          </li>
          <li>
            Dale los permisos delegados de Microsoft Graph de la lista de abajo. <HelpLink href={guideHref("permisos")}>Cómo añadirlos</HelpLink>
          </li>
          <li>
            Crea un Client Secret y apunta cuándo caduca. <HelpLink href={guideHref("secreto")}>Cómo crearlo</HelpLink>
          </li>
        </ol>
      </section>

      <FieldGroup>
        <CopyWithHelp
          label="URI de redirección (Web)"
          value={redirectUri}
          help={FIELD_HELP.microsoftRedirectUri}
          description="Pégala en «Authentication» de tu app de Entra, en la plataforma «Web», tal cual."
        />
        <WaField
          id={`${id}-client-id`}
          label="Client ID (Application ID)"
          value={clientId}
          onChange={(value) => setClientId(value.trim())}
          help={FIELD_HELP.microsoftClientId}
          placeholder="00000000-0000-0000-0000-000000000000"
          maxLength={36}
          errors={errorsOf("clientId")}
        />
        <SecretField
          name="clientSecret"
          label="Client Secret"
          masked={saved?.maskedSecret ?? null}
          help={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              El «Value» del secreto, no su «Secret ID». Se guarda cifrado.
              <WhereToFind help={FIELD_HELP.microsoftClientSecret} />
            </span>
          }
          error={errorsOf("clientSecret")?.[0]}
        />
        <Field data-invalid={expiryErrors ? true : undefined}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <FieldLabel htmlFor={`${id}-expiry`}>Caducidad del Client Secret</FieldLabel>
            <WhereToFind help={FIELD_HELP.microsoftSecretExpiry} />
          </div>
          <Input
            id={`${id}-expiry`}
            type="date"
            value={expiresOn}
            min={secretExpiry.min}
            max={secretExpiry.max}
            onChange={(event) => setExpiresOn(event.target.value)}
            className="w-full sm:w-52"
            aria-invalid={expiryErrors ? true : undefined}
            aria-describedby={`${id}-expiry-help`}
          />
          <FieldDescription id={`${id}-expiry-help`}>
            Microsoft lo hace durar 24 meses como máximo. Te avisaremos 30 días antes; cuando caduque, el buzón pedirá uno nuevo.
          </FieldDescription>
          <FieldError errors={expiryErrors?.map((message) => ({ message }))} />
        </Field>
        <WaField
          id={`${id}-tenant`}
          label="Tenant ID"
          value={tenant}
          onChange={(value) => setTenant(value.trim())}
          help={FIELD_HELP.microsoftTenant}
          placeholder={DEFAULT_TENANT}
          maxLength={255}
          description="«common» si la app admite cuentas personales (Outlook.com, Hotmail) o de cualquier organización; con Microsoft 365, el Tenant ID del negocio."
          errors={errorsOf("tenant")}
        />
      </FieldGroup>

      <section aria-labelledby={`${id}-scopes`} className="grid gap-2">
        <h3 id={`${id}-scopes`} className="text-sm font-medium">
          Permisos que pedirá Microsoft
        </h3>
        <PermissionList items={MICROSOFT_PERMISSIONS} />
      </section>

      {needsAdminConsent ? (
        <Alert className="border-info/30 bg-info-soft text-info">
          <ShieldCheck aria-hidden />
          <AlertTitle>Consentimiento del administrador</AlertTitle>
          <AlertDescription className="grid gap-2 text-info">
            <p>
              Tu organización pide que una persona administradora de Microsoft 365 apruebe la app. Ábrelo tú si lo eres, o pídeselo a quien lo sea; después,
              pulsa «Conectar con Microsoft».
            </p>
            <p>Hace falta el Tenant ID del negocio, no «common».</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(true)}>
                Dar el consentimiento del administrador
              </Button>
              <HelpLink href={guideHref("consentimiento-admin")}>Qué es y quién lo da</HelpLink>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <WizardFooter back={{ href: BACK_HREF }}>
        <BusyButton type="submit" pending={pending} pendingLabel="Abriendo Microsoft…">
          Conectar con Microsoft
        </BusyButton>
      </WizardFooter>
    </form>
  );
}
