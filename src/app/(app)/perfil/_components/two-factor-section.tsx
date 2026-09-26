"use client";
// Two-step verification in Mi cuenta ([USU-11], [USU-12]): password → QR code and first code → backup codes
// (shown once), and turning it off with the password unless the business requires it for the role.
import { CircleCheck, CircleDashed, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { PasswordField, SubmitButton } from "@/app/(auth)/_components/form-fields";
import { TotpCodeField } from "@/app/(auth)/_components/totp-code-field";
import { useActionForm } from "@/app/(auth)/_components/use-action-form";
import { CopyButton } from "@/components/copy-button";
import { FormMessage } from "@/components/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
  startTwoFactorSetupAction,
  type TwoFactorSetup,
} from "../actions";
import { passwordCheckSchema, totpConfirmSchema } from "../schemas";

type Step =
  | { kind: "idle" }
  | { kind: "password" }
  | { kind: "scan"; setup: TwoFactorSetup }
  | { kind: "codes"; codes: string[] }
  | { kind: "disable" };

type TwoFactorSectionProps = {
  enabled: boolean;
  /** The business requires it for this role: it cannot be turned off. */
  required: boolean;
};

const QR_SIZE = 224;

export function TwoFactorSection({ enabled, required }: TwoFactorSectionProps) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const idle = () => setStep({ kind: "idle" });

  if (step.kind === "password") return <StartForm onStarted={(setup) => setStep({ kind: "scan", setup })} onCancel={idle} />;
  if (step.kind === "scan") return <ScanStep setup={step.setup} onDone={() => setStep({ kind: "codes", codes: step.setup.backupCodes })} onCancel={idle} />;
  if (step.kind === "codes") return <BackupCodes codes={step.codes} onDone={idle} />;
  if (step.kind === "disable") return <DisableForm onDone={idle} onCancel={idle} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {enabled ? (
          <Badge className="gap-1 bg-success-soft text-success">
            <CircleCheck aria-hidden />
            Activada
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <CircleDashed aria-hidden />
            Desactivada
          </Badge>
        )}
      </div>
      {enabled ? (
        <>
          <p className="text-sm text-muted-foreground">
            Al entrar te pedimos también el código de tu app. Si pierdes el móvil, usa uno de tus códigos de recuperación.
          </p>
          {required ? (
            <p className="text-sm text-muted-foreground">Tu rol la necesita: no se puede quitar mientras el negocio la exija.</p>
          ) : (
            <div>
              <Button type="button" variant="outline" onClick={() => setStep({ kind: "disable" })}>
                Desactivar
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Añade un segundo paso al entrar: un código de 6 dígitos de una app como Google Authenticator, Microsoft
            Authenticator o 1Password.
          </p>
          <div>
            <Button type="button" onClick={() => setStep({ kind: "password" })}>
              <ShieldCheck aria-hidden />
              Activar la verificación en dos pasos
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function StartForm({ onStarted, onCancel }: { onStarted: (setup: TwoFactorSetup) => void; onCancel: () => void }) {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: passwordCheckSchema,
    action: startTwoFactorSetupAction,
    defaultValues: { password: "" },
    onSuccess: (response) => {
      if (response.data) onStarted(response.data);
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <PasswordField
        id="two-factor-password"
        label="Tu contraseña"
        description="Para activarla, confirma que eres tú."
        autoComplete="current-password"
        error={form.formState.errors.password?.message}
        {...form.register("password")}
      />
      <FormMessage result={result} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} label="Continuar" pendingLabel="Comprobando…" />
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function ScanStep({ setup, onDone, onCancel }: { setup: TwoFactorSetup; onDone: () => void; onCancel: () => void }) {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: totpConfirmSchema,
    action: confirmTwoFactorSetupAction,
    defaultValues: { code: "" },
    onSuccess: (response) => {
      toast.success(response.message ?? "Verificación en dos pasos activada.");
      onDone();
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
        <li>Abre tu app de verificación y añade una cuenta nueva escaneando este código.</li>
        <li>Escribe abajo el código de 6 dígitos que te muestre.</li>
      </ol>
      <Image
        src={setup.qrCodeDataUrl}
        alt="Código QR para añadir la cuenta en tu app de verificación"
        width={QR_SIZE}
        height={QR_SIZE}
        unoptimized
        className="rounded-lg border bg-white p-2"
      />
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">¿No puedes escanearlo? Escribe esta clave en la app:</span>
        <div className="flex items-center gap-2">
          <code className="break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{setup.secret}</code>
          <CopyButton value={setup.secret} />
        </div>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Controller
          control={form.control}
          name="code"
          render={({ field, fieldState }) => (
            <TotpCodeField
              id="two-factor-code"
              label="Código de 6 dígitos"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              disabled={pending}
            />
          )}
        />
        <FormMessage result={result} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton pending={pending} label="Activar" pendingLabel="Activando…" />
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Guarda tus códigos de recuperación</p>
        <p className="text-sm text-muted-foreground">
          Sirven para entrar si pierdes el móvil. Cada uno vale una sola vez y no los volverás a ver: guárdalos en un gestor de
          contraseñas o en papel.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted p-3 font-mono text-sm sm:grid-cols-3">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join("\n")} label="Copiar códigos" />
        <Button type="button" onClick={onDone}>
          Ya los he guardado
        </Button>
      </div>
    </div>
  );
}

function DisableForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: passwordCheckSchema,
    action: disableTwoFactorAction,
    defaultValues: { password: "" },
    onSuccess: (response) => {
      toast.success(response.message ?? "Verificación en dos pasos desactivada.");
      onDone();
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <PasswordField
        id="disable-two-factor-password"
        label="Tu contraseña"
        description="Sin la verificación en dos pasos, basta tu contraseña para entrar."
        autoComplete="current-password"
        error={form.formState.errors.password?.message}
        {...form.register("password")}
      />
      <FormMessage result={result} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} variant="destructive" label="Desactivar" pendingLabel="Desactivando…" />
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
