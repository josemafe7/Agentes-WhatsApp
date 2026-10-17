// Menu of the app (DESIGN.md «Layout», docs/pantallas.md «Navegación»): sections, settings pages and which ones
// each role sees. Pure module shared by the server layout and the client menus. Hiding a link never protects
// anything: every page checks the permission again on the server ([SEG-04]).
import {
  Activity,
  Bell,
  BellRing,
  BookOpen,
  Bot,
  CalendarDays,
  ChartColumn,
  Clock,
  Inbox,
  Info,
  Mail,
  MessageCircle,
  Megaphone,
  MessagesSquare,
  RadioTower,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { PROFILE_PATH } from "@/lib/auth-paths";
import { can, PERMISSIONS, ROLE_LABELS, type Action, type Actor, type Role } from "@/lib/permissions";

/** «Mi cuenta» (name, password, 2FA, sign out): the profile page of the auth screens. */
export const ACCOUNT_HREF = PROFILE_PATH;
export const SETTINGS_HREF = "/ajustes";
/** Ayuda: the guides bundled with the app, for every role ([AJU-17]). */
export const HELP_HREF = "/ayuda";

export type SectionKey =
  | "bandeja"
  | "contactos"
  | "agenda"
  | "envios"
  | "asistentes"
  | "agentes"
  | "conocimiento"
  | "canales"
  | "informes"
  | "ajustes";

export type NavSection = {
  key: SectionKey;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Menu group: separators go between groups, never titles (DESIGN.md). */
  group: 0 | 1 | 2;
  /** Visible when the actor may do any of these. */
  anyOf: readonly Action[];
};

export type SettingsPageKey =
  | "negocio"
  | "usuarios"
  | "horario"
  | "ia"
  | "correo"
  | "whatsapp"
  | "privacidad"
  | "notificaciones"
  | "recordatorios"
  | "envios"
  | "actividad"
  | "diagnostico"
  | "cuenta"
  | "acerca";

export type SettingsPage = {
  key: SettingsPageKey;
  label: string;
  href: string;
  icon: LucideIcon;
  /** One line for the settings index. */
  description: string;
  /** Sub-navigation group: separators go between groups, never titles, as in the main menu. */
  group: 0 | 1 | 2 | 3 | 4;
  permission: Action;
};

/**
 * Settings sub-navigation, in order: Negocio, Usuarios, Horario | IA, Correo del sistema, WhatsApp | Privacidad y
 * legal, Notificaciones, Recordatorios, Envíos | Registro de actividad, Diagnóstico | Mi cuenta, Acerca de. Permissions from
 * «Quién puede hacer qué» ([PER-03], [PER-04]).
 */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    key: "negocio",
    label: "Negocio",
    href: "/ajustes/negocio",
    icon: Store,
    description: "Nombre, logo, color, sector, zona horaria y datos de contacto.",
    group: 0,
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "usuarios",
    label: "Usuarios",
    href: "/ajustes/usuarios",
    icon: UsersRound,
    description: "Equipo, invitaciones, roles y verificación en dos pasos.",
    group: 0,
    permission: PERMISSIONS.settings.users,
  },
  {
    key: "horario",
    label: "Horario",
    href: "/ajustes/horario",
    icon: Clock,
    description: "Horario semanal, festivos y cierres.",
    group: 0,
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "ia",
    label: "IA",
    href: "/ajustes/ia",
    icon: Sparkles,
    description: "Clave de OpenRouter, modelos por defecto y privacidad de la IA.",
    group: 1,
    permission: PERMISSIONS.settings.integrations,
  },
  {
    key: "correo",
    label: "Correo del sistema",
    href: "/ajustes/correo",
    icon: Mail,
    description: "Servidor de correo para invitaciones, recuperación de contraseña y avisos.",
    group: 1,
    permission: PERMISSIONS.settings.integrations,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    href: "/ajustes/whatsapp",
    icon: MessageCircle,
    description: "Tarifas por mensaje de Meta y dirección de avisos de la instalación.",
    group: 1,
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "privacidad",
    label: "Privacidad y legal",
    href: "/ajustes/privacidad",
    icon: ShieldCheck,
    description: "Textos legales, aviso de IA y plazos de conservación.",
    group: 2,
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "notificaciones",
    label: "Notificaciones",
    href: "/ajustes/notificaciones",
    icon: Bell,
    description: "Qué sucesos avisan y a quién.",
    group: 2,
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "recordatorios",
    label: "Recordatorios",
    href: "/ajustes/recordatorios",
    icon: BellRing,
    description: "Aviso a los clientes antes de su cita, por WhatsApp o por email.",
    group: 2,
    permission: PERMISSIONS.agenda.configure,
  },
  {
    key: "envios",
    label: "Envíos",
    href: "/ajustes/envios",
    icon: Megaphone,
    description: "Horas de envío, cada cuántos días como mucho y topes del correo.",
    group: 2,
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "actividad",
    label: "Registro de actividad",
    href: "/ajustes/actividad",
    icon: ScrollText,
    description: "Lo que hacen las personas y la IA en la app.",
    group: 3,
    permission: PERMISSIONS.settings.auditLog,
  },
  {
    key: "diagnostico",
    label: "Diagnóstico",
    href: "/ajustes/diagnostico",
    icon: Activity,
    description: "Estado de la base de datos, de la cola de trabajo y de los envíos.",
    group: 3,
    permission: PERMISSIONS.settings.diagnostics,
  },
  {
    key: "cuenta",
    label: "Mi cuenta",
    href: ACCOUNT_HREF,
    icon: UserRound,
    description: "Tu nombre, tu contraseña y la verificación en dos pasos.",
    group: 4,
    permission: PERMISSIONS.account.self,
  },
  {
    key: "acerca",
    label: "Acerca de",
    href: "/ajustes/acerca",
    icon: Info,
    description: "Versión de la app y enlace a la Ayuda.",
    group: 4,
    permission: PERMISSIONS.account.self,
  },
];

