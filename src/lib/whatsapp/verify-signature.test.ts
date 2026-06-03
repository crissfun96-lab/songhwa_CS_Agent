import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { isValidMetaSignature } from "./verify-signature";

// Meta signs the raw webhook body with the app secret (HMAC-SHA256) and sends it as
// `X-Hub-Signature-256: sha256=<hex>`. The webhook MUST accept only genuine signatures
// and fail closed otherwise — an accepted forgery lets an attacker stuff Firestore and
// poison the agent. These tests pin that contract deterministically (secret is passed in).

const SECRET = "test_app_secret_123";
const BODY = '{"object":"whatsapp_business_account","entry":[{"id":"123"}]}';

function sign(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("isValidMetaSignature — accepts genuine signatures", () => {
  it("accepts a correctly signed body", () => {
    expect(isValidMetaSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });
});

describe("isValidMetaSignature — rejects forgeries & tampering", () => {
  it("rejects when the body was tampered after signing", () => {
    const sig = sign(BODY, SECRET);
    expect(isValidMetaSignature(BODY + " ", sig, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(isValidMetaSignature(BODY, sign(BODY, "wrong_secret"), SECRET)).toBe(false);
  });

  it("rejects a completely bogus but well-formed hex signature", () => {
    expect(isValidMetaSignature(BODY, "sha256=" + "a".repeat(64), SECRET)).toBe(false);
  });

  it("rejects a truncated signature (length mismatch → timingSafeEqual throws → caught)", () => {
    const sig = sign(BODY, SECRET).slice(0, 20);
    expect(isValidMetaSignature(BODY, sig, SECRET)).toBe(false);
  });

  it("rejects non-hex garbage after the prefix", () => {
    expect(isValidMetaSignature(BODY, "sha256=not-hex-zzzz", SECRET)).toBe(false);
  });
});

describe("isValidMetaSignature — fails closed on missing inputs", () => {
  it("rejects when the app secret is not configured", () => {
    expect(isValidMetaSignature(BODY, sign(BODY, SECRET), undefined)).toBe(false);
    expect(isValidMetaSignature(BODY, sign(BODY, SECRET), "")).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(isValidMetaSignature(BODY, null, SECRET)).toBe(false);
    expect(isValidMetaSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it("rejects a signature without the sha256= prefix", () => {
    const bareHex = crypto.createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(isValidMetaSignature(BODY, bareHex, SECRET)).toBe(false);
  });
});
