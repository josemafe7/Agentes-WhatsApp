import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTrustedProxyHopsConfigured,
  clientIp,
  DEFAULT_TRUSTED_PROXY_HOPS,
  parseTrustedProxyHops,
  TrustedProxyHopsError,
  trustedProxyHops,
  UNKNOWN_IP,
} from "./client-ip";

afterEach(() => vi.unstubAllEnvs());

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

  it("an IPv4 client seen through an IPv6 socket is the same client", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "::ffff:203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "::FFFF:198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("an invalid entry written by the proxy is never replaced by the client's own x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "no-es-una-ip", "x-real-ip": "198.51.100.2" }))).toBe(UNKNOWN_IP);
  });
});

describe("TRUSTED_PROXY_HOPS: how many proxies in front of the app write X-Forwarded-For [SEG-07]", () => {
  it("defaults to 1 (Vercel, or Traefik in Dokploy): the right-most entry", () => {
    expect(DEFAULT_TRUSTED_PROXY_HOPS).toBe(1);
    expect(trustedProxyHops({})).toBe(1);
  });

  it("with 2 proxies, the client is the second entry from the right, whatever the client sent before it", () => {
    const headers = new Headers({ "x-forwarded-for": "10.9.9.9, 203.0.113.7, 198.51.100.1" });
    expect(clientIp(headers, 2)).toBe("203.0.113.7");
    // Fewer entries than proxies (someone reached the last proxy directly): the left-most one.
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.8" }), 2)).toBe("203.0.113.8");
  });

  it("with 0 (the app exposed without a proxy) no header is trusted: a client cannot pick its own counter", () => {
    const spoofed = new Headers({ "x-forwarded-for": "203.0.113.99", "x-real-ip": "203.0.113.98" });
    expect(clientIp(spoofed, 0)).toBe(UNKNOWN_IP);
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1" }), 0)).toBe(UNKNOWN_IP);
  });

  it("reads the setting from the environment", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe(UNKNOWN_IP);
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" }))).toBe("203.0.113.7");
  });

  it("accepts a small whole number; anything else is invalid", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops("")).toBe(1);
    expect(parseTrustedProxyHops(" 0 ")).toBe(0);
    expect(parseTrustedProxyHops("3")).toBe(3);
    for (const invalid of ["-1", "1.5", "uno", "99", "1e1", "0x1"]) expect(parseTrustedProxyHops(invalid), invalid).toBeNull();
  });

  it("an invalid value stops the start-up with a Spanish explanation, and at run time trusts no header", () => {
    expect(() => assertTrustedProxyHopsConfigured({ TRUSTED_PROXY_HOPS: "dos" })).toThrow(TrustedProxyHopsError);
    expect(() => assertTrustedProxyHopsConfigured({ TRUSTED_PROXY_HOPS: "dos" })).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(() => assertTrustedProxyHopsConfigured({})).not.toThrow();
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "dos" })).toBe(0);
  });
});
