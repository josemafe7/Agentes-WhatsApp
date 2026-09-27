// [COR-25] Whether the server that received an email vouched for its sender. The From of an email is whatever the
// sender wrote; the receiving server (Gmail, Exchange Online, most IMAP hosts) checks SPF, DKIM and DMARC and writes
// what it found in an Authentication-Results header (RFC 8601) at the TOP of the message. Only that top header counts:
// anything below it was already in the message when it arrived, so a sender can write one there. Verified = DMARC
// passed for the From domain or, when there is no DMARC result («none»: the domain publishes no policy), SPF or DKIM
// passed for a domain aligned with it. No header, a failure or more than one From: not verified. Pure.

/** At most this many results are read from one header (a real one has three or four). */
const MAX_RESULTS = 50;

export type AuthResult = { method: string; result: string; props: Record<string, string> };
export type ParsedAuthResults = { authservId: string | null; results: AuthResult[] };

export type SenderVerification = { verified: true; method: "dmarc" | "dkim" | "spf" } | { verified: false; reason: "no_from" | "multiple_from" | "no_header" | "dmarc_failed" | "not_aligned" };

/** The text without (comments), which may nest; quoted strings are kept whole. Linear. */
function withoutComments(value: string): string {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "\\" && (quoted || depth > 0)) {
      if (depth === 0) out += value.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (depth === 0 && char === '"') quoted = !quoted;
    if (!quoted && char === "(") {
      depth += 1;
      continue;
    }
    if (!quoted && char === ")" && depth > 0) {
      depth -= 1;
      if (depth === 0) out += " ";
      continue;
    }
    if (depth === 0) out += char;
  }
  return out;
}

/** Splits on `separator` (a single character) or on whitespace outside quoted strings. */
function splitOutsideQuotes(value: string, separator: ";" | "space"): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    const splits = !quoted && (separator === "space" ? /\s/.test(char) : char === separator);
    if (splits) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** «a = b» and «a =b» become «a=b» (RFC 8601 allows spaces around «=»). */
function joinedTokens(segment: string): string[] {
  const tokens: string[] = [];
  for (const token of splitOutsideQuotes(segment, "space")) {
    const last = tokens.length - 1;
    if (last >= 0 && (tokens[last].endsWith("=") || token.startsWith("="))) tokens[last] += token;
    else tokens.push(token);
  }
  return tokens;
}

const unquote = (value: string) => (value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value);

/** One Authentication-Results value: the server's id (Microsoft writes none) and each method with its result. */
export function parseAuthenticationResults(value: string): ParsedAuthResults {
  const segments = splitOutsideQuotes(withoutComments(value), ";");
  let authservId: string | null = null;
  if (segments.length > 0 && !segments[0].includes("=")) authservId = splitOutsideQuotes(segments.shift() ?? "", "space")[0]?.toLowerCase() ?? null;
  const results: AuthResult[] = [];
  for (const segment of segments) {
    if (results.length >= MAX_RESULTS) break;
    const [head, ...rest] = joinedTokens(segment);
    const match = /^([a-z0-9_-]+)(?:\/\d+)?=([a-z0-9_-]+)$/i.exec(head ?? "");
    if (!match) continue;
    const props: Record<string, string> = {};
    for (const token of rest) {
      const at = token.indexOf("=");
      if (at <= 0) continue;
      const key = token.slice(0, at).toLowerCase();
      if (!(key in props)) props[key] = unquote(token.slice(at + 1));
    }
    results.push({ method: match[1].toLowerCase(), result: match[2].toLowerCase(), props });
  }
  return { authservId, results };
}

function domainOf(value: string | undefined): string | null {
  if (!value) return null;
  const domain = (value.includes("@") ? value.slice(value.lastIndexOf("@") + 1) : value).trim().toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9.-]+$/.test(domain) && domain.includes(".") ? domain : null;
}

/**
 * Relaxed alignment (DMARC, RFC 7489 §3.1) without the public suffix list: the same domain, or one inside the other.
 * Never a bare top-level domain.
 */
function aligned(domain: string | null, fromDomain: string): boolean {
  if (!domain) return false;
  return domain === fromDomain || domain.endsWith(`.${fromDomain}`) || fromDomain.endsWith(`.${domain}`);
}

/**
 * Whether the receiving server vouched for the sender of an email with these headers (lower-case names, values in
 * order of appearance: the first is the top one). `fromCount` is how many From addresses the email has.
 */
export function senderVerification(headers: Record<string, readonly string[]>, fromAddress: string | null | undefined, fromCount: number): SenderVerification {
  const fromDomain = domainOf(fromAddress ?? undefined);
  if (!fromAddress?.includes("@") || !fromDomain) return { verified: false, reason: "no_from" };
  if (fromCount !== 1) return { verified: false, reason: "multiple_from" };
  const top = headers["authentication-results"]?.[0];
  if (!top) return { verified: false, reason: "no_header" };
  const { results } = parseAuthenticationResults(top);

  // «none»: the From domain publishes no DMARC policy (Microsoft's «bestguesspass» is its guess, not a result).
  const dmarc = results.filter((result) => result.method === "dmarc" && result.result !== "none" && result.result !== "bestguesspass");
  if (dmarc.length > 0) {
    const passed = dmarc.every((result) => result.result === "pass" && (!result.props["header.from"] || domainOf(result.props["header.from"]) === fromDomain));
    return passed ? { verified: true, method: "dmarc" } : { verified: false, reason: "dmarc_failed" };
  }
  if (results.some((result) => result.method === "dkim" && result.result === "pass" && aligned(domainOf(result.props["header.d"] ?? result.props["header.i"]), fromDomain))) {
    return { verified: true, method: "dkim" };
  }
  if (results.some((result) => result.method === "spf" && result.result === "pass" && aligned(domainOf(result.props["smtp.mailfrom"]), fromDomain))) {
    return { verified: true, method: "spf" };
  }
  return { verified: false, reason: "not_aligned" };
}
