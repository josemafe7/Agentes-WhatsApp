"use client";

import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import type { ReplyMode } from "@/lib/enums";
import { saveEmailRepliesAction } from "../actions";
import { ActiveAgentControl, type AgentOption } from "../../../_components/active-agent-control";
import { splitLines } from "../../../_lib/webchat";
import { WaField } from "../../whatsapp/_components/wa-field";
import { BusyButton, WizardFooter } from "../../whatsapp/_components/wizard-footer";

type RepliesStepProps = {
  channelId: string;
  channelName: string;
  agents: AgentOption[];
  activeAgent: AgentOption | null;
  aiEnabled: boolean;
  replyMode: ReplyMode;
  testMode: boolean;
  testAllowlist: string[];
  signature: string | null;
  dailyCapPerThread: number;
  dailyCapPerSender: number;
  limits: { maxDailyCap: number; maxSignature: number };
  /** The signature when none is written ([COR-21]). */
  businessName: string;
  /** The AI notice that always closes the AI's emails: sent alone, or reviewed by a person ([COR-21], [COR-18]). */
  notices: { automatic: string; reviewed: string };
  backHref: string;
  finishHref: string;
};

/** Email first: a draft is the default of every mailbox ([CAN-07], [COR-14]). */
const REPLY_MODES: { value: ReplyMode; label: string; description: string }[] = [
  {
    value: "draft",
    label: "Borrador para revisar (recomendado)",
    description: "La IA deja la respuesta como borrador en la bandeja y en la carpeta de borradores del buzón. Una persona la aprueba, la edita o la descarta.",
  },
  { value: "auto", label: "Automático", description: "La IA envía la respuesta sola, marcada como respuesta automática." },
];

/**
 * «Respuestas y agente» ([CAN-03]–[CAN-07], [COR-14], [COR-17], [COR-21]): who answers and the channel's AI (saved at
 * once, as on the channel card); the reply mode, the daily caps per thread and per sender, the signature with the AI
 * notice, and the test mode «solo a estos contactos». «Guardar y terminar» opens the mailbox's panel.
 */
