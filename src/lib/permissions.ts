// Who can do what: the table «Quién puede hacer qué» of docs/spec.md as a pure function ([PER-01]–[PER-07]).
// Pure TypeScript (no server imports): the server always checks with it; the UI may use it only to hide buttons.
import { ROLES, type Role } from "./enums";

export { ROLES, type Role };

/** Every action of the spec table, grouped by area. What is not here is not allowed. */
export const PERMISSIONS = {
  inbox: {
    /** Ver conversaciones, mensajes, fuentes y notas. */
    view: "inbox.view",
    /** Responder, enviar plantillas y adjuntos. */
    reply: "inbox.reply",
    /** Aprobar, editar o descartar borradores. */
    drafts: "inbox.drafts",
    /** Escribir notas internas. */
    notes: "inbox.notes",
    /** Pausar o reanudar la IA de una conversación. */
    pauseAi: "inbox.pause_ai",
    /** Traspasar a mano, cambiar estado y etiquetas. */
    manage: "inbox.manage",
    /** Asignar a cualquier persona. */
    assign: "inbox.assign",
    /** Tomar para sí una conversación sin asignar (agent: only of their channels). */
    claim: "inbox.claim",
    /** Elegir otro agente para una conversación. */
    changeAgent: "inbox.change_agent",
    /** Convertir una respuesta en FAQ. */
    convertFaq: "inbox.convert_faq",
  },
  contacts: {
    /** Ver fichas. */
    view: "contacts.view",
    /** Crear y editar datos, etiquetas y campos. */
    edit: "contacts.edit",
    /** Fusionar duplicados y quitar una baja. */
    merge: "contacts.merge",
    /** Exportar datos. */
    export: "contacts.export",
    /** Borrar datos. */
    delete: "contacts.delete",
  },
  agenda: {
    /** Ver citas y disponibilidad. */
    view: "agenda.view",
    /** Crear, editar, mover y cancelar citas. */
    bookings: "agenda.bookings",
    /** Bloquear huecos y poner ausencias. */
    block: "agenda.block",
    /** Configurar servicios, recursos, horarios, terminología y recordatorios. */
    configure: "agenda.configure",
    /** Borrar las citas de prueba. */
    deleteTestBookings: "agenda.delete_test_bookings",
  },
  agents: {
    /** Ver configuración y versiones. */
    view: "agents.view",
    /** Crear, editar, borrar, recuperar versiones y archivos de contexto. */
    manage: "agents.manage",
    /** Probar agente. */
    test: "agents.test",
    /** Herramientas HTTP personalizadas. */
    customTools: "agents.custom_tools",
  },
  knowledge: {
    /** Ver bases y documentos. */
    view: "knowledge.view",
    /** Crear, editar, borrar y reprocesar bases, documentos, webs y FAQ. */
    manage: "knowledge.manage",
    /** Probar búsqueda. */
    testSearch: "knowledge.test_search",
  },
  channels: {
    /** Ver lista, estado y panel, sin credenciales. */
    view: "channels.view",
    /** Crear, conectar, configurar, desconectar y borrar; agente activo e IA del canal. */
    manage: "channels.manage",
  },
  reports: {
    view: "reports.view",
    /** Descargar cada tabla en CSV ([INF-09]). */
    export: "reports.export",
  },
  settings: {
    /** Negocio, Horario, Privacidad y legal, Notificaciones y Tarifas. */
    business: "settings.business",
    /** IA (claves y modelos) y Correo del sistema. */
    integrations: "settings.integrations",
    /** Usuarios: invitar, roles, canales, desactivar, borrar y exigir 2FA (admin: not over the owner). */
    users: "settings.users",
    /** Traspasar la propiedad. */
    transferOwnership: "settings.transfer_ownership",
    /** Registro de actividad. */
    auditLog: "settings.audit_log",
    /** Diagnóstico y simulador. */
    diagnostics: "settings.diagnostics",
  },
  account: {
    /** Mi cuenta, Acerca de y Ayuda. */
    self: "account.self",
  },
  secrets: {
    /** See a secret masked («••••1234») ([PER-07]); nobody sees one whole. */
    viewMasked: "secrets.view_masked",
  },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];
export type Action = Leaves<typeof PERMISSIONS>;

/** yes; no; channels = only the agent's channels ([PER-02]); notOwner = not over the owner ([PER-05]). */
type Rule = "yes" | "no" | "channels" | "notOwner";
const Y: Rule = "yes";
const N: Rule = "no";
const CH: Rule = "channels";

