// «Simular canal» ([PRU-03]): the three channels the tester can pretend to write from, with DESIGN.md's icons.
import { Globe, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import type { SimulatedChannel } from "@/server/ai/prompt";

export const SIMULATED_CHANNEL_OPTIONS: readonly { value: SimulatedChannel; label: string; icon: LucideIcon }[] = [
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { value: "email", label: "Correo", icon: Mail },
  { value: "webchat", label: "Chat web", icon: Globe },
];

export function simulatedChannelLabel(channel: SimulatedChannel): string {
  return SIMULATED_CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel;
}

export function isSimulatedChannel(value: string): value is SimulatedChannel {
  return SIMULATED_CHANNEL_OPTIONS.some((option) => option.value === value);
}
