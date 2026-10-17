import { describe, it, expect } from "vitest";
import { driftSignature, driftFingerprint, underivedFields, promoteEligibility, classifyReuse, majorToCents, amountCandidates, validateProvenanceTests, type PromoteCtx } from "./patches";
import { evaluatePolicy } from "./policy";
import { runExecutionEligible } from "./transitions";

const drift = [{ field: "sku", code: "INVALID_TYPE" }, { field: "amount_cents", code: "INVALID_TYPE" }, { field: "$", code: "UNRECOGNIZED_KEYS" }];

describe("drift fingerprint", () => {
  it("matches SQL drift_signature ordering (observed on the live verified incident)", () => {
    expect(driftSignature([...drift, { field: "currency", code: "INVALID_FORMAT" }, { field: "customer_reference", code: "INVALID_TYPE" }, { field: "quantity", code: "INVALID_TYPE" }]))
      .toBe("$:UNRECOGNIZED_KEYS|amount_cents:INVALID_TYPE|currency:INVALID_FORMAT|customer_reference:INVALID_TYPE|quantity:INVALID_TYPE|sku:INVALID_TYPE");
  });
  it("is order-independent, ignores order ids, and is source-scoped", async () => {
    expect(await driftFingerprint("shopx", drift)).toBe(await driftFingerprint("shopx", [...drift].reverse()));
    expect(await driftFingerprint("shopx", drift)).not.toBe(await driftFingerprint("shopy", drift));
  });
});

const ok: PromoteCtx = {
  callerCanOperate: true, runOrg: "o1", generation_status: "GENERATED", execution_status: "SUCCEEDED", codeHashMatches: true,
  incidentStatus: "VERIFIED", isLatestProposal: true, receipt: { result: "VERIFIED", org: "o1", destination_record_id: "d1" },
  destination: { org: "o1", source: "shopx" }, eventSource: "shopx", alreadyPromoted: false, hasDrift: true,
};
describe("promotion guards", () => {
  it("accepts a sandbox-succeeded, verified, latest run", () => expect(promoteEligibility(ok).ok).toBe(true));
  it("rejects without a VERIFIED receipt", () => {
    expect(promoteEligibility({ ...ok, receipt: null }).ok).toBe(false);
    expect(promoteEligibility({ ...ok, receipt: { ...ok.receipt!, result: "MISMATCH" } }).ok).toBe(false);
    expect(promoteEligibility({ ...ok, receipt: { ...ok.receipt!, destination_record_id: null } }).ok).toBe(false);
  });
  it("rejects cross-org receipt or destination", () => {
    expect(promoteEligibility({ ...ok, receipt: { ...ok.receipt!, org: "o2" } }).ok).toBe(false);
    expect(promoteEligibility({ ...ok, destination: { org: "o2", source: "shopx" } }).ok).toBe(false);
  });
  it("rejects wrong source", () => expect(promoteEligibility({ ...ok, destination: { org: "o1", source: "shopy" } }).ok).toBe(false));
  it("rejects merely generated / not executed / stale / non-operator", () => {
    expect(promoteEligibility({ ...ok, execution_status: "NOT_CONFIGURED" }).ok).toBe(false);
    expect(promoteEligibility({ ...ok, generation_status: "NOT_NEEDED", execution_status: "NOT_NEEDED" }).ok).toBe(false);
    expect(promoteEligibility({ ...ok, isLatestProposal: false }).ok).toBe(false);
    expect(promoteEligibility({ ...ok, callerCanOperate: false }).ok).toBe(false);
    expect(promoteEligibility({ ...ok, codeHashMatches: false }).ok).toBe(false);
  });
});

// Two different orders with the same drift shape.
const orderA = { external_order_id: "ord_A1", source: "shopx", currency: "usd", net_total_cents: "4200", product: { sku: "TEE-BLK-M", qty: 2 }, customer: { ref: "cus_1" } };
const orderB = { external_order_id: "ord_B2", source: "shopx", currency: "eur", net_total_cents: "990", product: { sku: "MUG-01", qty: 1 }, customer: { ref: "cus_9" } };
const generic = (p: any) => ({ external_order_id: p.external_order_id, source: "shopx", currency: p.currency.toUpperCase(), amount_cents: Number(p.net_total_cents), sku: p.product.sku, quantity: p.product.qty, customer_reference: p.customer.ref });
const seeded = () => generic(orderA); // hard-coded to the original order

