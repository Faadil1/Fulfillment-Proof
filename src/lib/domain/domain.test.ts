import { describe, it, expect } from "vitest";
import { detectViolations } from "./contract";
import { evaluatePolicy } from "./policy";
import { verifyDestination } from "./verifier";
import { signBody, verifySignature } from "./hmac";

const good = { external_order_id: "A1", source: "shopx", currency: "USD", amount_cents: 1200, sku: "TEE-1", quantity: 2, customer_reference: "c_1" };

describe("contract", () => {
  it("accepts valid order", () => expect(detectViolations(good)).toEqual([]));
  it("flags net_total_cents drift", () => {
    const { amount_cents, ...rest } = good;
    const v = detectViolations({ ...rest, net_total_cents: amount_cents });
    expect(v.map((x) => x.field)).toContain("amount_cents");
  });
  it("flags missing sku with nested product", () => {
    const { sku, ...rest } = good;
    const v = detectViolations({ ...rest, product: { sku } });
    expect(v.find((x) => x.field === "sku")?.hint).toMatch(/product.sku/);
  });
});

describe("policy", () => {
  it("requires approval above 500000 cents", () => {
    const d = evaluatePolicy({ ...good, amount_cents: 500_001 }, {}, "shopx", ["TEE-1"]);
    expect(d.allowed).toBe(true);
    expect(d.requires_approval).toBe(true);
  });
  it("does not require approval at exactly 500000", () => {
    expect(evaluatePolicy({ ...good, amount_cents: 500_000 }, {}, "shopx", ["TEE-1"]).requires_approval).toBe(false);
  });
  it("requires approval for unknown sku", () => {
    expect(evaluatePolicy(good, {}, "shopx", []).requires_approval).toBe(true);
  });
  it("requires approval when high-risk field changed", () => {
    expect(evaluatePolicy(good, { customer_reference: "c_2" }, "shopx", ["TEE-1"]).requires_approval).toBe(true);
  });
  it("refuses invalid proposal and source spoof", () => {
    expect(evaluatePolicy({ ...good, quantity: 0 }, {}, "shopx", ["TEE-1"]).allowed).toBe(false);
    expect(evaluatePolicy(good, {}, "other", ["TEE-1"]).allowed).toBe(false);
  });
});

describe("verifier", () => {
  const row = { ...good, id: "r1", status: "PENDING_FULFILLMENT" };
  it("verifies exact match", () => expect(verifyDestination(good, [row]).result).toBe("VERIFIED"));
  it("detects missing / duplicate / mismatch", () => {
    expect(verifyDestination(good, []).result).toBe("MISSING");
    expect(verifyDestination(good, [row, row]).result).toBe("DUPLICATE");
    expect(verifyDestination(good, [{ ...row, amount_cents: 1 }]).result).toBe("MISMATCH");
  });
});

describe("hmac", () => {
  it("round-trips and rejects tampering", async () => {
    const h = await signBody("s3cret", '{"a":1}');
    expect((await verifySignature("s3cret", h, '{"a":1}')).ok).toBe(true);
    expect((await verifySignature("s3cret", h, '{"a":2}')).ok).toBe(false);
    expect((await verifySignature("other", h, '{"a":1}')).ok).toBe(false);
  });
});