//                                          owner admin      supervisor agent viewer
const RULES: Record<Action, readonly [Rule, Rule, Rule, Rule, Rule]> = {
  "inbox.view": [Y, Y, Y, CH, Y],
  "inbox.reply": [Y, Y, Y, CH, N],
  "inbox.drafts": [Y, Y, Y, CH, N],
  "inbox.notes": [Y, Y, Y, CH, N],
  "inbox.pause_ai": [Y, Y, Y, CH, N],
  "inbox.manage": [Y, Y, Y, CH, N],
  "inbox.assign": [Y, Y, Y, N, N],
  "inbox.claim": [Y, Y, Y, CH, N],
  "inbox.change_agent": [Y, Y, Y, N, N],
  "inbox.convert_faq": [Y, Y, Y, N, N],
  "contacts.view": [Y, Y, Y, CH, Y],
  "contacts.edit": [Y, Y, Y, CH, N],
  "contacts.merge": [Y, Y, Y, N, N],
  "contacts.export": [Y, Y, N, N, N],
  "contacts.delete": [Y, Y, N, N, N],
  "agenda.view": [Y, Y, Y, Y, Y],
  "agenda.bookings": [Y, Y, Y, Y, N],
  "agenda.block": [Y, Y, Y, N, N],
  "agenda.configure": [Y, Y, N, N, N],
  "agenda.delete_test_bookings": [Y, Y, Y, N, N],
  "agents.view": [Y, Y, Y, N, Y],
  "agents.manage": [Y, Y, N, N, N],
  "agents.test": [Y, Y, Y, N, N],
  "agents.custom_tools": [Y, Y, N, N, N],
  "knowledge.view": [Y, Y, Y, N, Y],
  "knowledge.manage": [Y, Y, Y, N, N],
  "knowledge.test_search": [Y, Y, Y, N, N],
  "channels.view": [Y, Y, N, N, Y],
  "channels.manage": [Y, Y, N, N, N],
  "reports.view": [Y, Y, Y, N, Y],
  "reports.export": [Y, Y, N, N, N],
  "settings.business": [Y, Y, N, N, N],
  "settings.integrations": [Y, Y, N, N, N],
  "settings.users": [Y, "notOwner", N, N, N],
  "settings.transfer_ownership": [Y, N, N, N, N],
  "settings.audit_log": [Y, Y, N, N, N],
  "settings.diagnostics": [Y, Y, N, N, N],
  "account.self": [Y, Y, Y, Y, Y],
  "secrets.view_masked": [Y, Y, N, N, N],
};

export const ALL_ACTIONS = Object.keys(RULES) as Action[];

/** Who acts: the signed-in person, as loaded on the server for every request (src/server/session.ts). */
export type Actor = {
  userId: string;
  role: Role;
  name: string;
  /** Channels an Agent is limited to; null = every channel (other roles, or an agent without channel rows). */
  channelIds: readonly string[] | null;
};

/** What the action touches. Omit it for an area-level check (e.g. «may open the inbox»). */
export type PermissionScope = {
  /** Channel of the record; null for records without a channel (test conversations). */
  channelId?: string | null;
  /** Channels a record belongs to (e.g. the channels of a contact's conversations). */
  channelIds?: readonly string[];
  /** User management: the user acted upon and their current role. */
  targetUserId?: string;
  targetRole?: Role;
  /** User management: the role being given. */
  newRole?: Role;
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Agente",
  viewer: "Solo lectura",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function withinChannels(actor: Actor, scope: PermissionScope | undefined): boolean {
  if (actor.channelIds === null) return true;
  if (scope?.channelId !== undefined) return scope.channelId !== null && actor.channelIds.includes(scope.channelId);
  if (scope?.channelIds !== undefined) return scope.channelIds.some((id) => actor.channelIds?.includes(id));
  return true;
}

/** Whether `actor` may do `action` on `scope`. Unknown actors and actions are denied. */
export function can(actor: Actor | null | undefined, action: Action, scope?: PermissionScope): boolean {
  if (!actor || !isRole(actor.role)) return false;
  const rules = RULES[action];
  if (!rules) return false;
  const rule = rules[ROLES.indexOf(actor.role)];
  // Ownership only changes hands through the transfer ([USU-16]).
  if (action === PERMISSIONS.settings.users && scope?.newRole === "owner") return false;
  switch (rule) {
    case "yes":
      return true;
    case "channels":
      return withinChannels(actor, scope);
    case "notOwner":
      return scope?.targetRole !== "owner";
    default:
      return false;
  }
}

/** Channel ids to filter list queries by, or null for no filter (all channels) ([PER-02]). */
export function channelFilter(actor: Actor): readonly string[] | null {
  return actor.role === "agent" ? actor.channelIds : null;
}
