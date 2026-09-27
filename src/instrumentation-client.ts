// Runs in the browser before the app becomes interactive (node_modules/next/dist/docs: instrumentation-client.md).
// Zod builds its object parsers with `new Function` unless told not to, and first probes whether it may: the pages'
// Content-Security-Policy forbids eval ([SEG-11], docs/security.md «Configuración»), so each page would log a CSP
// violation. With `jitless` set before any schema is built, Zod never tries (same results, a little slower).
import { z } from "zod";

z.config({ jitless: true });
