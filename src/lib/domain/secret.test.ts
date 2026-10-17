import { describe, it, expect } from "vitest";
import { generateSigningSecret, secretHint, canRotateSecret } from "./secret";
import { signBody, verifySignature } from "./hmac";

describe("signing secret rotation", () => {
  it("generates fpsec_ + 32 random bytes (64 hex), unique each time", () => {
    const a = generateSigningSecret();
    const b = generateSigningSecret();
    expect(a).toMatch(/^fpsec_[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(secretHint(a)).toBe(a.slice(-4));
  });
  it("only owners may rotate; operator and viewer are denied", () => {
    expect(canRotateSecret("owner")).toBe(true);
    expect(canRotateSecret("operator")).toBe(false);
    expect(canRotateSecret("viewer")).toBe(false);
    expect(canRotateSecret(undefined)).toBe(false);
  });
  it("after rotation old signatures fail and new ones verify", async () => {
    const oldS = generateSigningSecret();
    const newS = generateSigningSecret();
    const body = JSON.stringify({ external_order_id: "o1" });
    const oldSig = await signBody(oldS, body);
    expect((await verifySignature(newS, oldSig, body)).ok).toBe(false);
    expect((await verifySignature(newS, await signBody(newS, body), body)).ok).toBe(true);
  });
});