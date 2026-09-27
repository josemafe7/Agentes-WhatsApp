"use client";

import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { saveChannelSettingsAction } from "../../../actions";
import { ActiveAgentControl, type AgentOption } from "../../../_components/active-agent-control";
import { splitLines } from "../../../_lib/webchat";
import { BusyButton, WizardFooter } from "./wizard-footer";

type AgentStepProps = {
  channelId: string;
  channelName: string;
  agents: AgentOption[];
  activeAgent: AgentOption | null;
  aiEnabled: boolean;
  testMode: boolean;
  testAllowlist: string[];
  backHref: string;
  finishHref: string;
};

/**
 * Paso 5 · Agente ([WA-25], [CAN-03]–[CAN-06]): the active agent and the channel's AI (saved at once, as on the channel
 * card) and the test mode «solo a estos números», on by default, with its list. «Terminar» saves the list and opens
 * the number's panel.
 */
export function AgentStep({ channelId, channelName, agents, activeAgent, aiEnabled, testMode: initialTestMode, testAllowlist, backHref, finishHref }: AgentStepProps) {
  const id = useId();
  const router = useRouter();
  const [testMode, setTestMode] = useState(initialTestMode);
  const [allowlist, setAllowlist] = useState(testAllowlist.join("\n"));
  const [saved, setSaved] = useState({ testMode: initialTestMode, allowlist: testAllowlist.join("\n") });
  const [result, setResult] = useState<ActionResult | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const dirty = testMode !== saved.testMode || allowlist !== saved.allowlist;
  const listErrors = result && !result.ok ? result.fieldErrors?.testAllowlist : undefined;

  function save(then?: () => void) {
    startTransition(async () => {
      const outcome = await saveChannelSettingsAction(channelId, { testMode, testAllowlist: splitLines(allowlist) });
      setResult(outcome);
      if (!outcome.ok) return;
      setSaved({ testMode, allowlist });
      then?.();
    });
  }

  function finish() {
    if (dirty) save(() => router.push(finishHref));
    else router.push(finishHref);
  }

  return (
    <div className="grid max-w-2xl gap-6">
      <section aria-labelledby={`${id}-agent`} className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h3 id={`${id}-agent`} className="font-semibold">
            Quién contesta
          </h3>
          <p className="text-sm text-muted-foreground">
            {agents.length === 0 ? "Aún no tienes agentes: créalo en Agentes y elígelo después desde la tarjeta del canal." : "El agente de IA que contesta en este número. Se guarda al elegirlo."}
          </p>
        </div>
        <ActiveAgentControl channelId={channelId} channelName={channelName} agents={agents} activeAgent={activeAgent} aiEnabled={aiEnabled} canManage />
      </section>

      <section aria-labelledby={`${id}-test`} className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <h3 id={`${id}-test`} className="flex items-center gap-2 font-semibold">
          <FlaskConical aria-hidden className="size-4 text-warning" />
          Modo pruebas
        </h3>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`${id}-test-mode`}>Modo pruebas «solo a estos números»</FieldLabel>
            <FieldDescription>
              {testMode ? "La IA solo contesta a los números de la lista; los demás mensajes esperan a una persona." : "La IA contesta a todos los clientes que escriban a este número."}
            </FieldDescription>
          </FieldContent>
          <Switch id={`${id}-test-mode`} checked={testMode} onCheckedChange={setTestMode} />
        </Field>
        {testMode ? (
          <Field data-invalid={listErrors ? true : undefined}>
            <FieldLabel htmlFor={`${id}-allowlist`}>Solo a estos números</FieldLabel>
            <Textarea
              id={`${id}-allowlist`}
              rows={4}
              value={allowlist}
              onChange={(event) => setAllowlist(event.target.value)}
              placeholder="+34 600 000 000"
              spellCheck={false}
              className="font-mono"
              aria-invalid={listErrors ? true : undefined}
              aria-describedby={`${id}-allowlist-help`}
            />
            <FieldDescription id={`${id}-allowlist-help`}>
              Uno por línea, con el prefijo del país, o el identificador de WhatsApp del cliente (BSUID). Se compara con lo que da WhatsApp, nunca con lo que
              alguien escribe. Pon el tuyo para probar la IA antes de abrirla a todos.
            </FieldDescription>
            <FieldError errors={listErrors?.map((message) => ({ message }))} />
          </Field>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <BusyButton variant="outline" pending={pending} pendingLabel="Guardando…" disabled={!dirty} onClick={() => save()}>
            Guardar
          </BusyButton>
          <FormMessage result={result} />
        </div>
      </section>

      <WizardFooter back={{ href: backHref }}>
        <BusyButton pending={pending} pendingLabel="Guardando…" onClick={finish}>
          Terminar
        </BusyButton>
      </WizardFooter>
    </div>
  );
}
