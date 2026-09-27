// Registers every job handler. tick() imports this file, so any process that runs jobs (the app, the cron
// route, `pnpm worker`) knows all job types. Add each new handler module here.
import "server-only";
import "./system-email";
import "./reply";
import "./demo-status";
import "./notifications";
import "./summary";
import "./retention";
import "./model-catalog";
import "@/server/compliance/jobs";
import "@/server/knowledge/jobs";
import "@/server/channels/whatsapp/jobs";
import "@/server/channels/email/jobs";
import "@/server/booking/jobs";
import "@/server/channels/webchat/cleanup";
