// Job "reply": the one reply of a conversation's turn ([MOT-01]–[MOT-14]), in src/server/engine/reply.ts.
import "server-only";
import { processReplyJob } from "@/server/engine/reply";
import { REPLY_JOB, replyJobPayload } from "@/server/engine/schedule";
import { registerJobHandler } from "../registry";

registerJobHandler(
  REPLY_JOB,
  async (payload, context) => {
    await processReplyJob(payload, context);
  },
  { payload: replyJobPayload },
);