/** «Asistentes»: where each person asks the internal agents they were given ([INT-06]). */
export const ASSISTANTS_HREF = "/asistentes";

/** The ten sections: Bandeja, Contactos, Agenda, Envíos, Asistentes | Agentes, Conocimiento, Canales | Informes, Ajustes. */
export const SECTIONS: readonly NavSection[] = [
  { key: "bandeja", label: "Bandeja", href: "/bandeja", icon: Inbox, group: 0, anyOf: [PERMISSIONS.inbox.view] },
  { key: "contactos", label: "Contactos", href: "/contactos", icon: Users, group: 0, anyOf: [PERMISSIONS.contacts.view] },
  { key: "agenda", label: "Agenda", href: "/agenda", icon: CalendarDays, group: 0, anyOf: [PERMISSIONS.agenda.view] },
  { key: "envios", label: "Envíos", href: "/envios", icon: Megaphone, group: 0, anyOf: [PERMISSIONS.campaigns.view] },
  { key: "asistentes", label: "Asistentes", href: ASSISTANTS_HREF, icon: MessagesSquare, group: 0, anyOf: [PERMISSIONS.internal.use] },
  { key: "agentes", label: "Agentes", href: "/agentes", icon: Bot, group: 1, anyOf: [PERMISSIONS.agents.view] },
  {
    key: "conocimiento",
    label: "Conocimiento",
    href: "/conocimiento",
    icon: BookOpen,
    group: 1,
    anyOf: [PERMISSIONS.knowledge.view],
  },
  { key: "canales", label: "Canales", href: "/canales", icon: RadioTower, group: 1, anyOf: [PERMISSIONS.channels.view] },
  { key: "informes", label: "Informes", href: "/informes", icon: ChartColumn, group: 2, anyOf: [PERMISSIONS.reports.view] },
  {
    key: "ajustes",
    label: "Ajustes",
    href: SETTINGS_HREF,
    icon: Settings,
    group: 2,
    // Ajustes shows whenever at least one of its pages does (everyone has Mi cuenta and Acerca de).
    anyOf: [...new Set(SETTINGS_PAGES.map((page) => page.permission))],
  },
];

/** What only the server knows about the person and also decides a section. */
export type SectionContext = {
  /** They have at least one internal agent to use: without any, «Asistentes» is not in their menu ([INT-06]). */
  hasAssistants?: boolean;
};

