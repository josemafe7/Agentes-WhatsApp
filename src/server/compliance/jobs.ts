// Background work of compliance (decision 0008): the one confirmation of an opt-out ([CUM-03]). The daily clean-up
// has its own handler (src/server/jobs/handlers/retention.ts). src/server/jobs/handlers/index.ts imports this file so
// every process that runs jobs knows it.
import "server-only";
import { registerJobHandler } from "@/server/jobs/registry";
import { OPT_OUT_CONFIRMATION_JOB, optOutConfirmationPayload } from "./opt-out";
import { sendOptOutConfirmation } from "./opt-out-confirmation";

registerJobHandler(
  OPT_OUT_CONFIRMATION_JOB,
  async (payload) => {
    await sendOptOutConfirmation(payload);
  },
  { payload: optOutConfirmationPayload },
);