describe("patch reuse", () => {
  const base = { patchStatus: "ACTIVE", codeHashMatches: true, sandboxStatus: "SUCCEEDED", policyAllowed: true, expectedTests: 3, testResults: [{ pass: true }, { pass: true }, { pass: true }] };
  it("a generalizing patch proposes correctly for two DIFFERENT order ids", () => {
    for (const o of [orderA, orderB]) expect(classifyReuse({ ...base, proposed: generic(o), payload: o })).toEqual({ kind: "PROPOSE" });
  });
  it("a hard-coded (seeded) patch is quarantined on a different order", () => {
    const v = classifyReuse({ ...base, proposed: seeded(), payload: orderB });
    expect(v.kind).toBe("QUARANTINE");
    expect(underivedFields(seeded(), orderB)).toEqual(expect.arrayContaining(["external_order_id", "sku", expect.stringMatching(/^amount_cents/)]));
  });
  it("sandbox failure on new payload quarantines and falls back; infra error keeps patch", () => {
    expect(classifyReuse({ ...base, sandboxStatus: "FAILED", proposed: null, payload: orderB }).kind).toBe("QUARANTINE");
    expect(classifyReuse({ ...base, sandboxStatus: "ERROR", proposed: null, payload: orderB }).kind).toBe("FALLBACK");
  });
  it("revoked patch is never used; tampered code is quarantined", () => {
    expect(classifyReuse({ ...base, patchStatus: "REVOKED", proposed: generic(orderB), payload: orderB }).kind).toBe("FALLBACK");
    expect(classifyReuse({ ...base, codeHashMatches: false, proposed: generic(orderB), payload: orderB }).kind).toBe("QUARANTINE");
  });
  it("policy still enforced on reused output (unknown SKU needs approval; wrong source refused)", () => {
    const p = evaluatePolicy(generic(orderB), orderB, "shopx", ["TEE-BLK-M"]);
    expect(p.allowed).toBe(true); expect(p.requires_approval).toBe(true);
    const bad = evaluatePolicy({ ...generic(orderB), source: "other" }, orderB, "shopx", ["MUG-01"]);
    expect(bad.allowed).toBe(false);
    expect(classifyReuse({ ...base, proposed: generic(orderB), payload: orderB, policyAllowed: false }).kind).toBe("QUARANTINE");
  });
  it("reused-patch runs are commit-eligible only when sandbox SUCCEEDED", () => {
    expect(runExecutionEligible({ generation_status: "REUSED_VERIFIED_PATCH", execution_status: "SUCCEEDED" })).toBe(true);
    expect(runExecutionEligible({ generation_status: "REUSED_VERIFIED_PATCH", execution_status: "FAILED" })).toBe(false);
  });
});

describe("semantic derivation (narrow, deterministic)", () => {
  const major = { order: { id: "ord_M9" }, net_total: "19.95", currency: "Usd", items: [{ sku: "CAP-RED", quantity: "3" }], customer: { ref: "cus_77" } };
  const prop = { external_order_id: "ord_M9", source: "shopx", currency: "USD", amount_cents: 1995, sku: "CAP-RED", quantity: 3, customer_reference: "cus_77" };
  it('major-unit net_total "19.95" => 1995 cents without float error', () => {
    expect(majorToCents("19.95")).toBe(1995); expect(majorToCents(19.95)).toBe(1995); expect(majorToCents("0.1")).toBe(10); expect(majorToCents("20")).toBe(2000);
    expect(majorToCents("19.955")).toBeNull(); expect(majorToCents("-1")).toBeNull(); expect(majorToCents("1e3")).toBeNull();
    expect(underivedFields(prop, major)).toEqual([]);
  });
  it("accepts currency case normalisation and quantity strings from qty aliases", () => {
    expect(underivedFields({ ...prop, currency: "usd" }, major)).toEqual([]);
  });
  it("rejects wrong cents value, invented id/customer/sku, and invented quantity", () => {
    expect(underivedFields({ ...prop, amount_cents: 1996 }, major)[0]).toMatch(/amount_cents/);
    expect(underivedFields({ ...prop, external_order_id: "ord_OTHER" }, major)).toContain("external_order_id");
    expect(underivedFields({ ...prop, customer_reference: "cus_1" }, major)).toContain("customer_reference");
    expect(underivedFields({ ...prop, sku: "TEE-BLK-M" }, major)).toContain("sku");
    expect(underivedFields({ ...prop, quantity: 7 }, major)[0]).toMatch(/^quantity/);
  });
  it("conflicting totals are refused, absent totals are refused", () => {
    const conflict = { ...major, total_cents: 2500 };
    expect(amountCandidates(conflict).sort()).toEqual([1995, 2500]);
    expect(underivedFields(prop, conflict)[0]).toMatch(/conflicting/);
    const { net_total, ...none } = major;
    expect(underivedFields(prop, none)[0]).toMatch(/no derivable/);
  });
  it("agreeing aliases (cents + major) are not a conflict", () => expect(amountCandidates({ ...major, net_total_cents: 1995 })).toEqual([1995]));
  it("hard-coded old order is quarantined on a changed distinct order", () => {
    const old = { external_order_id: "ord_A1", source: "shopx", currency: "USD", amount_cents: 4200, sku: "TEE-BLK-M", quantity: 2, customer_reference: "cus_1" };
    const base = { patchStatus: "ACTIVE", codeHashMatches: true, sandboxStatus: "SUCCEEDED", policyAllowed: true, expectedTests: 2, testResults: [{ pass: true }, { pass: true }] };
    expect(classifyReuse({ ...base, proposed: old, payload: major }).kind).toBe("QUARANTINE");
    expect(classifyReuse({ ...base, proposed: prop, payload: major }).kind).toBe("PROPOSE");
  });
});

