import { describe, expect, it } from "vitest";
import {
  parseNormalizedOrder,
  authorizeOrder,
  verifyDestinationReadback,
  orderIdempotencyScope,
  type NormalizedOrder,
} from "./fulfillment";

const canonical: NormalizedOrder = {
  source: "commerce_test",
  external_order_id: "ord_1042",
  currency: "CAD",
  amount_cents: 4999,
  sku: "SKU-7",
  quantity: 1,
  customer_reference: "customer_7",
};

const policy = {
  allowedSources: ["commerce_test"],
  knownSkus: ["SKU-7"],
  supportedCurrencies: ["CAD"],
  maxAutomaticAmountCents: 500000,
};

describe("untrusted generated-code boundary", () => {
  it("accepts valid canonical records", () => {
    expect(parseNormalizedOrder(canonical)).toEqual({ ok: true, order: canonical });
  });
  it("rejects malformed or non-canonical payloads", () => {
    expect(parseNormalizedOrder(null)).toMatchObject({ ok: false });
    expect(parseNormalizedOrder({ ...canonical, amount_cents: "4999" })).toMatchObject({
      ok: false, reason: "INVALID_AMOUNT",
    });
    expect(parseNormalizedOrder({ ...canonical, currency: "cad" })).toMatchObject({
      ok: false, reason: "INVALID_CURRENCY",
    });
    expect(parseNormalizedOrder({ ...canonical, extra_privilege: true })).toMatchObject({
      ok: false, reason: "UNEXPECTED_FIELDS",
    });
    expect(parseNormalizedOrder({ ...canonical, quantity: -3 })).toMatchObject({
      ok: false, reason: "INVALID_QUANTITY",
    });
  });
});

describe("independent deterministic authorization policy", () => {
  it("automatically authorizes the known bounded order", () => {
    expect(authorizeOrder(canonical, policy).state).toBe("AUTO_APPROVED");
  });
  it("refuses unapproved sources and currencies", () => {
    expect(authorizeOrder({ ...canonical, source: "untrusted" }, policy)).toEqual({
      state: "REFUSED", reason: "SOURCE_NOT_AUTHORIZED",
    });
    expect(authorizeOrder({ ...canonical, currency: "USD" }, policy)).toEqual({
      state: "REFUSED", reason: "CURRENCY_NOT_AUTHORIZED",
    });
  });
  it("holds unknown SKUs and above-limit amounts for review", () => {
    expect(authorizeOrder({ ...canonical, sku: "NO-LISTING" }, policy)).toEqual({
      state: "REVIEW_REQUIRED", reason: "SKU_NOT_IN_CATALOG",
    });
    expect(authorizeOrder({ ...canonical, amount_cents: 500001 }, policy)).toEqual({
      state: "REVIEW_REQUIRED", reason: "AMOUNT_EXCEEDS_AUTOMATIC_LIMIT",
    });
  });
});

describe("destination proof instead of exit code", () => {
  it("verifies exactly one independent matching readback", () => {
    expect(verifyDestinationReadback(canonical, [canonical])).toEqual({
      state: "VERIFIED", reason: "INDEPENDENT_READBACK_MATCH",
    });
  });
  it("does not claim VERIFIED on missing/failed readback", () => {
    expect(verifyDestinationReadback(canonical, null).state).toBe("UNKNOWN");
    expect(verifyDestinationReadback(canonical, []).state).toBe("UNKNOWN");
  });
  it("refuses duplicate records even if both match", () => {
    expect(verifyDestinationReadback(canonical, [canonical, canonical])).toEqual({
      state: "REFUSED", reason: "DUPLICATE_DESTINATION_RECORDS",
    });
  });
  it("refuses a 200-success equivalent with wrong business consequence", () => {
    expect(verifyDestinationReadback(canonical, [
      { ...canonical, amount_cents: canonical.amount_cents + 100 },
    ])).toEqual({
      state: "REFUSED", reason: "DESTINATION_FIELD_MISMATCH:amount_cents",
    });
  });
});

describe("idempotency scope", () => {
  it("separates tenants and source order IDs", () => {
    expect(orderIdempotencyScope("tenant1", canonical)).not.toEqual(
      orderIdempotencyScope("tenant2", canonical)
    );
    expect(orderIdempotencyScope("tenant1", canonical)).not.toEqual(
      orderIdempotencyScope("tenant1", { ...canonical, external_order_id: "ord_1043" })
    );
  });
});
