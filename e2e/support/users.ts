// Who the tests sign in as. Demo users come from the demo seed and the README table ([ARR-09]); the e2e-only
// users are created by e2e/support/create-e2e-users.ts right after the seed.
// Expectations are written from docs/spec.md «Quién puede hacer qué» and docs/pantallas.md, not from the code.

export type RoleKey = "owner" | "admin" | "supervisor" | "agent" | "viewer";

export const ROLE_KEYS: readonly RoleKey[] = ["owner", "admin", "supervisor", "agent", "viewer"];

export type TestUser = { email: string; password: string };

export const DEMO_PASSWORD = "demo1234";

export const DEMO_USERS: Record<RoleKey, TestUser & { roleLabel: string }> = {
  owner: { email: "propietario@demo.test", password: DEMO_PASSWORD, roleLabel: "Propietario" },
  admin: { email: "admin@demo.test", password: DEMO_PASSWORD, roleLabel: "Administrador" },
  supervisor: { email: "supervisor@demo.test", password: DEMO_PASSWORD, roleLabel: "Supervisor" },
  agent: { email: "agente@demo.test", password: DEMO_PASSWORD, roleLabel: "Agente" },
  viewer: { email: "lectura@demo.test", password: DEMO_PASSWORD, roleLabel: "Solo lectura" },
};

/** Users that exist only in the e2e database, so a test can change them without touching the demo users. */
export const E2E_USERS = {
  /** Its password is changed by the password reset test ([USU-10]). */
  passwordReset: {
    name: "Rocío Restablece",
    email: "restablecer@e2e.test",
    password: "e2e-clave-inicial-1",
    role: "viewer",
  },
  /** Gets locked out on purpose by the sign-in limit test ([USU-13]). */
  rateLimited: {
    name: "Lucas Limite",
    email: "limite@e2e.test",
    password: "e2e-clave-limite-1",
    role: "viewer",
  },
} as const;

/** The eight sections of the main menu (docs/pantallas.md «Navegación»). */
export const SECTIONS = {
  bandeja: { label: "Bandeja", href: "/bandeja" },
  contactos: { label: "Contactos", href: "/contactos" },
  agenda: { label: "Agenda", href: "/agenda" },
  agentes: { label: "Agentes", href: "/agentes" },
  conocimiento: { label: "Conocimiento", href: "/conocimiento" },
  canales: { label: "Canales", href: "/canales" },
  informes: { label: "Informes", href: "/informes" },
  ajustes: { label: "Ajustes", href: "/ajustes" },
} as const;

export type SectionKey = keyof typeof SECTIONS;

/**
 * Sections each role sees ([PER-02]–[PER-04] and the permission table). Everyone keeps Ajustes because Mi cuenta
 * and Acerca de are for every role.
 */
export const VISIBLE_SECTIONS: Record<RoleKey, readonly SectionKey[]> = {
  owner: ["bandeja", "contactos", "agenda", "agentes", "conocimiento", "canales", "informes", "ajustes"],
  admin: ["bandeja", "contactos", "agenda", "agentes", "conocimiento", "canales", "informes", "ajustes"],
  supervisor: ["bandeja", "contactos", "agenda", "agentes", "conocimiento", "informes", "ajustes"],
  agent: ["bandeja", "contactos", "agenda", "ajustes"],
  viewer: ["bandeja", "contactos", "agenda", "agentes", "conocimiento", "canales", "informes", "ajustes"],
};

/** Settings pages, by the path each one lives at (docs/pantallas.md «Ajustes»). */
export const SETTINGS_PATHS = {
  negocio: "/ajustes/negocio",
  usuarios: "/ajustes/usuarios",
  horario: "/ajustes/horario",
  ia: "/ajustes/ia",
  correo: "/ajustes/correo",
  privacidad: "/ajustes/privacidad",
  notificaciones: "/ajustes/notificaciones",
  actividad: "/ajustes/actividad",
  diagnostico: "/ajustes/diagnostico",
  acerca: "/ajustes/acerca",
} as const;

/**
 * Pages a role must not open by typing the address ([SEG-04], [PER-03], [PER-04]): it gets «No tienes permiso»
 * or is sent somewhere it may be.
 */
export const FORBIDDEN_PAGES: Record<RoleKey, readonly string[]> = {
  owner: [],
  admin: [],
  supervisor: [SECTIONS.canales.href, SETTINGS_PATHS.ia, SETTINGS_PATHS.correo, SETTINGS_PATHS.usuarios, SETTINGS_PATHS.negocio],
  agent: [
    SETTINGS_PATHS.negocio,
    SECTIONS.agentes.href,
    SECTIONS.conocimiento.href,
    SECTIONS.canales.href,
    SECTIONS.informes.href,
    SETTINGS_PATHS.diagnostico,
  ],
  viewer: [SETTINGS_PATHS.usuarios, SETTINGS_PATHS.ia, SETTINGS_PATHS.actividad, SETTINGS_PATHS.diagnostico, SETTINGS_PATHS.negocio],
};
