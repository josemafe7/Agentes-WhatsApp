import { getAiStepData, SETUP_STEP } from "@/data/setup";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { skipStepAction } from "../actions";
import { AiForm } from "../_components/ai-form";
import { setupStepHref } from "../_lib/view";
import { stepActor, type SetupStepProps } from "./types";

/** Step 4 ([ASI-07]): OpenRouter key (masked) and default chat model; can be left for later ([ARR-14]). */
export async function AiStep({ actor }: SetupStepProps) {
  const data = await getAiStepData(stepActor(actor));
  return (
    <AiForm
      keyView={data.openrouterKey}
      chatModel={data.chatModel}
      recommendedModel={DEFAULT_MODELS.chat}
      skipAction={skipStepAction.bind(null, SETUP_STEP.ai)}
      backHref={setupStepHref(SETUP_STEP.hours)}
    />
  );
}
