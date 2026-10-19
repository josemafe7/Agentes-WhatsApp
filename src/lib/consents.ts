// What a contact's consents say now ([CTO-08]–[CTO-10], [CUM-03], [CUM-13]): the two permissions («Avisos de sus
// citas» and «Novedades y publicidad») and the bajas in force on each kind of channel (of everything, or of novedades y
// publicidad only). The newest record of each family decides, by when it was recorded (never by when the customer
// says they gave it, so an old date cannot undo a later baja). Pure: the server loads the rows, the screens show them.
import type { ChannelKind, ConsentMethod, ConsentType, ContactPermission } from "./enums";

export type ConsentRecord = {
  id: string;
  type: ConsentType;
  /** The kind a baja applies to; null for the permissions and for a row whose kind cannot be known. */
  kind: ChannelKind | null;
  createdAt: Date;
  givenAt: Date | null;
  method: ConsentMethod | null;
  source: string;
  recordedByName: string | null;
  note: string | null;
  evidence: { question: string; answer: string } | null;
};

export type OptOutScope = "all" | "marketing";
type OptOutState = Record<OptOutScope, ConsentRecord | null>;

export type ConsentState = {
  /** The newest record of each permission (given or withdrawn), or null if it never had one. */
  permissions: Record<ContactPermission, ConsentRecord | null>;
  /** The baja in force on each kind of channel, of everything and of novedades y publicidad. */
  optOuts: Record<ChannelKind, OptOutState>;
};

const KINDS: ChannelKind[] = ["whatsapp", "email", "webchat", "telegram", "instagram"];
const PERMISSION_TYPES: Record<ContactPermission, { granted: ConsentType; withdrawn: ConsentType }> = {
  reminders: { granted: "reminders_granted", withdrawn: "reminders_withdrawn" },
  marketing: { granted: "marketing_granted", withdrawn: "marketing_withdrawn" },
};
const OPT_OUT_TYPES: Record<OptOutScope, { out: ConsentType; back: ConsentType }> = {
  all: { out: "opt_out", back: "opt_in" },
  marketing: { out: "marketing_opt_out", back: "marketing_opt_in" },
};

export function permissionTypes(permission: ContactPermission) {
  return PERMISSION_TYPES[permission];
}
export function optOutTypes(scope: OptOutScope) {
  return OPT_OUT_TYPES[scope];
}

function newest(rows: readonly ConsentRecord[], types: readonly ConsentType[], kind?: ChannelKind): ConsentRecord | null {
  let found: ConsentRecord | null = null;
  for (const row of rows) {
    if (!types.includes(row.type) || (kind !== undefined && row.kind !== kind)) continue;
    if (!found || row.createdAt.getTime() >= found.createdAt.getTime()) found = row;
  }
  return found;
}

export function consentStateOf(rows: readonly ConsentRecord[]): ConsentState {
  const permissions = {} as ConsentState["permissions"];
  for (const permission of ["reminders", "marketing"] as const) {
    const { granted, withdrawn } = PERMISSION_TYPES[permission];
    permissions[permission] = newest(rows, [granted, withdrawn]);
  }
  const optOuts = {} as ConsentState["optOuts"];
  for (const kind of KINDS) {
    const state = { all: null, marketing: null } as OptOutState;
    for (const scope of ["all", "marketing"] as const) {
      const { out, back } = OPT_OUT_TYPES[scope];
      const latest = newest(rows, [out, back], kind);
      state[scope] = latest?.type === out ? latest : null;
    }
    optOuts[kind] = state;
  }
  return { permissions, optOuts };
}

/**
 * Whether the permission is given now. «Avisos de sus citas» se da por hecho (decision 0030): given until its newest
 * record withdraws it; «Novedades y publicidad», only when its newest record is a «sí» ([CTO-09]).
 */
export function hasPermission(state: ConsentState, permission: ContactPermission): boolean {
  const record = state.permissions[permission];
  if (permission === "reminders") return record?.type !== PERMISSION_TYPES.reminders.withdrawn;
  return record?.type === PERMISSION_TYPES[permission].granted;
}

/**
 * What a message is for: a conversation (the AI and the notices of a booking), a reminder or a utility template, or
 * novedades y publicidad (a marketing template or an envío).
 */
export type SendPurpose = "conversation" | "reminder" | "marketing";

export type BlockReason = "opted_out" | "marketing_opted_out" | "no_reminders_permission" | "no_marketing_permission";

/**
 * Why nothing of that purpose may go to the contact through that kind of channel, or null: a baja of everything stops
 * all of it; a baja of novedades y publicidad, only that; WhatsApp and Telegram reminders stop when «Avisos de sus
 * citas» was withdrawn (email does not look at it, [AGD-24]); novedades y publicidad needs its permission on every
 * channel ([CTO-09], [WA-61]).
 */
export function blockReason(state: ConsentState, kind: ChannelKind, purpose: SendPurpose): BlockReason | null {
  if (state.optOuts[kind].all) return "opted_out";
  if (purpose === "reminder" && (kind === "whatsapp" || kind === "telegram") && !hasPermission(state, "reminders")) return "no_reminders_permission";
  if (purpose === "marketing") {
    if (state.optOuts[kind].marketing) return "marketing_opted_out";
    if (!hasPermission(state, "marketing")) return "no_marketing_permission";
  }
  return null;
}

export const BLOCK_REASON_TEXT: Record<BlockReason, string> = {
  opted_out: "Se ha dado de baja en este canal",
  marketing_opted_out: "Se ha dado de baja de novedades y publicidad en este canal",
  no_reminders_permission: "No quiere avisos de sus citas",
  no_marketing_permission: "Sin permiso de novedades y publicidad",
};

export const PERMISSION_LABELS: Record<ContactPermission, string> = {
  reminders: "Avisos de sus citas",
  marketing: "Novedades y publicidad",
};

export const CONSENT_METHOD_LABELS: Record<ConsentMethod, string> = {
  in_person: "En persona",
  written: "Por escrito",
  web: "En la web",
  conversation: "En la conversación",
  imported: "Importado",
  other: "Otro",
};

export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  whatsapp: "WhatsApp",
  email: "Correo",
  webchat: "Chat web",
  telegram: "Telegram",
  instagram: "Instagram",
};

/** The kinds a baja «para todos los canales» covers ([CTO-10]). */
export const OPT_OUT_KINDS: ChannelKind[] = KINDS;
