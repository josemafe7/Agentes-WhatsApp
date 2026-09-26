// Text shared by several sector templates. Each preset can still override it.

/** Phrases that hand the conversation to a person ([TRA-01]). Never single words like «persona» («para dos personas»). */
export const COMMON_HANDOFF_KEYWORDS = [
  "hablar con una persona",
  "hablar con alguien",
  "persona real",
  "humano",
  "encargado",
  "encargada",
  "queja",
  "reclamación",
  "hoja de reclamaciones",
];

export const COMMON_HANDOFF_MESSAGES = {
  messageInHours: "Te paso con una persona del equipo, que te contestará por aquí en cuanto pueda.",
  messageOffHours:
    "Ahora mismo estamos cerrados. He pasado tu mensaje al equipo y te contestarán por aquí en cuanto abramos.",
};

/** Rules every template repeats in its own words: never invent data and always offer a person ([CUM-02]). */
export const NEVER_INVENT =
  "No inventes precios, horarios, huecos ni políticas: consúltalos siempre en la información del negocio y en tus herramientas. Si no lo sabes, dilo y ofrece pasar con una persona.";
export const NO_SENSITIVE_DATA = "No pidas números de tarjeta, contraseñas ni documentos de identidad.";
