// Names and texts of the wizard steps (docs/pantallas.md «Asistente de arranque»). Pure data: the numbers match
// SETUP_STEP in src/data/setup.ts and each step's form is plugged in by _steps/registry.tsx.

export type SetupStepId = "propietario" | "negocio" | "horario" | "ia" | "agente" | "chat-web" | "canales";

export type SetupStepInfo = {
  number: number;
  id: SetupStepId;
  /** Short name in the stepper. */
  label: string;
  title: string;
  description: string;
};

export const SETUP_STEPS: readonly SetupStepInfo[] = [
  {
    number: 1,
    id: "propietario",
    label: "Propietario",
    title: "Crea tu cuenta de propietario",
    description: "Con ella administras la app. Después podrás invitar a tu equipo desde Ajustes.",
  },
  {
    number: 2,
    id: "negocio",
    label: "Negocio",
    title: "Tu negocio y su sector",
    description:
      "El sector carga datos de partida que luego puedes editar: palabras de la agenda, servicios, recursos, modo de agenda, plantilla de agente y preguntas frecuentes.",
  },
  {
    number: 3,
    id: "horario",
    label: "Horario",
    title: "Horario, festivos y zona horaria",
    description: "Marca cuándo abres. Puedes poner varios tramos el mismo día y los días que cierras.",
  },
  {
    number: 4,
    id: "ia",
    label: "IA",
    title: "Conecta la IA",
    description:
      "Pega tu clave de OpenRouter y elige el modelo de chat. Puedes hacerlo más tarde: sin clave, todo funciona salvo la IA.",
  },
  {
    number: 5,
    id: "agente",
    label: "Primer agente",
    title: "Tu primer agente",
    description: "El agente de IA que contestará a tus clientes, creado a partir de la plantilla de tu sector.",
  },
  {
    number: 6,
    id: "chat-web",
    label: "Chat web",
    title: "Chat web de prueba",
    description: "Un chat para tu web con tu agente, que puedes probar aquí mismo.",
  },
  {
    number: 7,
    id: "canales",
    label: "Canales",
    title: "Conecta tus canales",
    description: "Conecta WhatsApp y el correo ahora o cuando quieras desde Canales.",
  },
];

export function setupStepInfo(step: number): SetupStepInfo {
  const info = SETUP_STEPS.find((candidate) => candidate.number === step);
  if (!info) throw new Error(`Paso del asistente desconocido: ${step}`);
  return info;
}
