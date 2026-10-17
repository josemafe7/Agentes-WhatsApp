// Background work of the envíos (decision 0008): the recurring round ([ENV-08], [MOT-15]) and sending back to the envío
// a contact whose message WhatsApp could not deliver, for its next channel. src/server/jobs/handlers/index.ts imports this file so every process that
// runs jobs knows it.
import "server-only";
import { registerJobHandler } from "@/server/jobs/registry";
import { CAMPAIGN_FALLBACK_JOB, campaignFallbackPayload, runCampaignFallback } from "./fallback";
import { CAMPAIGNS_JOB, runCampaigns } from "./runner";

registerJobHandler(CAMPAIGNS_JOB, async (_payload, context) => {
  await runCampaigns({ timeLeft: () => context.remainingMs() });
});

registerJobHandler(
  CAMPAIGN_FALLBACK_JOB,
  async (payload) => {
    await runCampaignFallback(payload);
  },
  { payload: campaignFallbackPayload },
);
