// Job "conversation.summary": the running summary of a long conversation ([MOT-13]), in src/server/engine/summary.ts.
import "server-only";
import { processSummaryJob, SUMMARY_JOB, summaryJobPayload } from "@/server/engine/summary";
import { registerJobHandler } from "../registry";

registerJobHandler(
  SUMMARY_JOB,
  async (payload) => {
    await processSummaryJob(payload);
  },
  { payload: summaryJobPayload },
);
