// A readable name for each device with push in «Tus dispositivos» ([PWA-03]), from the user agent the browser sent
// when push was turned on: «Chrome en Android», «Safari en iPhone». Only for display; nothing depends on it.
import { formatDateTime, formatRelative } from "@/lib/format";
import type { PushDevice } from "@/server/notifications/push";

export type DeviceKind = "phone" | "tablet" | "computer";
export type DeviceDescription = { label: string; kind: DeviceKind };

/** A device as «Tus dispositivos» shows it: dates already in the business time zone, never the endpoint. */
export type PushDeviceView = { id: string; fingerprint: string; label: string; kind: DeviceKind; activatedOn: string; lastPush: string | null };

// Order matters: Edge, Opera and Samsung Internet also say «Chrome», and every iOS browser says «Safari».
const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|OPT)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

type System = { name: string; kind: DeviceKind; ios: boolean };

function systemOf(userAgent: string): System | null {
  if (/\biPhone\b|\biPod\b/.test(userAgent)) return { name: "iPhone", kind: "phone", ios: true };
  if (/\biPad\b/.test(userAgent)) return { name: "iPad", kind: "tablet", ios: true };
  if (/\bAndroid\b/.test(userAgent)) return { name: "Android", kind: /\bMobile\b/.test(userAgent) ? "phone" : "tablet", ios: false };
  if (/\bWindows\b/.test(userAgent)) return { name: "Windows", kind: "computer", ios: false };
  if (/\bCrOS\b/.test(userAgent)) return { name: "ChromeOS", kind: "computer", ios: false };
  if (/\bMac OS X\b|\bMacintosh\b/.test(userAgent)) return { name: "Mac", kind: "computer", ios: false };
  if (/\bLinux\b/.test(userAgent)) return { name: "Linux", kind: "computer", ios: false };
  return null;
}

export function describeDevice(userAgent: string | null | undefined): DeviceDescription {
  const value = userAgent ?? "";
  const system = systemOf(value);
  const browser = BROWSERS.find(([pattern]) => pattern.test(value))?.[1] ?? null;
  if (!system) return { label: browser ?? "Dispositivo desconocido", kind: "computer" };
  // An app added to the home screen of an iPhone or iPad does not name a browser: the only way push works there.
  const label = browser ?? (system.ios ? "App instalada" : "Navegador");
  return { label: `${label} en ${system.name}`, kind: system.kind };
}

export function toPushDeviceView(device: PushDevice, timeZone: string, now: Date = new Date()): PushDeviceView {
  const { label, kind } = describeDevice(device.userAgent);
  return {
    id: device.id,
    fingerprint: device.fingerprint,
    label,
    kind,
    activatedOn: formatDateTime(device.createdAt, timeZone, { preset: "date" }),
    lastPush: device.lastSuccessAt ? formatRelative(device.lastSuccessAt, timeZone, now) : null,
  };
}
