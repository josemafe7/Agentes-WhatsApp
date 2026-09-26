// Step registry of /setup: step number → component. Later features plug their real step in here (the agents
// feature replaces 5, the web chat feature replaces 6) without touching the page or the other steps.
import type { ReactNode } from "react";
import { AgentStep } from "./agent-step";
import { AiStep } from "./ai-step";
import { BusinessStep } from "./business-step";
import { ChannelsStep } from "./channels-step";
import { HoursStep } from "./hours-step";
import { OwnerStep } from "./owner-step";
import type { SetupStepProps } from "./types";
import { WebchatStep } from "./webchat-step";

/** A step: a server component (it may be async) that receives the actor and the progress. */
export type SetupStepComponent = (props: SetupStepProps) => ReactNode | Promise<ReactNode>;

export const SETUP_STEP_COMPONENTS: Readonly<Record<number, SetupStepComponent>> = {
  1: OwnerStep,
  2: BusinessStep,
  3: HoursStep,
  4: AiStep,
  5: AgentStep,
  6: WebchatStep,
  7: ChannelsStep,
};
