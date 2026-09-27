// Mail helpers shared by the simulated Gmail API (./google.mjs) and Microsoft Graph (./microsoft.mjs): just enough
// RFC 5322 / MIME to read what the app sends (headers, threading ids, the text part) and to build what a mailbox
// returns, plus the small HTML consent pages and PKCE check both sign-in mocks need. Plain Node, no dependencies.
import { createHash, randomBytes } from "node:crypto";

const CRLF = "\r\n";

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Random url-safe characters (tokens, codes, ids). */
export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

/** A form body (the mock server keeps x-www-form-urlencoded bodies as text) as a plain object. */
export function formOf(body) {
  if (typeof body === "string") return Object.fromEntries(new URLSearchParams(body));
  return isRecord(body) ? body : {};
}

/** RFC 7636: the verifier must hash to the challenge sent with the authorization request. */
export function pkceMatches(verifier, challenge, method) {
  if (!challenge) return true;
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return false;
  if (method === "plain") return verifier === challenge;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

// ─── Reading messages ────────────────────────────────────────────────────────────────────────────────────

/** Bytes of a message: a Buffer, or base64 / base64url text (Node's decoder takes both alphabets). */
export function rawBytes(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  return Buffer.from(String(raw ?? ""), "base64url");
}

/** Header block and body (CRLF or bare LF line ends). */
export function splitMessage(raw) {
  const buffer = rawBytes(raw);
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  let end = crlf;
  let skip = 4;
  if (crlf < 0 || (lf >= 0 && lf < crlf)) {
    end = lf;
    skip = 2;
  }
  if (end < 0) return { headerText: buffer.toString("utf8"), body: Buffer.alloc(0) };
  return { headerText: buffer.subarray(0, end).toString("utf8"), body: buffer.subarray(end + skip) };
}

/** [name, value] pairs in order, unfolded. */
export function parseHeaderLines(headerText) {
  const pairs = [];
  for (const line of String(headerText).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && pairs.length > 0) {
      pairs[pairs.length - 1][1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    pairs.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return pairs;
}

/** Every header by lower-case name, values as they came (unfolded), in order. */
export function headerMap(raw) {
  const map = {};
  for (const [name, value] of parseHeaderLines(splitMessage(raw).headerText)) (map[name.toLowerCase()] ??= []).push(value);
  return map;
}

export function firstHeader(headers, name) {
  return headers[name.toLowerCase()]?.[0] ?? null;
}

function decodeBytes(bytes, charset = "utf-8") {
  try {
    return new TextDecoder(String(charset).trim().toLowerCase() || "utf-8").decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** RFC 2047 encoded words («=?UTF-8?B?…?=» and «=?…?Q?…?=») as text. */
export function decodeMimeWords(value) {
  return String(value ?? "")
    .replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bBqQ])\?([^?]*)\?=/g, (_match, charset, encoding, text) => {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_hex, hex) => String.fromCharCode(parseInt(hex, 16))), "latin1");
      return decodeBytes(bytes, charset);
    });
}

/** The «<…>» ids of a Message-ID, In-Reply-To or References header. */
export function messageIdsIn(value) {
  return String(value ?? "").match(/<[^<>\s]+>/g) ?? [];
}

/** { name, address } of the first address of a From / To header (address in lower case). */
export function addressIn(value) {
  const text = decodeMimeWords(value);
  const angled = /<([^<>\s@]+@[^<>\s]+)>/.exec(text);
  const bare = /([^\s<>",;:]+@[^\s<>",;]+)/.exec(text);
  const address = (angled?.[1] ?? bare?.[1] ?? "").toLowerCase();
  if (!address) return null;
  const name = angled ? text.slice(0, angled.index).trim().replace(/^"(.*)"$/, "$1").trim() : "";
  return { name: name || null, address };
}

/** Every address of a To / Cc header, in lower case. */
export function addressesIn(values) {
  const found = [];
  for (const value of values ?? []) {
    for (const piece of decodeMimeWords(value).split(",")) {
      const address = addressIn(piece);
      if (address) found.push(address);
    }
  }
  return found;
}

