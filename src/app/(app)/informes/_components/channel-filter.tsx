"use client";

// The channel filter of Informes (docs/pantallas.md «Informes»): every channel, or one; the period stays.
import { useRouter } from "next/navigation";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ChannelType } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { reportsHref, withChannel, type ReportsQuery } from "../_lib/search-params";

const ALL_CHANNELS = "todos";

export function ChannelFilter({ query, channels }: { query: ReportsQuery; channels: { id: string; name: string; type: ChannelType }[] }) {
  const router = useRouter();
  return (
    <Select value={query.channelId ?? ALL_CHANNELS} onValueChange={(value) => router.push(reportsHref(withChannel(query, value === ALL_CHANNELS ? null : value)))}>
      <SelectTrigger aria-label="Canal" className="w-full sm:w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_CHANNELS}>Todos los canales</SelectItem>
        {channels.map((channel) => {
          const { icon: Icon, iconClassName, label } = CHANNEL_IDENTITY[channel.type];
          return (
            <SelectItem key={channel.id} value={channel.id}>
              <Icon aria-hidden className={cn("size-4", iconClassName)} />
              <span className="sr-only">{label}: </span>
              {channel.name}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
