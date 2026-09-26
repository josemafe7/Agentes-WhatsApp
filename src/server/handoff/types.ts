// Hand-off to a person ([TRA-01]–[TRA-09]): the contract the AI tool, the agent rules and the inbox use. The
// implementation (status «Pendiente de humano», assignment, notices, handoff_events) arrives with the inbox phase
// and registers itself with registerHandoffService() (src/server/handoff/index.ts).
import type { HandoffTrigger, Urgency } from "@/lib/enums";

export type HandoffRequest = {
  conversationId: string;
  /** Agent that was answering, if any. */
  agentId: string | null;
  /** ai_tool = transferir_a_humano; rule = keywords, «no lo sé» or sensitive topic; human = a person by hand. */
  trigger: HandoffTrigger;
  /** For rule hand-offs: keyword, unknown_answers or sensitive_topic. */
  rule?: string | null;
  reason: string;
  summary: string;
  urgency: Urgency;
  triggeredByUserId?: string | null;
  /**
   * The agent's hand-off message for the customer, already chosen for inside or outside opening hours ([TRA-03]).
   * The service does not send it: the reply engine sends it as the single reply of the turn ([MOT-10]).
   */
  customerMessage: string | null;
  requestedAt: Date;
};

export type HandoffResult = {
  /** Row of handoff_events. */
  handoffId: string;
  /** Person it was assigned to, or null when left unassigned ([TRA-04]). */
  assignedUserId: string | null;
};

export interface HandoffService {
  /** Moves the conversation to «Pendiente de humano», assigns it and notifies the team. Idempotent per conversation. */
  requestHandoff(request: HandoffRequest): Promise<HandoffResult>;
}