describe("provenance tests on reuse", () => {
  const t = (n: string) => ({ name: n, input: { a: 1 }, expect: { b: 2 } });
  const base = { patchStatus: "ACTIVE", codeHashMatches: true, sandboxStatus: "SUCCEEDED", policyAllowed: true, proposed: generic(orderB), payload: orderB };
  it("validates 2-8 well-formed tests only", () => {
    expect(validateProvenanceTests([t("a"), t("b")])).toHaveLength(2);
    expect(validateProvenanceTests([t("a")])).toBeNull();
    expect(validateProvenanceTests(Array.from({ length: 9 }, (_, i) => t(String(i))))).toBeNull();
    expect(validateProvenanceTests([t("a"), { name: "b", input: "x", expect: {} }])).toBeNull();
    expect(validateProvenanceTests(undefined)).toBeNull();
  });
  it("no provenance tests => quarantine (never a silent pass)", () =>
    expect(classifyReuse({ ...base, expectedTests: 0, testResults: null }).kind).toBe("QUARANTINE"));
  it("any failing provenance test => quarantine", () =>
    expect(classifyReuse({ ...base, expectedTests: 2, testResults: [{ pass: true }, { pass: false }] }).kind).toBe("QUARANTINE"));
  it("missing test results (count mismatch) => quarantine", () =>
    expect(classifyReuse({ ...base, expectedTests: 3, testResults: [{ pass: true }, { pass: true }] }).kind).toBe("QUARANTINE"));
  it("all provenance tests pass + derived values => propose", () =>
    expect(classifyReuse({ ...base, expectedTests: 2, testResults: [{ pass: true }, { pass: true }] }).kind).toBe("PROPOSE"));
});

describe("quantity must come from a named quantity field", () => {
  const p = { external_order_id: "ord_Q1", source: "shopx", currency: "USD", amount_cents: 200, sku: "PIN-1", quantity: 2, customer_reference: "cus_2" };
  const base = { patchStatus: "ACTIVE", codeHashMatches: true, sandboxStatus: "SUCCEEDED", policyAllowed: true, expectedTests: 2, testResults: [{ pass: true }, { pass: true }] };
  it("payload with amount 2 but no qty field => quarantine (no invented quantity)", () => {
    const payload = { external_order_id: "ord_Q1", amount: "2", currency: "usd", sku: "PIN-1", customer: { ref: "cus_2", id: 2 } };
    expect(underivedFields(p, payload)).toEqual(["quantity (no named quantity field in payload)"]);
    expect(classifyReuse({ ...base, proposed: p, payload }).kind).toBe("QUARANTINE");
  });
  it("conflicting qty vs quantity => quarantine", () => {
    const payload = { external_order_id: "ord_Q1", amount: "2", currency: "usd", sku: "PIN-1", customer: { ref: "cus_2" }, qty: 2, line: { quantity: "5" } };
    expect(underivedFields(p, payload)[0]).toMatch(/conflicting payload quantities: 2, 5/);
    expect(classifyReuse({ ...base, proposed: p, payload }).kind).toBe("QUARANTINE");
  });
  it('valid string qty "3" accepted', () => {
    const payload = { external_order_id: "ord_Q1", amount: "2", currency: "usd", sku: "PIN-1", customer: { ref: "cus_2" }, product: { qty: "3" } };
    expect(underivedFields({ ...p, quantity: 3 }, payload)).toEqual([]);
    expect(classifyReuse({ ...base, proposed: { ...p, quantity: 3 }, payload }).kind).toBe("PROPOSE");
  });
});