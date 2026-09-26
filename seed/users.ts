// Test users of the demo: one per role, with a known password ([ARR-09]). They are marked `is_demo` so they can
// be listed and deleted from Settings › Users ([ARR-20]). The README shows this same table.
import type { Role } from "@/lib/enums";

/** Known password of every demo user. Only ever used in local demos (the seed refuses anywhere else). */
export const DEMO_PASSWORD = "demo1234";

/** Reserved `.test` domain: these addresses can never belong to someone real. */
export const DEMO_EMAIL_DOMAIN = "demo.test";

export const DEMO_USERS: readonly { name: string; email: string; role: Role }[] = [
  { name: "Elena Ruiz", email: `propietario@${DEMO_EMAIL_DOMAIN}`, role: "owner" },
  { name: "Javier Moreno", email: `admin@${DEMO_EMAIL_DOMAIN}`, role: "admin" },
  { name: "Carmen López", email: `supervisor@${DEMO_EMAIL_DOMAIN}`, role: "supervisor" },
  { name: "Pablo Sánchez", email: `agente@${DEMO_EMAIL_DOMAIN}`, role: "agent" },
  { name: "Sofía Navarro", email: `lectura@${DEMO_EMAIL_DOMAIN}`, role: "viewer" },
];
