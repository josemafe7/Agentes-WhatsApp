// WhatsApp by QR code: what the rest of the app uses. The registry gives its adapter to the WhatsApp channels whose
// `connection_mode` is «qr» (src/server/channels/registry.ts); the sessions are opened when the server starts
// (src/instrumentation.ts) and screens go through src/data/whatsapp-qr.ts, never through this module directly. Nothing
// exported here brings the library with it: it loads the first time a session is needed (runtime.ts).
import "server-only";

export { createWhatsAppQrAdapter, loadQrDestination, whatsappQrAdapter, type WhatsAppQrAdapterDeps } from "./adapter";
export { qrDisplayNumber, qrPhoneNumberId, readWhatsAppQrConfig, WhatsAppQrNotConnectedError, whatsappQrUnsupportedReason, type WhatsAppQrConfig } from "./config";
export { QR_NOT_OPEN, QR_SESSION_LOST, WHATSAPP_QR_HEALTH_LABELS, whatsappQrHealth, type WhatsAppQrHealthKey } from "./health";
export { askQrHost, performQrRequest, QR_HOST_PATH, qrHostRequestSchema, requestOfQrHost, type QrHostAnswer, type QrHostRequest } from "./host";
export { isPersonJid, jidOfIdentity, normalizeJid, normalizeQrMessage, QR_JID_METADATA_KEY } from "./normalize";
export { existingQrSupervisor, qrSupervisor, type QrOutbound, type QrSendResult, type QrSessionState, type QrSessionStatus, type QrSupervisor } from "./runtime";
