"use client";

import { LoaderCircle, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { SecretField } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormAction } from "@/hooks/use-form-action";
import type { ActionResult } from "@/lib/action-result";
import { removeSmtpAction, saveSmtpAction, sendTestEmailAction } from "../actions";
import { DEFAULT_PORTS, SMTP_SECURITY, type SmtpSecurity } from "../_lib/form";
import type { MailSettingsView } from "../_lib/view";

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
  starttls: "STARTTLS (normalmente puerto 587)",
  tls: "TLS desde el inicio (normalmente puerto 465)",
  none: "Sin cifrar (solo servidores sin contraseña)",
};

/** SMTP of the system mail and «Enviar correo de prueba» ([AJU-06]). Re-created after saving to show the mask again. */
export function SmtpForm({ view, myEmail }: { view: MailSettingsView; myEmail: string }) {
  const [version, setVersion] = useState(0);
  return <Form key={version} view={view} myEmail={myEmail} onSaved={() => setVersion((v) => v + 1)} />;
}

function Form({ view, myEmail, onSaved }: { view: MailSettingsView; myEmail: string; onSaved: () => void }) {
  const smtp = view.smtp;
  const [security, setSecurity] = useState<SmtpSecurity>(smtp?.security ?? "starttls");
  const [port, setPort] = useState(String(smtp?.port ?? DEFAULT_PORTS.starttls));
  const [testing, startTest] = useTransition();
  const [state, onSubmit, pending] = useFormAction<ActionResult | null>(async (prev, formData) => {
    const result = await saveSmtpAction(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Guardado.");
      onSaved();
    }
    return result;
  }, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  function changeSecurity(value: string) {
    const next = value as SmtpSecurity;
    // Suggest the usual port if the current one is the usual one of the previous choice.
    if (port === String(DEFAULT_PORTS[security])) setPort(String(DEFAULT_PORTS[next]));
    setSecurity(next);
  }

  function sendTest() {
    startTest(async () => {
      const result = await sendTestEmailAction();
      if (result.ok) toast.success(result.message ?? "Correo de prueba enviado.");
      else toast.error(result.error);
    });
  }

  async function remove() {
    const result = await removeSmtpAction();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Configuración quitada.");
    onSaved();
  }

  const invalid = (name: string) => (errors?.[name] ? true : undefined);
  return (
    <div className="grid max-w-2xl gap-6">
      <form onSubmit={onSubmit} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Servidor de correo (SMTP)</CardTitle>
            <CardDescription>Lo da tu proveedor de correo o de hosting. Usa una cuenta propia del negocio, no la de una persona.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={invalid("host")}>
                <FieldLabel htmlFor="smtp-host">Servidor</FieldLabel>
                <Input id="smtp-host" name="host" defaultValue={smtp?.host ?? ""} placeholder="smtp.tudominio.com" autoComplete="off" aria-invalid={invalid("host")} />
                <FieldError>{errors?.host?.[0]}</FieldError>
              </Field>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field data-invalid={invalid("security")}>
                  <FieldLabel htmlFor="smtp-security">Seguridad</FieldLabel>
                  <Select name="security" value={security} onValueChange={changeSecurity}>
                    <SelectTrigger id="smtp-security" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SMTP_SECURITY.map((option) => (
                        <SelectItem key={option} value={option}>
                          {SECURITY_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError>{errors?.security?.[0]}</FieldError>
                </Field>
                <Field data-invalid={invalid("port")}>
                  <FieldLabel htmlFor="smtp-port">Puerto</FieldLabel>
                  <Input
                    id="smtp-port"
                    name="port"
                    inputMode="numeric"
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                    className="tabular-nums"
                    aria-invalid={invalid("port")}
                  />
                  <FieldError>{errors?.port?.[0]}</FieldError>
                </Field>
              </div>
              <Field data-invalid={invalid("user")}>
                <FieldLabel htmlFor="smtp-user">Usuario (opcional)</FieldLabel>
                <Input id="smtp-user" name="user" defaultValue={smtp?.user ?? ""} autoComplete="off" aria-invalid={invalid("user")} />
                <FieldDescription>Casi siempre, la dirección de correo completa.</FieldDescription>
                <FieldError>{errors?.user?.[0]}</FieldError>
              </Field>
              <SecretField
                name="smtpPassword"
                label="Contraseña"
                masked={view.password.readable ? view.password.masked : null}
                error={errors?.smtpPassword?.[0]}
                help={
                  view.password.configured && !view.password.readable
                    ? "La contraseña guardada no se puede leer (ha cambiado la clave de cifrado). Vuelve a escribirla."
                    : "Si tu proveedor usa verificación en dos pasos, crea una contraseña de aplicación para esto."
                }
              />
              <Field data-invalid={invalid("fromEmail")}>
                <FieldLabel htmlFor="smtp-from-email">Dirección del remitente</FieldLabel>
                <Input
                  id="smtp-from-email"
                  name="fromEmail"
                  type="email"
                  defaultValue={smtp?.fromEmail ?? ""}
                  placeholder="avisos@tudominio.com"
                  aria-invalid={invalid("fromEmail")}
                />
                <FieldError>{errors?.fromEmail?.[0]}</FieldError>
              </Field>
              <Field data-invalid={invalid("fromName")}>
                <FieldLabel htmlFor="smtp-from-name">Nombre del remitente (opcional)</FieldLabel>
                <Input id="smtp-from-name" name="fromName" defaultValue={smtp?.fromName ?? ""} aria-invalid={invalid("fromName")} />
                <FieldDescription>Lo que verá quien reciba el correo, por ejemplo el nombre del negocio.</FieldDescription>
                <FieldError>{errors?.fromName?.[0]}</FieldError>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            {pending ? "Guardando…" : "Guardar cambios"}
          </Button>
          <FormMessage result={state && !state.ok ? state : undefined} />
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Probar</CardTitle>
          <CardDescription>
            Envía un correo de prueba a tu email ({myEmail}) con la configuración guardada. Guarda antes los cambios.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={sendTest} disabled={testing}>
            {testing ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden />}
            {testing ? "Enviando…" : "Enviar correo de prueba"}
          </Button>
          {smtp ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost">
                  Quitar configuración
                </Button>
              }
              title="¿Quitar el correo del sistema?"
              description="Se borran el servidor y la contraseña. Las invitaciones y los enlaces de recuperación dejarán de salir por email."
              confirmLabel="Quitar configuración"
              destructive
              onConfirm={remove}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
