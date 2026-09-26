import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SETUP_STEP } from "@/data/setup";
import { skipStepAction } from "../actions";
import { ContinueForm } from "../_components/continue-form";
import { setupStepHref } from "../_lib/view";

/** Step 6 ([ASI-09]), placeholder until the web chat exists: the web chat feature replaces this registry entry. */
export function WebchatStep() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border">
        <EmptyState
          icon={MessagesSquare}
          title="El chat web de prueba llegará con el chat web"
          description="Cuando el chat web esté disponible, podrás crearlo con tu agente y probarlo aquí mismo o desde Canales."
        />
      </div>
      <ContinueForm action={skipStepAction.bind(null, SETUP_STEP.webchat)} backHref={setupStepHref(SETUP_STEP.agent)} />
    </div>
  );
}
