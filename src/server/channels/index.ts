// Channels: the common adapter contract, the registry by type and the built-in adapters (demo and web chat).
import "server-only";

export { DEFAULT_CAPABILITIES, defaultCapabilitiesOf, webchatCapabilities } from "./capabilities";
export {
  buildSimulatedEvent,
  demoAdapter,
  DEMO_STATUS_JOB,
  demoStatusJobPayload,
  simulatedMessageSchema,
  type DemoStatusJobPayload,
  type SimulatedMessageInput,
} from "./demo-adapter";
export { capabilitiesOf, ChannelAdapterMissingError, getChannelAdapter, getSendAdapter, registerChannelAdapter, unregisterChannelAdapter } from "./registry";
export { encryptChannelSecrets, readChannelSecrets } from "./secrets";
export {
  ChannelSendError,
  type AccountEvent,
  type ChannelAdapter,
  type ChannelCapabilities,
  type ChannelDeliveryStatus,
  type ChannelRecord,
  type ConnectResult,
  type DownloadedMedia,
  type InboundMessageEvent,
  type InboundSender,
  type MediaRef,
  type NormalizedEvent,
  type OutboundMessage,
  type OutboundRecipient,
  type SendResult,
  type StatusUpdateEvent,
  type WebhookInput,
} from "./types";
export { WEBCHAT_MAX_TEXT, webchatAdapter, widgetMessageSchema, widgetMessageToEvent, type WidgetMessageInput } from "./webchat-adapter";
