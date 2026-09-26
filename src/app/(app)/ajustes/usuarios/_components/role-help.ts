import type { Role } from "@/lib/enums";

/** One line per role under the role selector, from «Quién puede hacer qué» of docs/spec.md. */
export const ROLE_HELP: Record<Role, string> = {
  owner: "Todo, incluido traspasar la propiedad. Siempre hay exactamente uno.",
  admin: "Todo salvo tocar al propietario o traspasar la propiedad.",
  supervisor: "Bandeja, contactos, agenda, conocimiento e informes. Sin canales ni ajustes.",
  agent: "Atiende las conversaciones y los contactos de sus canales, y la agenda.",
  viewer: "Ve la bandeja, los contactos, la agenda, los agentes, el conocimiento y los informes, sin cambiar nada.",
};
