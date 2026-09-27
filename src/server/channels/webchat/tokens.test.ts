import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueUploadReceipt,
  issueVisitorToken,
  UPLOAD_RECEIPT_TTL_MS,
  verifyUploadReceipt,
  verifyVisitorToken,
  VISITOR_TOKEN_MAX_AGE_MS,
} from "./tokens";

const CHANNEL = "0b8f2a52-3f7e-4a53-9a55-5f1c2e0f6a01";
const OTHER_CHANNEL = "6a3e4b1c-9d0f-4c2a-8b7e-1f2d3c4b5a60";
const VISITOR = "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";
const OTHER_VISITOR = "9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b";
const NOW = new Date("2026-09-27T10:00:00Z");

function tamper(token: string, change: (payload: Record<string, unknown>) => void): string {
  const [version, body, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  change(payload);
  return [version, Buffer.from(JSON.stringify(payload)).toString("base64url"), signature].join(".");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("visitor token [WEB-04] [WEB-11]", () => {
  it("binds the visitor to its channel", () => {
    const token = issueVisitorToken({ channelId: CHANNEL, visitorId: VISITOR }, NOW);
    expect(verifyVisitorToken(token, CHANNEL, NOW)).toEqual({ channelId: CHANNEL, visitorId: VISITOR });
  });

  it("rejects a forged token that claims another visitor", () => {
    const token = issueVisitorToken({ channelId: CHANNEL, visitorId: VISITOR }, NOW);
    const forged = tamper(token, (payload) => {
      payload.v = OTHER_VISITOR;
    });
    expect(verifyVisitorToken(forged, CHANNEL, NOW)).toBeNull();
  });

  it("rejects a token of another channel, even with a valid signature", () => {
    const token = issueVisitorToken({ channelId: OTHER_CHANNEL, visitorId: VISITOR }, NOW);
    expect(verifyVisitorToken(token, CHANNEL, NOW)).toBeNull();
  });

  it("rejects a token signed with another server secret", () => {
    const token = issueVisitorToken({ channelId: CHANNEL, visitorId: VISITOR }, NOW);
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(verifyVisitorToken(token, CHANNEL, NOW)).toBeNull();
  });

  it("rejects garbage, other versions and truncated tokens", () => {
    const token = issueVisitorToken({ channelId: CHANNEL, visitorId: VISITOR }, NOW);
    for (const bad of ["", "abc", "v1..", `v2${token.slice(2)}`, token.slice(0, -2), `${token}.extra`, "x".repeat(5_000), null, 42]) {
      expect(verifyVisitorToken(bad, CHANNEL, NOW)).toBeNull();
    }
  });

  it("expires after its maximum age and never comes from the future", () => {
    const token = issueVisitorToken({ channelId: CHANNEL, visitorId: VISITOR }, NOW);
    expect(verifyVisitorToken(token, CHANNEL, new Date(NOW.getTime() + VISITOR_TOKEN_MAX_AGE_MS - 1_000))).not.toBeNull();
    expect(verifyVisitorToken(token, CHANNEL, new Date(NOW.getTime() + VISITOR_TOKEN_MAX_AGE_MS + 1_000))).toBeNull();
    const future = issueVisitorToken({ channelId: CHANNEL, visitorId: VISITOR }, new Date(NOW.getTime() + 60 * 60_000));
    expect(verifyVisitorToken(future, CHANNEL, NOW)).toBeNull();
  });
});

describe("upload receipt [WEB-07] [SEG-13]", () => {
  const receipt = { channelId: CHANNEL, visitorId: VISITOR, fileKey: "webchat/2026/09/abc.png", mimeType: "image/png", size: 120, kind: "image" as const };

  it("is only valid for the visitor and channel that uploaded the file", () => {
    const token = issueUploadReceipt(receipt, NOW);
    expect(verifyUploadReceipt(token, { channelId: CHANNEL, visitorId: VISITOR }, NOW)).toEqual(receipt);
    expect(verifyUploadReceipt(token, { channelId: CHANNEL, visitorId: OTHER_VISITOR }, NOW)).toBeNull();
    expect(verifyUploadReceipt(token, { channelId: OTHER_CHANNEL, visitorId: VISITOR }, NOW)).toBeNull();
  });

  it("cannot be edited to point at another file or type", () => {
    const token = issueUploadReceipt(receipt, NOW);
    const otherFile = tamper(token, (payload) => {
      payload.k = "logos/2026/09/other.png";
    });
    expect(verifyUploadReceipt(otherFile, { channelId: CHANNEL, visitorId: VISITOR }, NOW)).toBeNull();
  });

  it("expires", () => {
    const token = issueUploadReceipt(receipt, NOW);
    expect(verifyUploadReceipt(token, { channelId: CHANNEL, visitorId: VISITOR }, new Date(NOW.getTime() + UPLOAD_RECEIPT_TTL_MS + 1_000))).toBeNull();
  });

  it("is never accepted as a visitor token, nor the other way round", () => {
    const upload = issueUploadReceipt(receipt, NOW);
    const visitor = issueVisitorToken({ channelId: CHANNEL, visitorId: VISITOR }, NOW);
    expect(verifyVisitorToken(upload, CHANNEL, NOW)).toBeNull();
    expect(verifyUploadReceipt(visitor, { channelId: CHANNEL, visitorId: VISITOR }, NOW)).toBeNull();
  });
});
