import { Bot } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SETUP_STEP } from "@/data/setup";
import { skipStepAction } from "../actions";
import { ContinueForm } from "../_components/continue-form";
import { setupStepHref } from "../_lib/view";

/**
 * Step 5 ([ASI-08]), placeholder until agents exist: the agents feature replaces this entry of the registry with
 * the real step (template of the sector kept by step 2 in getSetupSectorTemplate, «Generar desde la web»).
 */
export function AgentStep() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border">
        <EmptyState
          icon={Bot}
          title="Tu primer agente llegará con la sección Agentes"
          description="Hemos guardado la plantilla de agente y las preguntas frecuentes de tu sector. Cuando la sección Agentes esté disponible, crearás tu primer agente a partir de ellas."
        />
      </div>
      <ContinueForm action={skipStepAction.bind(null, SETUP_STEP.agent)} backHref={setupStepHref(SETUP_STEP.ai)} />
    </div>
  );
}
