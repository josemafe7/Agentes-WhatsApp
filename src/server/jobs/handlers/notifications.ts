// Job "notifications.deliver": the email and push of a notice for one person ([TRA-05], [PWA-07]).
import "server-only";
import { deliverJobPayload, deliverNotification, NOTIFICATIONS_DELIVER_JOB } from "@/server/notifications/notify";
import { registerJobHandler } from "../registry";

registerJobHandler(NOTIFICATIONS_DELIVER_JOB, (payload) => deliverNotification(payload), { payload: deliverJobPayload });
