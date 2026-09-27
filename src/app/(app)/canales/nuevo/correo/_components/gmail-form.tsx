"use client";

import { ShieldAlert } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { HelpLink } from "@/components/help-link";
import { SecretField } from "@/components/secret-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { startGmailConnectAction } from "../actions";
import { FIELD_HELP, guideHref } from "../_lib/help";
import { GOOGLE_PERMISSIONS } from "../_lib/permissions";
import { WaField } from "../../whatsapp/_components/wa-field";
import { WhereToFind } from "../../whatsapp/_components/where-to-find";
import { BusyButton, WizardFooter } from "../../whatsapp/_components/wizard-footer";
import { CopyWithHelp } from "./copy-with-help";
import { BACK_HREF, FormFailure, useStartConnect, type ProviderFormProps } from "./form-kit";
import { PermissionList } from "./permission-list";

type GmailFormProps = ProviderFormProps & {
  redirectUri: string;
  /** Saved Client ID and the secret masked, when the mailbox is resumed or reconnected. */
  clientId: string | null;
  maskedSecret: string | null;
};

/**
 * Gmail ([COR-02]–[COR-04], [COR-24]): the business's own Google Cloud project. The redirect URI to copy, Client ID,
 * Client Secret and «Conectar con Google»; how to set the app up (Internal with Workspace; External published «En
 * producción» with @gmail.com, never «Testing») and the link to use an app password with «Otro».
 */
export function GmailForm({ channelId, name, onChannel, onNameErrors, onSwitchProvider, redirectUri, clientId: savedClientId, maskedSecret }: GmailFormProps) {
  const id = useId();
  const [clientId, setClientId] = useState(savedClientId ?? "");
  const { pending, start, errorsOf, failure, hasFieldErrors } = useStartConnect({ onChannel, onNameErrors });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // Only present while the secret is being typed: otherwise the saved one is kept for the same Client ID.
    const secret = new FormData(event.currentTarget).get("clientSecret");
    start(() => startGmailConnectAction({ ...(channelId ? { channelId } : { name }), clientId, clientSecret: typeof secret === "string" ? secret : "" }));
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-6">
      <FormFailure message={failure} hasFieldErrors={hasFieldErrors} />

      <section aria-labelledby={`${id}-before`} className="grid gap-3 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 id={`${id}-before`} className="font-semibold">
            Antes de empezar, en Google Cloud
          </h3>
          <HelpLink href={guideHref("gmail")}>Ver la guía de Gmail</HelpLink>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Un proyecto de Google Cloud del negocio con la API de Gmail activada. <HelpLink href={guideHref("google-cloud")}>Cómo crearlo</HelpLink>
          </li>
          <li>
            La pantalla de consentimiento: tipo <strong>«Interno»</strong> si el negocio tiene Google Workspace (no hace falta verificar nada); con una cuenta
            @gmail.com, tipo <strong>«Externo»</strong> y publicada. <HelpLink href={guideHref("pantalla-de-consentimiento")}>Cómo configurarla</HelpLink>
          </li>
          <li>
            Un cliente OAuth de tipo «Aplicación web» con la dirección de redirección de abajo. <HelpLink href={guideHref("credenciales")}>Cómo crearlo</HelpLink>
          </li>
        </ol>
      </section>

      <Alert className="border-warning/30 bg-warning-soft text-warning">
        <ShieldAlert aria-hidden />
        <AlertTitle>Con «Externo», publícala «En producción», nunca en «Testing»</AlertTitle>
        <AlertDescription className="text-warning">
          <p>En «Testing», Google corta el acceso a los 7 días y el buzón deja de funcionar.</p>
          <p>
            Publicada sin verificar, funciona con un máximo de 100 usuarios, de sobra para los buzones del negocio. Al conectar, Google avisará de que no ha
            verificado la app: pulsa «Configuración avanzada» y después «Ir a…» para seguir.
          </p>
          <HelpLink href={guideHref("produccion")}>Cómo publicarla</HelpLink>
        </AlertDescription>
      </Alert>

      <FieldGroup>
        <CopyWithHelp
          label="URI de redirección autorizada"
          value={redirectUri}
          help={FIELD_HELP.googleRedirectUri}
          description="Cópiala en el cliente OAuth de Google Cloud tal cual, sin cambiar nada."
        />
        <WaField
          id={`${id}-client-id`}
          label="Client ID"
          value={clientId}
          onChange={(value) => setClientId(value.trim())}
          help={FIELD_HELP.googleClientId}
          placeholder="123456789-abc.apps.googleusercontent.com"
          maxLength={300}
          description="Termina en .apps.googleusercontent.com."
          errors={errorsOf("clientId")}
        />
        <SecretField
          name="clientSecret"
          label="Client Secret"
          masked={maskedSecret}
          placeholder="GOCSPX-…"
          help={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              Se guarda cifrado y no se vuelve a mostrar.
              <WhereToFind help={FIELD_HELP.googleClientSecret} />
            </span>
          }
          error={errorsOf("clientSecret")?.[0]}
        />
      </FieldGroup>

      <section aria-labelledby={`${id}-scopes`} className="grid gap-2">
        <h3 id={`${id}-scopes`} className="text-sm font-medium">
          Permisos que pedirá Google
        </h3>
        <PermissionList items={GOOGLE_PERMISSIONS} />
        <p className="text-sm text-muted-foreground">En la pantalla de Google, marca todas las casillas: si falta alguna, el buzón no se conecta y te diremos cuál.</p>
      </section>

      <p className="text-sm">
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => onSwitchProvider("email_imap")}>
          ¿Prefieres contraseña de aplicación? Usa Otro
        </Button>
      </p>

      <WizardFooter back={{ href: BACK_HREF }}>
        <BusyButton type="submit" pending={pending} pendingLabel="Abriendo Google…">
          Conectar con Google
        </BusyButton>
      </WizardFooter>
    </form>
  );
}
