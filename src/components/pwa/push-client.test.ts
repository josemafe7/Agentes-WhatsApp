import { describe, expect, it } from "vitest";
import { pushEndpointFingerprint } from "@/server/notifications/push";
import {
  detectPlatform,
  endpointFingerprint,
  pushSupport,
  sameApplicationServerKey,
  toNotificationPermission,
  urlBase64ToUint8Array,
  type PushEnvironment,
} from "./push-client";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const browser: PushEnvironment = {
  platform: "other",
  standalone: false,
  secureContext: true,
  serviceWorker: true,
  pushManager: true,
  notification: true,
};

describe("where push works [PWA-03] (docs/notificaciones-push.md «Dónde funciona»)", () => {
  it("tells iPhone and iPad apart (iPadOS says it is a Mac, but a Mac has no touch screen)", () => {
    expect(detectPlatform(IPHONE, 5)).toBe("ios");
    expect(detectPlatform(IPAD_AS_MAC, 5)).toBe("ios");
    expect(detectPlatform(IPAD_AS_MAC, 0)).toBe("other");
    expect(detectPlatform(ANDROID, 5)).toBe("android");
    expect(detectPlatform(WINDOWS, 0)).toBe("other");
  });

  it("Android and computers: in the browser, without installing anything", () => {
    expect(pushSupport(browser)).toBe("supported");
    expect(pushSupport({ ...browser, platform: "android" })).toBe("supported");
  });

  it("iPhone and iPad: only with the app added to the home screen", () => {
    expect(pushSupport({ ...browser, platform: "ios", pushManager: false, notification: false })).toBe("needs-install");
    expect(pushSupport({ ...browser, platform: "ios", standalone: true })).toBe("supported");
    // Installed on an iOS older than 16.4: no PushManager at all.
    expect(pushSupport({ ...browser, platform: "ios", standalone: true, pushManager: false })).toBe("unsupported");
  });

  it("never without a secure context (https or localhost), and not in browsers without the APIs", () => {
    expect(pushSupport({ ...browser, secureContext: false })).toBe("insecure");
    expect(pushSupport({ ...browser, serviceWorker: false })).toBe("unsupported");
    expect(pushSupport({ ...browser, notification: false })).toBe("unsupported");
  });
});

describe("keys and devices", () => {
  it("turns the Base64 URL public key into the bytes PushManager.subscribe expects", () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, index) => (index * 37) % 256);
    const encoded = Buffer.from(bytes).toString("base64url");
    expect(Array.from(urlBase64ToUint8Array(encoded))).toEqual(Array.from(bytes));
  });

  it("knows whether the browser's subscription was made with the installation's current key", () => {
    const key = Buffer.from(Uint8Array.from({ length: 65 }, (_, index) => index)).toString("base64url");
    const same = urlBase64ToUint8Array(key).buffer;
    const other = urlBase64ToUint8Array(Buffer.from(Uint8Array.from({ length: 65 }, () => 7)).toString("base64url")).buffer;
    expect(sameApplicationServerKey(same, key)).toBe(true);
    expect(sameApplicationServerKey(other, key)).toBe(false);
    // A browser that does not say which key it used: nothing to compare, keep the subscription.
    expect(sameApplicationServerKey(null, key)).toBe(true);
  });

  it("computes in the browser the same device fingerprint the server lists, without the endpoint leaving it", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc123:def-456";
    const fingerprint = await endpointFingerprint(endpoint);
    expect(fingerprint).toBe(pushEndpointFingerprint(endpoint));
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint).not.toContain("abc123");
  });
});

describe("the permission to show notifications [PWA-03]", () => {
  it("reads the Permissions API's answer the way the Notification API names it", () => {
    expect(toNotificationPermission("granted")).toBe("granted");
    expect(toNotificationPermission("denied")).toBe("denied");
    expect(toNotificationPermission("prompt")).toBe("default");
  });
});
