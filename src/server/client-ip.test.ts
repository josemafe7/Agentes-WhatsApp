import { describe, expect, it } from "vitest";
import { clientIp, UNKNOWN_IP } from "./client-ip";

describe("client IP for the rate limits [SEG-07]", () => {
  it("takes the entry the proxy wrote (the right-most one), not what the client put before it", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
  });

  it("falls back to x-real-ip and then to «unknown»", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe(UNKNOWN_IP);
  });

  it("anything that is not an IP address counts as «unknown»", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "a".repeat(500) }))).toBe(UNKNOWN_IP);
    expect(clientIp(new Headers({ "x-forwarded-for": "evil.example", "x-real-ip": "<script>" }))).toBe(UNKNOWN_IP);
  });
});