export function RepliesStep(props: RepliesStepProps) {
  const { channelId, channelName, agents, activeAgent, aiEnabled, limits, businessName, notices, backHref, finishHref } = props;
  const id = useId();
  const router = useRouter();
  const [replyMode, setReplyMode] = useState<ReplyMode>(props.replyMode);
  const [capPerThread, setCapPerThread] = useState(String(props.dailyCapPerThread));
  const [capPerSender, setCapPerSender] = useState(String(props.dailyCapPerSender));
  const [signature, setSignature] = useState(props.signature ?? "");
  const [testMode, setTestMode] = useState(props.testMode);
  const [allowlist, setAllowlist] = useState(props.testAllowlist.join("\n"));
  const [result, setResult] = useState<ActionResult | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const errorsOf = (key: string) => (result && !result.ok && result.fieldErrors?.[key]?.length ? result.fieldErrors[key] : undefined);

  function finish() {
    if (pending) return;
    startTransition(async () => {
      const outcome = await saveEmailRepliesAction(channelId, {
        replyMode,
        dailyCapPerThread: capPerThread,
        dailyCapPerSender: capPerSender,
        signature,
        testMode,
        testAllowlist: testMode ? splitLines(allowlist) : [],
      });
      setResult(outcome);
      if (outcome.ok) router.push(finishHref);
    });
  }

  const signatureErrors = errorsOf("signature");
  const listErrors = errorsOf("testAllowlist");
  const preview = `-- \n${signature.trim() || businessName}\n${replyMode === "draft" ? notices.reviewed : notices.automatic}`;

  return (
    <div className="grid max-w-2xl gap-6">
      <section aria-labelledby={`${id}-agent`} className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h3 id={`${id}-agent`} className="font-semibold">
            Quién contesta
          </h3>
          <p className="text-sm text-muted-foreground">
            {agents.length === 0 ? "Aún no tienes agentes: créalo en Agentes y elígelo después desde la tarjeta del canal." : "El agente de IA que contesta en este buzón. Se guarda al elegirlo."}
          </p>
        </div>
        <ActiveAgentControl channelId={channelId} channelName={channelName} agents={agents} activeAgent={activeAgent} aiEnabled={aiEnabled} canManage />
      </section>

      <FieldSet>
        <FieldLegend variant="label">Modo de respuesta</FieldLegend>
        <RadioGroup value={replyMode} onValueChange={(value) => setReplyMode(value === "auto" ? "auto" : "draft")} className="grid gap-3">
          {REPLY_MODES.map((option) => (
            <div key={option.value} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
              <RadioGroupItem id={`${id}-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`${id}-${option.value}-help`} />
              <div className="grid gap-1">
                <FieldLabel htmlFor={`${id}-${option.value}`}>{option.label}</FieldLabel>
                <FieldDescription id={`${id}-${option.value}-help`}>{option.description}</FieldDescription>
              </div>
            </div>
          ))}
        </RadioGroup>
        <FieldError errors={errorsOf("replyMode")?.map((message) => ({ message }))} />
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Tope diario de respuestas de la IA</FieldLegend>
        <FieldDescription>Al llegar al tope, la IA deja de contestar ese día y la conversación espera a una persona.</FieldDescription>
        <div className="grid gap-4 sm:grid-cols-2">
          <WaField
            id={`${id}-cap-thread`}
            label="Por hilo"
            value={capPerThread}
            onChange={(value) => setCapPerThread(value.replace(/\D/g, ""))}
            inputMode="numeric"
            maxLength={3}
            description={`Entre 1 y ${limits.maxDailyCap}.`}
            errors={errorsOf("dailyCapPerThread")}
          />
          <WaField
            id={`${id}-cap-sender`}
            label="Por remitente"
            value={capPerSender}
            onChange={(value) => setCapPerSender(value.replace(/\D/g, ""))}
            inputMode="numeric"
            maxLength={3}
            description={`Entre 1 y ${limits.maxDailyCap}.`}
            errors={errorsOf("dailyCapPerSender")}
          />
        </div>
      </FieldSet>

      <FieldGroup>
        <Field data-invalid={signatureErrors ? true : undefined}>
          <FieldLabel htmlFor={`${id}-signature`}>Firma (opcional)</FieldLabel>
          <Textarea
            id={`${id}-signature`}
            rows={3}
            value={signature}
            maxLength={limits.maxSignature}
            onChange={(event) => setSignature(event.target.value)}
            placeholder={businessName}
            aria-invalid={signatureErrors ? true : undefined}
            aria-describedby={`${id}-signature-help ${id}-signature-preview`}
          />
          <FieldDescription id={`${id}-signature-help`}>
            Va al final de cada correo de la IA, después de su saludo. Vacía, se usa el nombre del negocio. Debajo va siempre el aviso de que lo ha escrito una IA.
          </FieldDescription>
          <pre id={`${id}-signature-preview`} aria-label="Así termina cada correo de la IA" className="rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {preview}
          </pre>
          <FieldError errors={signatureErrors?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>

      <section aria-labelledby={`${id}-test`} className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <h3 id={`${id}-test`} className="flex items-center gap-2 font-semibold">
          <FlaskConical aria-hidden className="size-4 text-warning" />
          Modo pruebas
        </h3>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`${id}-test-mode`}>Modo pruebas «solo a estos contactos»</FieldLabel>
            <FieldDescription>
              {testMode ? "La IA solo contesta a las direcciones de la lista; los demás correos esperan a una persona." : "La IA contesta a todos los que escriban a este buzón."}
            </FieldDescription>
          </FieldContent>
          <Switch id={`${id}-test-mode`} checked={testMode} onCheckedChange={setTestMode} />
        </Field>
        {testMode ? (
          <Field data-invalid={listErrors ? true : undefined}>
            <FieldLabel htmlFor={`${id}-allowlist`}>Solo a estas direcciones</FieldLabel>
            <Textarea
              id={`${id}-allowlist`}
              rows={4}
              value={allowlist}
              onChange={(event) => setAllowlist(event.target.value)}
              placeholder="tu@correo.es"
              spellCheck={false}
              className="font-mono"
              aria-invalid={listErrors ? true : undefined}
              aria-describedby={`${id}-allowlist-help`}
            />
            <FieldDescription id={`${id}-allowlist-help`}>
              Una dirección por línea. Se compara con el remitente del correo. Pon la tuya para probar la IA antes de abrirla a todos.
            </FieldDescription>
            <FieldError errors={listErrors?.map((message) => ({ message }))} />
          </Field>
        ) : null}
      </section>

      {result && !result.ok ? <FormMessage result={result} /> : null}

      <WizardFooter back={{ href: backHref }}>
        <BusyButton pending={pending} pendingLabel="Guardando…" onClick={finish}>
          Guardar y terminar
        </BusyButton>
      </WizardFooter>
    </div>
  );
}
