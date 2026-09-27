// Registers every job handler. tick() imports this file, so any process that runs jobs (the app, the cron
// route, `pnpm worker`) knows all job types. Add each new handler module here.
import "./system-email";
import "./reply";
import "./demo-status";
import "./notifications";
import "./summary";