/** Sections of the menu the actor may open (area-level check; each page checks the record again). */
export function visibleSections(actor: Actor | null, context: SectionContext = {}): NavSection[] {
  if (!actor) return [];
  return SECTIONS.filter((section) => section.anyOf.some((action) => can(actor, action)) && (section.key !== "asistentes" || context.hasAssistants === true));
}

/** Entries of a menu split in their groups, in group order and without empty groups. */
function splitInGroups<Entry extends { group: number }>(entries: readonly Entry[]): Entry[][] {
  const groups = [...new Set(entries.map((entry) => entry.group))].sort((a, b) => a - b);
  return groups.map((group) => entries.filter((entry) => entry.group === group));
}

/** Sections split in their groups, without empty groups. */
export function groupSections(sections: readonly NavSection[]): NavSection[][] {
  return splitInGroups(sections);
}

/** Settings pages the actor may open, in sub-navigation order. */
export function visibleSettingsPages(actor: Actor | null): SettingsPage[] {
  if (!actor) return [];
  return SETTINGS_PAGES.filter((page) => can(actor, page.permission));
}

/** Settings pages split in their groups, without empty groups. */
export function groupSettingsPages(pages: readonly SettingsPage[]): SettingsPage[][] {
  return splitInGroups(pages);
}

/**
 * Pages of the settings sub-navigation for who is looking. None until they set up the two-step verification the
 * business requires: only «Mi cuenta» opens then ([USU-12]), so the menu would lead nowhere.
 */
export function settingsNavKeys(actor: Actor & { twoFactorSetupRequired: boolean }): SettingsPageKey[] {
  return actor.twoFactorSetupRequired ? [] : visibleSettingsPages(actor).map((page) => page.key);
}

function cleanPath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** Whether `href` is the current page (exact) or one of its ancestors. */
export function isActivePath(pathname: string, href: string, options: { exact?: boolean } = {}): boolean {
  const path = cleanPath(pathname);
  if (path === href) return true;
  return !options.exact && path.startsWith(`${href}/`);
}

/** Sections of the mobile bottom bar (inbox first for agents on the phone), in this order. */
export const MOBILE_PRIMARY_KEYS: readonly SectionKey[] = ["bandeja", "agenda", "contactos"];

/** Bottom bar sections and the rest, which go under «Más». */
export function splitMobileSections(sections: readonly NavSection[]): { primary: NavSection[]; more: NavSection[] } {
  const primary = MOBILE_PRIMARY_KEYS.flatMap((key) => sections.filter((section) => section.key === key));
  const more = sections.filter((section) => !MOBILE_PRIMARY_KEYS.includes(section.key));
  return { primary, more };
}

/** Inside a conversation the bottom bar hides: the conversation takes the whole screen. */
export function hidesBottomNav(pathname: string): boolean {
  return /^\/bandeja\/[^/]+/.test(cleanPath(pathname));
}

/** Section of a path, for the top bar trail. */
export function sectionForPath(pathname: string): NavSection | null {
  return SECTIONS.find((section) => isActivePath(pathname, section.href)) ?? null;
}

/** Text of the «Sin permiso» screen for a role (DESIGN.md «Estados de pantalla»). */
export function noPermissionDescription(role: Role): string {
  return `Tu rol (${ROLE_LABELS[role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`;
}

/** Settings page of a path (not the settings index). «Mi cuenta» is one too, although it lives at /perfil. */
export function settingsPageForPath(pathname: string): SettingsPage | null {
  return SETTINGS_PAGES.find((page) => isActivePath(pathname, page.href)) ?? null;
}

/**
 * Top bar trail of a path: its section and, in Ajustes, the page («Ajustes › IA»). «Mi cuenta» is outside /ajustes,
 * so its section comes from being a settings page, not from its address.
 */
export function trailForPath(pathname: string): { section: NavSection; page: SettingsPage | null } | null {
  const page = settingsPageForPath(pathname);
  const section = sectionForPath(page ? SETTINGS_HREF : pathname);
  return section ? { section, page } : null;
}
