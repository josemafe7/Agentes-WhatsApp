import { Bot, CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { widgetDemoHref } from "@/app/(app)/canales/_lib/webchat";
import { Button } from "@/components/ui/button";
import { WidgetEmbed } from "@/components/webchat/widget-embed";
import { SETUP_STEP } from "@/data/setup";
import { DEFAULT_SETUP_WEBCHAT_NAME, getSetupWebchatStepData } from "@/data/setup-webchat";
import { skipStepAction } from "../actions";
import { StepFooter } from "../_components/step-footer";
import { setupStepHref } from "../_lib/view";
import { stepActor, type SetupStepProps } from "./types";
import { WebchatStepForm } from "./webchat-step-form";

/**
 * Step 6 «Chat web de prueba» ([ASI-09]): creates a web chat with the agent of step 5 active and lets the owner try it
 * right here (the chat loads on this page, as on the business's site; the app's own address is always allowed,
 * [WEB-10]) or in /widget-demo. Coming back shows the chat already created; it can be skipped.
 */
export async function WebchatStep({ actor }: SetupStepProps) {
  const { agent, channel } = await getSetupWebchatStepData(stepActor(actor));
  const backHref = setupStepHref(SETUP_STEP.agent);

  if (!channel) {
    return (
      <WebchatStepForm
        defaultName={DEFAULT_SETUP_WEBCHAT_NAME}
        agentName={agent?.name ?? null}
        skipAction={skipStepAction.bind(null, SETUP_STEP.webchat)}
        backHref={backHref}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="webchat-ready" className="max-w-[640px] space-y-4 rounded-xl border bg-card p-6">
        <div className="space-y-1">
          <h2 id="webchat-ready" className="flex items-center gap-2 text-base font-semibold">
            <CircleCheck aria-hidden className="size-5 text-success" />
            «{channel.name}» está listo
          </h2>
          {channel.activeAgentName ? (
            <p className="flex items-start gap-2 text-sm">
              <Bot aria-hidden className="mt-0.5 size-4 shrink-0 text-ai" />
              <span>
                Responde <strong className="font-medium">{channel.activeAgentName}</strong>. Escríbele como si fueras un cliente: la conversación aparecerá
                en la bandeja.
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              Aún no tiene agente: los mensajes llegarán a la bandeja, pero la IA no contestará hasta que elijas uno en Canales.
            </p>
          )}
        </div>
        <p className="text-sm">Pruébalo aquí mismo: abre el chat con el botón redondo de abajo a la derecha y escribe una pregunta.</p>
        <Button asChild variant="outline">
          <a href={widgetDemoHref(channel.id)} target="_blank" rel="noopener">
            <ExternalLink aria-hidden />
            Probar el chat en /widget-demo
          </a>
        </Button>
        <p className="text-sm text-muted-foreground">
          Para ponerlo en tu web, añade tu dominio y copia el código en Canales › {channel.name} › Apariencia y código.
        </p>
      </section>
      <StepFooter backHref={backHref}>
        <Button asChild>
          <Link href={setupStepHref(SETUP_STEP.channels)}>Continuar</Link>
        </Button>
      </StepFooter>
      <WidgetEmbed channelId={channel.id} />
    </div>
  );
}
