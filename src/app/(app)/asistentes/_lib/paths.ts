// Routes of «Asistentes» ([INT-06]). One page per internal agent; the conversation that is open goes in `?c=`, so
// the address changes when the first question starts one without the page loading again.
export const ASSISTANTS_PATH = "/asistentes";
export const CHAT_PARAM = "c";

export function assistantPath(agentId: string, chatId?: string | null): string {
  const base = `${ASSISTANTS_PATH}/${encodeURIComponent(agentId)}`;
  return chatId ? `${base}?${CHAT_PARAM}=${encodeURIComponent(chatId)}` : base;
}
