// Addresses of Conocimiento (docs/pantallas.md «Conocimiento»): the list, one base with its tabs, one document, and
// the route that receives uploaded files.

export const KNOWLEDGE_PATH = "/conocimiento";

/** Header with the original file name (URI-encoded) of an upload; the body is the raw file. */
export const FILE_NAME_HEADER = "x-file-name";

/** Tabs of a base, each with its own route (DESIGN.md «Cabecera de página»). */
export const KNOWLEDGE_BASE_TABS = [
  { key: "documents", label: "Documentos", segment: "" },
  { key: "faq", label: "Preguntas frecuentes", segment: "faq" },
  { key: "test", label: "Probar búsqueda", segment: "probar" },
  { key: "settings", label: "Ajustes", segment: "ajustes" },
] as const;

export type KnowledgeBaseTabKey = (typeof KNOWLEDGE_BASE_TABS)[number]["key"];

export function knowledgeBasePath(kbId: string, segment = ""): string {
  return `${KNOWLEDGE_PATH}/${kbId}${segment ? `/${segment}` : ""}`;
}

export function knowledgeDocumentPath(kbId: string, documentId: string): string {
  return `${knowledgeBasePath(kbId)}/documentos/${documentId}`;
}

/**
 * Uploads go to an API route, not a Server Action: Server Actions take at most 4 MB here (next.config.ts), and the
 * proxy (src/proxy.ts), which does not run on /api/, would keep only the first 10 MB of a bigger body.
 */
export function knowledgeUploadUrl(kbId: string): string {
  return `/api/knowledge/bases/${encodeURIComponent(kbId)}/files`;
}
