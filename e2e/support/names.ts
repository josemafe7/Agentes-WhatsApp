// Names and texts no other test (or the demo) uses, so a test finds its own channel, message or contact in shared
// lists and searches. Stable within a test and its retry, different between tests and runs.
import { createHash } from "node:crypto";
import type { TestInfo } from "@playwright/test";
import { RUN_ID } from "./env";

function digest(testInfo: TestInfo, label: string): string {
  return createHash("sha256").update(`${RUN_ID}:${testInfo.testId}:${testInfo.retry}:${label}`).digest("hex");
}

/** Six hex characters for this run, test, retry and label: «3fa2c1». */
export function uniqueRef(testInfo: TestInfo, label: string): string {
  return digest(testInfo, label).slice(0, 6);
}

/** «Chat web e2e 3fa2c1». */
export function uniqueName(testInfo: TestInfo, label: string): string {
  return `${label} ${uniqueRef(testInfo, label)}`;
}

/** A customer message with a reference of its own, so the inbox search finds only this conversation. */
export function uniqueMessage(testInfo: TestInfo, text: string): string {
  return `${text} (ref ${uniqueRef(testInfo, text)})`;
}

/** A Spanish mobile number for a simulated contact (shown only: the phone is never a key, [CAN-13]). */
export function uniquePhone(testInfo: TestInfo, label = "teléfono"): string {
  const number = parseInt(digest(testInfo, label).slice(0, 8), 16) % 100_000_000;
  return `+346${String(number).padStart(8, "0")}`;
}
