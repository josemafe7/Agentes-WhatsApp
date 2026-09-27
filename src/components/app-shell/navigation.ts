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
  permission: Action;
};

/** Settings sub-navigation, in order. Permissions from «Quién puede hacer qué» ([PER-03], [PER-04]). */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    key: "negocio",
    label: "Negocio",
    href: "/ajustes/negocio",
    icon: Store,
    description: "Nombre, logo, color, sector, zona horaria y datos de contacto.",
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "usuarios",
    label: "Usuarios",
    href: "/ajustes/usuarios",
    icon: UsersRound,
    description: "Equipo, invitaciones, roles y verificación en dos pasos.",
    permission: PERMISSIONS.settings.users,
  },
  {
    key: "horario",
    label: "Horario",
    href: "/ajustes/horario",
    icon: Clock,
    description: "Horario semanal, festivos y cierres.",
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "ia",
    label: "IA",
    href: "/ajustes/ia",
    icon: Sparkles,
    description: "Clave de OpenRouter, modelos por defecto y privacidad de la IA.",
    permission: PERMISSIONS.settings.integrations,
  },
  {
    key: "correo",
    label: "Correo del sistema",
    href: "/ajustes/correo",
    icon: Mail,
    description: "Servidor de correo para invitaciones, recuperación de contraseña y avisos.",
    permission: PERMISSIONS.settings.integrations,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    href: "/ajustes/whatsapp",
    icon: MessageCircle,
    description: "Tarifas por mensaje de Meta y dirección de avisos de la instalación.",
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "privacidad",
    label: "Privacidad y legal",
    href: "/ajustes/privacidad",
    icon: ShieldCheck,
    description: "Textos legales, aviso de IA y plazos de conservación.",
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "notificaciones",
    label: "Notificaciones",
    href: "/ajustes/notificaciones",
    icon: Bell,
    description: "Qué sucesos avisan y a quién.",
    permission: PERMISSIONS.settings.business,
  },
  {
    key: "recordatorios",
    label: "Recordatorios",
    href: "/ajustes/recordatorios",
    icon: BellRing,
    description: "Aviso a los clientes antes de su cita, por WhatsApp o por email.",
    permission: PERMISSIONS.agenda.configure,
  },
  {
    key: "actividad",
    label: "Registro de actividad",
    href: "/ajustes/actividad",
    icon: ScrollText,
    description: "Lo que hacen las personas y la IA en la app.",
    permission: PERMISSIONS.settings.auditLog,
  },
  {
    key: "diagnostico",
    label: "Diagnóstico",
    href: "/ajustes/diagnostico",
    icon: Activity,
    description: "Estado de la base de datos, de la cola de trabajo y de los envíos.",
    permission: PERMISSIONS.settings.diagnostics,
  },
  {
    key: "cuenta",
    label: "Mi cuenta",
    href: ACCOUNT_HREF,
    icon: UserRound,
    description: "Tu nombre, tu contraseña y la verificación en dos pasos.",
    permission: PERMISSIONS.account.self,
  },
  {
    key: "acerca",
    label: "Acerca de",
    href: "/ajustes/acerca",
    icon: Info,
    description: "Versión de la app y enlace a la Ayuda.",
    permission: PERMISSIONS.account.self,
  },
];

/** The eight sections: Bandeja, Contactos, Agenda | Agentes, Conocimiento, Canales | Informes, Ajustes. */
export const SECTIONS: readonly NavSection[] = [
  { key: "bandeja", label: "Bandeja", href: "/bandeja", icon: Inbox, group: 0, anyOf: [PERMISSIONS.inbox.view] },
  { key: "contactos", label: "Contactos", href: "/contactos", icon: Users, group: 0, anyOf: [PERMISSIONS.contacts.view] },
  { key: "agenda", label: "Agenda", href: "/agenda", icon: CalendarDays, group: 0, anyOf: [PERMISSIONS.agenda.view] },
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

/** Sections of the menu the actor may open (area-level check; each page checks the record again). */
export function visibleSections(actor: Actor | null): NavSection[] {
  if (!actor) return [];
  return SECTIONS.filter((section) => section.anyOf.some((action) => can(actor, action)));
}

/** Sections split in their groups, without empty groups. */
export function groupSections(sections: readonly NavSection[]): NavSection[][] {
  const groups: NavSection[][] = [[], [], []];
  for (const section of sections) groups[section.group].push(section);
  return groups.filter((group) => group.length > 0);
}

/** Settings pages the actor may open, in sub-navigation order. */
export function visibleSettingsPages(actor: Actor | null): SettingsPage[] {
  if (!actor) return [];
  return SETTINGS_PAGES.filter((page) => can(actor, page.permission));
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

/** Settings page of a path (not the settings index). */
export function settingsPageForPath(pathname: string): SettingsPage | null {
  return (
    SETTINGS_PAGES.find((page) => page.href.startsWith(`${SETTINGS_HREF}/`) && isActivePath(pathname, page.href)) ?? null
  );
}
