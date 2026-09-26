import { afterEach, describe, expect, it } from "vitest";
import {
  assertEncryptionKeyConfigured,
  DecryptionError,
  decryptSecret,
  EncryptionKeyError,
  encryptSecret,
  hashToken,
  maskSecret,
  randomToken,
  timingSafeEqualStr,
  tryDecryptSecret,
} from "./crypto";

const ORIGINAL_KEY = process.env.APP_ENCRYPTION_KEY;
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

afterEach(() => {
  process.env.APP_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("encryptSecret / decryptSecret [SEG-01]", () => {
  it("round-trips a secret in the v1:iv:tag:ct format", () => {
    const stored = encryptSecret("sk-or-v1-abcdef1234");
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain("abcdef1234");
    expect(decryptSecret(stored)).toBe("sk-or-v1-abcdef1234");
  });

  it("uses a new IV every time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("round-trips unicode and empty strings", () => {
    expect(decryptSecret(encryptSecret("contraseña ñ €"))).toBe("contraseña ñ €");
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("detects tampering with the ciphertext, the tag or the IV", () => {
    const [version, iv, tag, ct] = encryptSecret("secreto").split(":");
    const flip = (b64: string) => {
      const bytes = Buffer.from(b64, "base64");
      bytes[0] ^= 1;
      return bytes.toString("base64");
    };
    expect(() => decryptSecret([version, iv, tag, flip(ct)].join(":"))).toThrow(DecryptionError);
    expect(() => decryptSecret([version, iv, flip(tag), ct].join(":"))).toThrow(DecryptionError);
    expect(() => decryptSecret([version, flip(iv), tag, ct].join(":"))).toThrow(DecryptionError);
  });

  it("rejects malformed values and unknown versions", () => {
    expect(() => decryptSecret("not-a-secret")).toThrow(DecryptionError);
    expect(() => decryptSecret("v2:a:b:c")).toThrow(DecryptionError);
  });

  it("cannot read secrets stored with another key [SEG-03]", () => {
    const stored = encryptSecret("token");
    process.env.APP_ENCRYPTION_KEY = OTHER_KEY;
    expect(() => decryptSecret(stored)).toThrow(DecryptionError);
    expect(tryDecryptSecret(stored)).toBeNull();
  });

  it("tryDecryptSecret returns null for null or unreadable values", () => {
    expect(tryDecryptSecret(null)).toBeNull();
    expect(tryDecryptSecret("garbage")).toBeNull();
    expect(tryDecryptSecret(encryptSecret("ok"))).toBe("ok");
  });
});

describe("APP_ENCRYPTION_KEY [SEG-03]", () => {
  it("fails with a clear error when it is missing", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(EncryptionKeyError);
    expect(() => assertEncryptionKeyConfigured()).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("fails when it is not 32 bytes of Base64", () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptSecret("x")).toThrow(EncryptionKeyError);
    process.env.APP_ENCRYPTION_KEY = "esto no es base64 !!";
    expect(() => assertEncryptionKeyConfigured()).toThrow(EncryptionKeyError);
  });

  it("accepts a valid key", () => {
    expect(() => assertEncryptionKeyConfigured()).not.toThrow();
  });
});

describe("maskSecret [AJU-16] [PER-07]", () => {
  it("shows only the last 4 characters", () => {
    expect(maskSecret("sk-or-v1-abcdef1234")).toBe("••••1234");
  });

  it("hides short secrets completely", () => {
    expect(maskSecret("123456")).toBe("••••");
    expect(maskSecret("")).toBe("••••");
  });
});

describe("timingSafeEqualStr [SEG-08]", () => {
  it("compares strings", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });
});

describe("tokens", () => {
  it("randomToken is URL-safe and unique; hashToken is a stable SHA-256 hex", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
  });
});
