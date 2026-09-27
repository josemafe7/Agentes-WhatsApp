// Words of the Informes screen. Pure: used by the page, the export and the client components.
import type { HandoffOrigin } from "@/data/reports";

/** DESIGN.md «Informes (gráficos)»: inside the frame of a chart without data. */
export const NO_DATA = "Todavía no hay datos de este periodo";

/** What started a hand-off ([TRA-01]). */
export const ORIGIN_LABELS: Record<HandoffOrigin, string> = {
  ai_tool: "La IA, con su herramienta",
  keyword: "Regla: palabra clave",
  sensitive_topic: "Regla: tema sensible",
  unknown_answers: "Regla: la IA no sabía responder",
  ai_failure: "La IA no pudo responder",
  send_failed: "No se pudo enviar la respuesta",
  other_rule: "Otra regla del agente",
  human: "Una persona, a mano",
};

/** A hand-off saved without a reason. */
export const NO_REASON = "Sin motivo";
/** The reasons beyond the most frequent ones ([INF-04]). */
export const OTHER_REASONS = "Otros motivos";

/** [CUM-11]: why the share under 3 minutes matters (spec [CUM-02] and [CUM-11], Ley 10/2025). */
export const RESPONSE_LAW_NOTE =
  "La Ley 10/2025 exige a las grandes empresas y a las de servicios básicos atender el 95 % de las peticiones de atención personalizada en menos de 3 minutos, desde el 28 de diciembre de 2026.";
