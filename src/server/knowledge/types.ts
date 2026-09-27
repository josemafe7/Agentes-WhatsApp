// Shared shapes of the knowledge module (no runtime code: safe to import from anywhere on the server).

/**
 * A knowledge fragment used in an answer ([CON-20], [PRU-02]): what «¿Por qué respondió esto?» and «Probar agente»
 * show. Title, section and page are copies (the chunk may be gone after a re-index). Same shape as
 * `AgentRetrieval` of src/server/ai/run-agent.ts and the rows of message_retrievals.
 */
export type KnowledgeRetrieval = {
  chunkId: string | null;
  documentId: string | null;
  kbId: string | null;
  /** 1 = most relevant, unique within one answer. */
  rank: number;
  score: number | null;
  title: string | null;
  section: string | null;
  page: number | null;
};
