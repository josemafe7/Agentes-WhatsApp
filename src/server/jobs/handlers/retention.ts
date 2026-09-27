// Job "compliance.retention": the daily clean-up of Ajustes › Privacidad y legal ([CUM-05], [CUM-06]), in
// src/server/compliance/retention.ts. A daily recurring job (ensureRetentionJob, asked for when the server starts); a
// round that does not fit in this run's time goes on shortly after, in the next tick ([MOT-15]).
import "server-only";
import { RETENTION_JOB, runRetention } from "@/server/compliance/retention";
import { registerJobHandler, type JobContext } from "../registry";

/** Wait before a round that ran out of time goes on. */
export const RETENTION_CONTINUE_MS = 1_000;

export async function runRetentionJob(context: Pick<JobContext, "remainingMs" | "rescheduleAt">): Promise<void> {
  const { finished } = await runRetention({ remainingMs: context.remainingMs });
  if (!finished) context.rescheduleAt(new Date(Date.now() + RETENTION_CONTINUE_MS));
}

registerJobHandler(RETENTION_JOB, async (_payload, context) => {
  await runRetentionJob(context);
});
