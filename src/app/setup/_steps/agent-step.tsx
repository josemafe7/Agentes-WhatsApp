import { SETUP_STEP } from "@/data/setup";
import { getSetupAgentStepData } from "@/data/setup-agent";
import { skipStepAction } from "../actions";
import { setupStepHref } from "../_lib/view";
import { AgentForm } from "./agent-form";
import { stepActor, type SetupStepProps } from "./types";

/**
 * Step 5 ([ASI-08]): the first agent from the sector template kept by step 2, or from a draft generated from the
 * business website (with an OpenRouter key). Coming back edits the agent already created; it can be skipped.
 */
export async function AgentStep({ actor }: SetupStepProps) {
  const data = await getSetupAgentStepData(stepActor(actor));
  return <AgentForm data={data} skipAction={skipStepAction.bind(null, SETUP_STEP.agent)} aiStepHref={setupStepHref(SETUP_STEP.ai)} />;
}
