// IMAP and SMTP failures in Spanish, with what they mean for the channel ([COR-11], [COR-22]): wrong user or
// password (or the password changed) → «Requiere reconexión»; unknown host, closed port, TLS problems, timeouts. The
// server's own text never reaches the person or the logs (it may echo the user name).
import "server-only";
import { AppError } from "@/server/errors";

export type MailErrorInfo = { message: string; reconnect: boolean; retryable: boolean };

const AUTH: MailErrorInfo = {
  message: "El usuario o la contraseña no son correctos. Si tu proveedor lo pide, usa una contraseña de aplicación.",
  reconnect: true,
  retryable: false,
};
const NOT_FOUND: MailErrorInfo = { message: "No se encuentra el servidor. Revisa la dirección.", reconnect: false, retryable: false };
const REFUSED: MailErrorInfo = { message: "El servidor rechaza la conexión en ese puerto. Revisa el puerto y la seguridad.", reconnect: false, retryable: true };
const TIMEOUT: MailErrorInfo = { message: "El servidor no responde. Revisa la dirección y el puerto.", reconnect: false, retryable: true };
const TLS: MailErrorInfo = {
  message: "No se puede establecer una conexión segura. Revisa la seguridad (SSL/TLS o STARTTLS) y que el certificado del servidor sea válido.",
  reconnect: false,
  retryable: false,
};
const DROPPED: MailErrorInfo = { message: "Se ha cortado la conexión con el servidor de correo. Lo reintentamos.", reconnect: false, retryable: true };
const RECIPIENT: MailErrorInfo = { message: "El servidor de correo no acepta el destinatario.", reconnect: false, retryable: false };
const UNKNOWN: MailErrorInfo = { message: "No se ha podido conectar con el servidor de correo.", reconnect: false, retryable: true };

const TLS_CODES = ["ETLS", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"];

function field(error: unknown, name: string): unknown {
  return error && typeof error === "object" && name in error ? (error as Record<string, unknown>)[name] : undefined;
}

export function describeMailError(error: unknown): MailErrorInfo {
  if (error instanceof AppError) return { message: error.userMessage, reconnect: false, retryable: false };
  const code = String(field(error, "code") ?? "");
  const responseCode = Number(field(error, "responseCode"));
  if (field(error, "authenticationFailed") === true || code === "EAUTH" || responseCode === 535 || responseCode === 534) return AUTH;
  if (code === "ENOTFOUND" || code === "EDNS" || code === "EAI_AGAIN") return NOT_FOUND;
  if (code === "ECONNREFUSED") return REFUSED;
  if (code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT" || code === "ETIMEOUT" || code === "GreetingTimeout" || code === "UPGRADE_TIMEOUT") return TIMEOUT;
  if (code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || TLS_CODES.includes(code)) return TLS;
  if (code === "EENVELOPE" || (responseCode >= 550 && responseCode <= 553)) return RECIPIENT;
  if (code === "ECONNRESET" || code === "ESOCKET" || code === "NoConnection" || code === "EPIPE" || code === "ECONNECTION") return DROPPED;
  return UNKNOWN;
}
