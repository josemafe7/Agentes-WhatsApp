// The sections of Ajustes › Diagnóstico ([AJU-11]) in the order of the page: the id each one answers to in a link
// (/ajustes/diagnostico#bandeja-local, #errores-recientes…) and its title. Pure: shared by the cards of the page and
// the summary that links to them.
export const DIAGNOSTICS_SECTIONS = {
  database: { id: "base-de-datos", title: "Base de datos" },
  queue: { id: "trabajo-en-segundo-plano", title: "Trabajo en segundo plano" },
  aiErrors: { id: "errores-recientes", title: "Errores recientes de la IA" },
  webhooks: { id: "ultimo-aviso-por-canal", title: "Último aviso por canal" },
  ignoredMail: { id: "correos-ignorados", title: "Correos ignorados" },
  realtime: { id: "tiempo-real", title: "Tiempo real" },
  emails: { id: "bandeja-local", title: "Correos del sistema" },
  connectionTests: { id: "pruebas-de-conexion", title: "Pruebas de conexión" },
  simulator: { id: "simulador-de-canales", title: "Simulador de canales" },
} as const;

export type DiagnosticsSectionKey = keyof typeof DIAGNOSTICS_SECTIONS;
