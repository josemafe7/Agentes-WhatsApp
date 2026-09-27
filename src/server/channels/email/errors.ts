// What a failure of any email connector means ([COR-22], [BAN-13]): reconnect (and why), a Spanish message safe to
// show, and whether one more try may work. Shared by sending, polling and the health check.
import "server-only";
import { GmailApiError } from "@/lib/google/gmail";
import { GraphApiError } from "@/lib/microsoft/graph";
import { ChannelSendError } from "../types";
import type { EmailChannelType } from "./config";
import { describeMailError } from "./imap/errors";
import { EmailReconnectError } from "./status";
import { RECONNECT_REASONS, reconnectReasonOf } from "./tokens";

export const MAIL_PASSWORD_REASON = "El servidor de correo ya no acepta el usuario o la contraseña (quizá ha cambiado). Vuelve a conectar el buzón.";
const GENERIC = "No se ha podido completar la operación con el buzón. Lo reintentamos.";

export type ProviderFailure = { reconnect: string | null; message: string; retryable: boolean; code?: string | number };

export function describeProviderError(error: unknown, type: EmailChannelType): ProviderFailure {
  if (error instanceof EmailReconnectError) return { reconnect: error.reason, message: error.reason, retryable: false };
  if (error instanceof ChannelSendError) return { reconnect: null, message: error.userMessage, retryable: error.retryable, code: error.channelCode };
  if (error instanceof GmailApiError) {
    // Still 401 after a fresh token: Google no longer accepts this access.
    const reconnect = error.httpStatus === 401 ? RECONNECT_REASONS.googleGrant : null;
    return { reconnect, message: reconnect ?? error.userMessage, retryable: error.retryable, code: error.httpStatus ?? undefined };
  }
  if (error instanceof GraphApiError) {
    const reconnect = error.httpStatus === 401 ? RECONNECT_REASONS.microsoftGrant : null;
    return { reconnect, message: reconnect ?? error.userMessage, retryable: error.retryable, code: error.httpStatus ?? undefined };
  }
  const oauth = reconnectReasonOf(error);
  if (oauth) return { reconnect: oauth, message: oauth, retryable: false };
  if (type === "email_imap") {
    const info = describeMailError(error);
    return info.reconnect ? { reconnect: MAIL_PASSWORD_REASON, message: MAIL_PASSWORD_REASON, retryable: false } : { reconnect: null, message: info.message, retryable: info.retryable };
  }
  return { reconnect: null, message: GENERIC, retryable: true };
}
