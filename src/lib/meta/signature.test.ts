import { describe, expect, it } from "vitest";
import { computeMetaSignature, verifyMetaSignature } from "./signature";

// The test vectors of docs/integracion-whatsapp-mensajes.md §3 (computed with standard HMAC-SHA256).
const COMPACT = '{"object":"whatsapp_business_account","entry":[]}';
const SPACED = '{"object": "whatsapp_business_account", "entry": []}';
const COMPACT_SIGNATURE = "sha256=dec6a680679a968e7e0319355b23599cbfc54502c0784668e9618baa0c633756";
const SPACED_SIGNATURE = "sha256=56cbbaf4961c6cfdae48b7f116c047e5eb513d2c931baae63a2bc1afd26f803a";
const OTHER_SECRET_SIGNATURE = "sha256=769b03d8c2ae6498f2d1e1f7299c0ba55448c69d741e7b0bb243d852d8a8d8c7";
const bytes = (text: string) => new TextEncoder().encode(text);

describe("X-Hub-Signature-256 [WA-32] [SEG-08]", () => {
  it("matches the documented vectors", () => {
    expect(computeMetaSignature("test_app_secret", COMPACT)).toBe(COMPACT_SIGNATURE);
    expect(computeMetaSignature("test_app_secret", SPACED)).toBe(SPACED_SIGNATURE);
    expect(computeMetaSignature("otro_secreto", COMPACT)).toBe(OTHER_SECRET_SIGNATURE);
  });

  it("accepts the right signature over the exact bytes", () => {
    expect(verifyMetaSignature(bytes(COMPACT), COMPACT_SIGNATURE, "test_app_secret")).toBe(true);
    expect(verifyMetaSignature(bytes(COMPACT), COMPACT_SIGNATURE.toUpperCase().replace("SHA256=", "sha256="), "test_app_secret")).toBe(true);
  });

  it("signs bytes, not the JSON: the same JSON with spaces fails with the first signature", () => {
    expect(verifyMetaSignature(bytes(SPACED), COMPACT_SIGNATURE, "test_app_secret")).toBe(false);
  });

  it("rejects another app's secret, a missing header and malformed headers without throwing", () => {
    expect(verifyMetaSignature(bytes(COMPACT), OTHER_SECRET_SIGNATURE, "test_app_secret")).toBe(false);
    for (const header of [null, undefined, "", "sha256=", "sha1=abc", `sha256=${"a".repeat(63)}`, `sha256=${"z".repeat(64)}`, `${COMPACT_SIGNATURE}00`]) {
      expect(verifyMetaSignature(bytes(COMPACT), header, "test_app_secret")).toBe(false);
    }
    expect(verifyMetaSignature(bytes(COMPACT), COMPACT_SIGNATURE, "")).toBe(false);
  });
});