/** A subject without its «Re:» / «Fwd:» prefixes, for comparing threads. */
export function normalizeSubject(subject) {
  return decodeMimeWords(subject)
    .replace(/^\s*(?:(?:re|fw|fwd|rv|aw|sv|wg)\s*(?:\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseContentType(value) {
  const [type, ...params] = String(value ?? "text/plain").split(";");
  const result = { type: type.trim().toLowerCase() || "text/plain", params: {} };
  for (const param of params) {
    const equals = param.indexOf("=");
    if (equals < 0) continue;
    result.params[param.slice(0, equals).trim().toLowerCase()] = param
      .slice(equals + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  return result;
}

function decodeTransfer(body, encoding) {
  const kind = String(encoding ?? "7bit").trim().toLowerCase();
  if (kind === "base64") return Buffer.from(body.toString("latin1").replace(/\s+/g, ""), "base64");
  if (kind === "quoted-printable") {
    const text = body.toString("latin1").replace(/=\r?\n/g, "");
    const bytes = [];
    for (let index = 0; index < text.length; index += 1) {
      const hex = text.slice(index + 1, index + 3);
      if (text[index] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        index += 2;
      } else {
        bytes.push(text.charCodeAt(index) & 0xff);
      }
    }
    return Buffer.from(bytes);
  }
  return body;
}

/** Leaf parts of a message, each decoded from its transfer encoding. */
function leafParts(raw, depth = 0) {
  const { headerText, body } = splitMessage(raw);
  const headers = {};
  for (const [name, value] of parseHeaderLines(headerText)) headers[name.toLowerCase()] ??= value;
  const type = parseContentType(headers["content-type"]);
  if (type.type.startsWith("multipart/") && type.params.boundary && depth < 8) {
    const pieces = body.toString("latin1").split(`--${type.params.boundary}`).slice(1);
    const parts = [];
    for (const piece of pieces) {
      if (piece.startsWith("--")) break;
      parts.push(...leafParts(Buffer.from(piece.replace(/^\r?\n/, "").replace(/\r?\n$/, ""), "latin1"), depth + 1));
    }
    return parts;
  }
  const disposition = parseContentType(headers["content-disposition"] ?? "inline");
  return [
    {
      type: type.type,
      charset: type.params.charset ?? "utf-8",
      disposition: disposition.type,
      filename: decodeMimeWords(disposition.params.filename ?? type.params.name ?? "") || null,
      content: decodeTransfer(body, headers["content-transfer-encoding"]),
    },
  ];
}

/** Readable text of an HTML body (tags out, entities decoded). */
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The readable text of a message: its text/plain part, or its HTML without tags. */
export function extractText(raw) {
  const parts = leafParts(raw);
  const plain = parts.find((part) => part.type === "text/plain" && part.disposition !== "attachment");
  if (plain) return decodeBytes(plain.content, plain.charset).replace(/\r\n/g, "\n");
  const html = parts.find((part) => part.type === "text/html" && part.disposition !== "attachment");
  return html ? htmlToText(decodeBytes(html.content, html.charset)) : "";
}

/** Attached files of a message (name, type and size). */
export function attachmentsOf(raw) {
  return leafParts(raw)
    .filter((part) => part.disposition === "attachment" || (part.filename && !part.type.startsWith("text/")))
    .map((part) => ({ filename: part.filename, contentType: part.type, size: part.content.length }));
}

/** The first lines of a reply, without the quoted history («El … escribió:», «On … wrote:», «> …»). */
export function withoutQuotes(text) {
  const kept = [];
  for (const line of String(text).split("\n")) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*(El .+ escribi[oó]:|On .+ wrote:|-{2,}\s*(Mensaje original|Original Message)\s*-{2,})\s*$/i.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

/** What a test reads of a message: headers by lower-case name, the decoded subject, sender, recipients and text. */
export function describeRaw(raw) {
  const headers = headerMap(raw);
  return {
    headers,
    subject: decodeMimeWords(firstHeader(headers, "subject") ?? ""),
    from: addressIn(firstHeader(headers, "from")),
    to: addressesIn(headers.to),
    messageId: messageIdsIn(firstHeader(headers, "message-id"))[0] ?? null,
    inReplyTo: messageIdsIn(firstHeader(headers, "in-reply-to"))[0] ?? null,
    references: messageIdsIn((headers.references ?? []).join(" ")),
    text: extractText(raw),
    attachments: attachmentsOf(raw),
  };
}

// ─── Building messages ───────────────────────────────────────────────────────────────────────────────────

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** A header value as an RFC 2047 word when it is not plain ASCII. */
export function encodeHeaderText(value) {
  const text = String(value ?? "");
  return PRINTABLE_ASCII.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

export function formatAddress(address) {
  if (!address?.name) return `<${address.address}>`;
  const name = PRINTABLE_ASCII.test(address.name) ? `"${address.name.replace(/["\\]/g, "")}"` : encodeHeaderText(address.name);
  return `${name} <${address.address}>`;
}

export function rfc2822Date(date = new Date()) {
  return date.toUTCString().replace("GMT", "+0000");
}

/** A text/plain UTF-8 message (base64 body) from [name, value] header pairs; empty values are left out. */
export function buildMime(headers, text) {
  const lines = headers.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([name, value]) => `${name}: ${value}`);
  lines.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64");
  const body = Buffer.from(String(text ?? "").replace(/\r?\n/g, CRLF), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, `$&${CRLF}`);
  return Buffer.from(`${lines.join(CRLF)}${CRLF}${CRLF}${body}`, "utf8");
}

// ─── Pages of the sign-in mocks ──────────────────────────────────────────────────────────────────────────

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

/** A small HTML page (a consent screen or an error), in Spanish like the app's users see it. */
export function htmlPage(title, body, status = 200) {
  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}label{display:block;margin:.5rem 0}input[type=email]{width:100%;padding:.5rem}button{margin:1rem .5rem 0 0;padding:.5rem 1rem}</style>
</head>
<body><main>${body}</main></body>
</html>`;
  return { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, body: html };
}

/** 302 to the app's redirect URI with these parameters (never a fragment: response_mode=query). */
export function redirectTo(uri, params) {
  const url = new URL(uri);
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
  return { status: 302, headers: { location: url.toString(), "cache-control": "no-store" }, body: "" };
}

/** Loud on purpose, like the server's own answer: a call nobody simulated. */
export function notSimulated(service, method, path) {
  return { status: 501, body: { error: { code: 501, message: `No simulado: ${method} /${service}${path}` } } };
}

/** Path segments after `skip` leading ones, URL-decoded («/gmail/v1/users/me/x» → […]). */
export function segmentsOf(path, skip = 0) {
  return path
    .split("/")
    .filter(Boolean)
    .slice(skip)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

export function bearer(headers) {
  const match = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? "").trim());
  return match ? match[1].trim() : null;
}
