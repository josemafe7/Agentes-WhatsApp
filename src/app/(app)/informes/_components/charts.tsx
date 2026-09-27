"use client";

// The four charts of Informes (DESIGN.md «Informes (gráficos)»): shadcn's Chart with Recharts and its accessibility
// layer, bars only, one axis, horizontal grid lines only, a legend when there is more than one series and tooltips with
// the exact value in Spanish. Colours by meaning: channels in their identity colour, hand-offs in --warning, people in
// --primary, AI costs in --primary and WhatsApp in its colour, lighter, as «estimado». Each chart has «Ver datos».
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCurrencyUSD, formatNumber } from "@/lib/format";
import { formatDuration } from "../_lib/format";
import type { ChannelBar, CostBar, OriginBar, ResponseBar } from "../_lib/view";

const MINUTE_MS = 60_000;
const TARGET_MINUTES = 3;
const ROW_HEIGHT = 44;
const MIN_BARS_HEIGHT = 140;
const CATEGORY_WIDTH = 170;
const MAX_CATEGORY_CHARS = 24;
const COLUMN_CHART_HEIGHT = 260;
const WHATSAPP_ESTIMATE_OPACITY = 0.5;

const tick = { fontSize: 12 };

function shorten(text: string): string {
  return text.length > MAX_CATEGORY_CHARS ? `${text.slice(0, MAX_CATEGORY_CHARS - 1)}…` : text;
}

/** Height of a chart of horizontal bars: one row per category. */
function barsHeight(rows: number): number {
  return Math.max(MIN_BARS_HEIGHT, rows * ROW_HEIGHT + 24);
}

/** One line of a tooltip: colour, name and the value in Spanish. */
function tooltipLine(name: ReactNode, value: string, color: unknown) {
  return (
    <>
      <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: typeof color === "string" ? color : undefined }} />
      <span className="text-muted-foreground">{name}</span>
      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{value}</span>
    </>
  );
}

const asNumber = (value: unknown) => (typeof value === "number" ? value : Number(value));

const channelConfig = {
  conversations: { label: "Conversaciones" },
  whatsapp: { label: "WhatsApp", color: "var(--channel-whatsapp)" },
  email: { label: "Correo", color: "var(--channel-email)" },
  web: { label: "Chat web", color: "var(--channel-web)" },
  telegram: { label: "Telegram", color: "var(--channel-telegram)" },
} satisfies ChartConfig;

/** [INF-02] Conversations of each channel, in the channel's colour. */
export function ChannelsChart({ data }: { data: ChannelBar[] }) {
  const rows = data.map((row) => ({ ...row, fill: `var(--color-${row.colorKey})` }));
  return (
    <ChartContainer config={channelConfig} className="aspect-auto w-full" style={{ height: barsHeight(rows.length) }}>
      <BarChart accessibilityLayer title="Conversaciones por canal" data={rows} layout="vertical" margin={{ left: 4, right: 40 }}>
        <XAxis type="number" dataKey="conversations" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={CATEGORY_WIDTH} tickLine={false} axisLine={false} tick={tick} tickFormatter={shorten} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => tooltipLine(item.payload?.name, formatNumber(asNumber(value)), item.payload?.fill)}
            />
          }
        />
        <Bar dataKey="conversations" radius={4} isAnimationActive={false}>
          <LabelList dataKey="conversations" position="right" className="fill-foreground" fontSize={12} formatter={(value: unknown) => formatNumber(asNumber(value))} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

const originConfig = { count: { label: "Traspasos", color: "var(--warning)" } } satisfies ChartConfig;

/** [INF-04] Hand-offs by what started them. */
export function OriginsChart({ data }: { data: OriginBar[] }) {
  return (
    <ChartContainer config={originConfig} className="aspect-auto w-full" style={{ height: barsHeight(data.length) }}>
      <BarChart accessibilityLayer title="Traspasos por motivo" data={data} layout="vertical" margin={{ left: 4, right: 40 }}>
        <XAxis type="number" dataKey="count" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={CATEGORY_WIDTH} tickLine={false} axisLine={false} tick={tick} tickFormatter={shorten} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel formatter={(value, _name, item) => tooltipLine(item.payload?.label, formatNumber(asNumber(value)), "var(--color-count)")} />}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} isAnimationActive={false}>
          <LabelList dataKey="count" position="right" className="fill-foreground" fontSize={12} formatter={(value: unknown) => formatNumber(asNumber(value))} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

const responseConfig = { minutes: { label: "Mediana", color: "var(--primary)" } } satisfies ChartConfig;

/** [INF-05] [CUM-11] Median time until the first human answer, with the 3-minute line. */
export function ResponseChart({ data }: { data: ResponseBar[] }) {
  return (
    <ChartContainer config={responseConfig} className="aspect-auto w-full" style={{ height: COLUMN_CHART_HEIGHT }}>
      <BarChart accessibilityLayer title="Primera respuesta humana" data={data} margin={{ top: 16, left: 4, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} minTickGap={12} />
        <YAxis tickLine={false} axisLine={false} tick={tick} width={56} allowDecimals={false} tickFormatter={(value: number) => `${formatNumber(value)} min`} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => payload[0]?.payload?.fullLabel}
              formatter={(value, _name, item) =>
                tooltipLine(`Mediana (${formatNumber(asNumber(item.payload?.answered))} atendidos)`, formatDuration(asNumber(value) * MINUTE_MS), "var(--color-minutes)")
              }
            />
          }
        />
        <ReferenceLine
          y={TARGET_MINUTES}
          ifOverflow="extendDomain"
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          label={{ value: "3 min", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 12 }}
        />
        <Bar dataKey="minutes" fill="var(--color-minutes)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

const costConfig = {
  ai: { label: "IA", color: "var(--primary)" },
  whatsapp: { label: "WhatsApp (estimado)", color: "var(--channel-whatsapp)" },
} satisfies ChartConfig;

/** [INF-07] AI cost as OpenRouter reported it and WhatsApp's estimate, month by month, in US$. */
export function CostsChart({ data }: { data: CostBar[] }) {
  return (
    <ChartContainer config={costConfig} className="aspect-auto w-full" style={{ height: COLUMN_CHART_HEIGHT }}>
      <BarChart accessibilityLayer title="Costes por mes" data={data} margin={{ top: 8, left: 4, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} />
        <YAxis tickLine={false} axisLine={false} tick={tick} width={80} tickFormatter={(value: number) => formatCurrencyUSD(value)} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => payload[0]?.payload?.fullLabel}
              formatter={(value, name, item) =>
                tooltipLine(name === "whatsapp" ? costConfig.whatsapp.label : costConfig.ai.label, formatCurrencyUSD(asNumber(value)), item.color)
              }
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="ai" fill="var(--color-ai)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="whatsapp" fill="var(--color-whatsapp)" fillOpacity={WHATSAPP_ESTIMATE_OPACITY} stroke="var(--color-whatsapp)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
