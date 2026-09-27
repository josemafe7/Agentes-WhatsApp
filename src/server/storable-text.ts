// Text from outside as Postgres can store it. Postgres refuses the NUL character (U+0000) in text and in jsonb, and half
// of a UTF-16 surrogate pair in jsonb (a text column already gets it as «�» from the driver); SQLite took both. An email,
// a webhook or a web chat message carrying either would fail every time it is saved: a mailbox would stop at it for
// good and a WhatsApp message would be lost. So what comes in (the email parser, the WhatsApp webhook, the common inbound
// pipeline) and the text people paste into the knowledge bases go through here first: NUL is removed and a lone
// surrogate becomes «�», as the text columns already store it.
import "server-only";

/** `text` without NUL characters and with every lone surrogate replaced by U+FFFD. */
export function storableText(text: string): string {
  const withoutNul = text.replaceAll("\u0000", "");
  return withoutNul.isWellFormed() ? withoutNul : withoutNul.toWellFormed();
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * `value` with storableText applied to every string in it, object keys included. Arrays and plain objects are copied
 * (the input is never changed); anything else, such as a Date or the bytes of a file, is kept as it is.
 */
export function storableJson<T>(value: T): T {
  if (typeof value === "string") return storableText(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => storableJson(item)) as T;
  if (value !== null && typeof value === "object" && isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [storableText(key), storableJson(item)])) as T;
  }
  return value;
}
