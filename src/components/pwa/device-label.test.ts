import { describe, expect, it } from "vitest";
import { describeDevice, toPushDeviceView } from "./device-label";

const CHROME = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0";

describe("name of each device in «Tus dispositivos» [PWA-03]", () => {
  it.each([
    [`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${CHROME} Safari/537.36`, "Chrome en Windows", "computer"],
    [`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${CHROME} Safari/537.36 Edg/140.0.0.0`, "Edge en Windows", "computer"],
    [`Mozilla/5.0 (X11; Linux x86_64) ${CHROME} Safari/537.36`, "Chrome en Linux", "computer"],
    [`Mozilla/5.0 (Linux; Android 10; K) ${CHROME} Mobile Safari/537.36`, "Chrome en Android", "phone"],
    [`Mozilla/5.0 (Linux; Android 10; K) ${CHROME} Safari/537.36`, "Chrome en Android", "tablet"],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
      "Samsung Internet en Android",
      "phone",
    ],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0", "Firefox en Mac", "computer"],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
      "Safari en Mac",
      "computer",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      "Safari en iPhone",
      "phone",
    ],
    // Added to the home screen, iOS drops «Safari» from the user agent: the only way push works there.
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", "App instalada en iPhone", "phone"],
    ["Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", "App instalada en iPad", "tablet"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
      "Chrome en iPhone",
      "phone",
    ],
  ])("%s", (userAgent, label, kind) => {
    expect(describeDevice(userAgent)).toEqual({ label, kind });
  });

  it("without a user agent the device is still listed", () => {
    expect(describeDevice(null)).toEqual({ label: "Dispositivo desconocido", kind: "computer" });
    expect(describeDevice("")).toEqual({ label: "Dispositivo desconocido", kind: "computer" });
  });

  it("shows when it was turned on and the last push that reached it, in the business time zone", () => {
    const now = new Date("2026-09-27T10:00:00Z");
    const base = { id: "d-1", fingerprint: "0123456789abcdef", userAgent: `Mozilla/5.0 (Linux; Android 10; K) ${CHROME} Mobile Safari/537.36` };
    expect(toPushDeviceView({ ...base, createdAt: new Date("2026-09-20T23:30:00Z"), lastSuccessAt: new Date("2026-09-27T07:00:00Z") }, "Europe/Madrid", now)).toEqual({
      id: "d-1",
      fingerprint: "0123456789abcdef",
      label: "Chrome en Android",
      kind: "phone",
      activatedOn: "21 sep 2026",
      lastPush: "hace 3 h",
    });
    expect(toPushDeviceView({ ...base, createdAt: now, lastSuccessAt: null }, "Europe/Madrid", now).lastPush).toBeNull();
  });
});
