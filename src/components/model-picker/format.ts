// Pure helpers of the model picker: prices, context size, search and the order of the list ([MOD-03], [MOD-04]).
import { formatCurrencyUSD, formatNumber } from "@/lib/format";
import type { ModelOption } from "./types";

const MILLION = 1_000_000;
const THOUSAND = 1_000;

/** «OpenAI: GPT-5.6 Luna» → «GPT-5.6 Luna» (the provider is shown apart). */
export function shortModelName(name: string): string {
  const separator = name.indexOf(": ");
  return separator > 0 ? name.slice(separator + 2).trim() || name : name;
}

/** «1,05 M», «128 k» or «900» tokens of context. */
export function formatContextLength(tokens: number): string {
  if (tokens >= MILLION) return `${formatNumber(tokens / MILLION, { maximumFractionDigits: 2 })} M`;
  if (tokens >= THOUSAND) return `${formatNumber(Math.round(tokens / THOUSAND))} k`;
  return formatNumber(tokens);
}

/**
 * Price parts of an option, in USD: «Entrada 0,20 US$/M» and «Salida 1,20 US$/M»; one part when there is no output
 * price (embeddings) or it is charged by second of audio (docs/integracion-openrouter.md §2.4).
 */
export function formatModelPrice(option: Pick<ModelOption, "pricePrompt" | "priceCompletion" | "priceUnit">): string[] {
  const { pricePrompt, priceCompletion, priceUnit } = option;
  if (pricePrompt === null && priceCompletion === null) return ["Precio no disponible"];
  if (pricePrompt === 0 && (priceCompletion ?? 0) === 0) return ["Gratis"];
  const unit = priceUnit === "second" ? "/s" : "/M";
  if (priceCompletion === null || priceCompletion === 0) return [`${formatCurrencyUSD(pricePrompt ?? 0)}${unit}`];
  return [`Entrada ${formatCurrencyUSD(pricePrompt ?? 0)}${unit}`, `Salida ${formatCurrencyUSD(priceCompletion)}${unit}`];
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Search of the picker (cmdk filter): every word typed must appear in the id, the name or the provider, in any
 * order and without accents. 1 = shown, 0 = hidden; the list keeps its own order.
 */
export function matchesModelSearch(value: string, search: string, keywords: readonly string[] = []): number {
  const words = normalize(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const haystack = normalize([value, ...keywords].join(" "));
  return words.every((word) => haystack.includes(word)) ? 1 : 0;
}

export type GroupedModelOptions = {
  /** The option of `value`, if the list has it (it may be retiring). */
  selected: ModelOption | null;
  /** `value` is set but the list does not have it: it disappeared or cannot be offered ([MOD-06]). */
  missing: boolean;
  /** The selected option when it is not offered any more (retiring), shown apart as «Modelo actual». */
  current: ModelOption | null;
  /** «Modelos recomendados» that are available, in the order of Ajustes › IA ([MOD-04]). */
  recommended: ModelOption[];
  /** The rest, in the server's order (by name). */
  others: ModelOption[];
};

/** Splits the options into the groups of the list. Retiring models are never offered, only kept as the current one. */
export function groupModelOptions(options: readonly ModelOption[], value: string, recommendedIds: readonly string[]): GroupedModelOptions {
  const selected = options.find((option) => option.id === value) ?? null;
  const offered = options.filter((option) => option.expiresOn === null);
  const byId = new Map(offered.map((option) => [option.id, option]));
  const recommended = [...new Set(recommendedIds)].flatMap((id) => byId.get(id) ?? []);
  const recommendedSet = new Set(recommended.map((option) => option.id));
  return {
    selected,
    missing: value !== "" && selected === null,
    current: selected && selected.expiresOn !== null ? selected : null,
    recommended,
    others: offered.filter((option) => !recommendedSet.has(option.id)),
  };
}
