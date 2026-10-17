import { describe, it, expect } from "vitest";
import { canClaimRepair, commitEligibility, approvalDecidable, runExecutionEligible, DIAGNOSING_TTL_MS, type RunLike } from "./transitions";

const now = new Date("2026-10-17T22:00:00Z");
const run: RunLike = { id: "r2", incident_id: "i1", org_id: "o1", attempt: 2, generation_status: "GENERATED", execution_status: "SUCCEEDED", proposed_record: { a: 1 }, policy: { allowed: true } };
const inc = { id: "i1", org_id: "o1", status: "READY_TO_WRITE" };

describe("repair claim", () => {
  it("allows OPEN and FAILED", () => {
    expect(canClaimRepair("OPEN", now, now).ok).toBe(true);
    expect(canClaimRepair("FAILED", now, now).ok).toBe(true);
  });
  for (const s of ["AWAITING_APPROVAL", "READY_TO_WRITE", "RECONCILE", "VERIFIED", "REFUSED"]) {
    it(`rejects ${s}`, () => expect(canClaimRepair(s, now, now).ok).toBe(false));
  }
  it("rejects fresh DIAGNOSING (concurrent run)", () => expect(canClaimRepair("DIAGNOSING", new Date(now.getTime() - 5000), now).ok).toBe(false));
  it("recovers stale DIAGNOSING after TTL", () => {
    expect(canClaimRepair("DIAGNOSING", new Date(now.getTime() - DIAGNOSING_TTL_MS), now)).toEqual({ ok: true, recovered: true });
  });
});

describe("commit eligibility", () => {
  it("writes latest succeeded run when READY_TO_WRITE", () => expect(commitEligibility(run, inc, "r2")).toEqual({ ok: true, mode: "WRITE" }));
  it("rejects stale run", () => expect(commitEligibility(run, inc, "r3").ok).toBe(false));
  it("rejects non-executed run", () => {
    for (const e of ["NOT_CONFIGURED", "REJECTED_STATIC", "FAILED", "ERROR", "SKIPPED"])
      expect(commitEligibility({ ...run, execution_status: e }, inc, "r2").ok).toBe(false);
  });
  it("rejects mixed NOT_NEEDED/SUCCEEDED", () => expect(runExecutionEligible({ generation_status: "NOT_NEEDED", execution_status: "SUCCEEDED" })).toBe(false));
  it("accepts clean NOT_NEEDED proposal", () => expect(commitEligibility({ ...run, generation_status: "NOT_NEEDED", execution_status: "NOT_NEEDED" }, inc, "r2").ok).toBe(true));
  it("rejects cross-org/incident run", () => {
    expect(commitEligibility({ ...run, org_id: "o2" }, inc, "r2").ok).toBe(false);
    expect(commitEligibility({ ...run, incident_id: "i9" }, inc, "r2").ok).toBe(false);
  });
  for (const s of ["OPEN", "DIAGNOSING", "AWAITING_APPROVAL", "REFUSED", "FAILED"]) {
    it(`never writes ${s} incident`, () => expect(commitEligibility(run, { ...inc, status: s }, "r2").ok).toBe(false));
  }
  it("RECONCILE reconciles, VERIFIED re-verifies read-only", () => {
    expect(commitEligibility(run, { ...inc, status: "RECONCILE" }, "r2")).toEqual({ ok: true, mode: "RECONCILE" });
    expect(commitEligibility(run, { ...inc, status: "VERIFIED" }, "r2")).toEqual({ ok: true, mode: "REVERIFY_ONLY" });
  });
});

describe("approval decidable", () => {
  it("pending + awaiting + latest is decidable", () => expect(approvalDecidable({ status: "PENDING", run_id: "r2" }, "AWAITING_APPROVAL", "r2").ok).toBe(true));
  it("second decision rejected", () => expect(approvalDecidable({ status: "APPROVED", run_id: "r2" }, "AWAITING_APPROVAL", "r2").ok).toBe(false));
  it("stale incident state rejected", () => expect(approvalDecidable({ status: "PENDING", run_id: "r2" }, "OPEN", "r2").ok).toBe(false));
  it("stale run rejected", () => expect(approvalDecidable({ status: "PENDING", run_id: "r1" }, "AWAITING_APPROVAL", "r2").ok).toBe(false));
});

import { reverifyOutcome, verificationAuditAction } from "./transitions";
describe("re-verify and audit naming", () => {
  it("re-verify success stays read-only", () => expect(reverifyOutcome("VERIFIED").escalate).toBe(false));
  for (const r of ["MISMATCH", "MISSING", "DUPLICATE"]) {
    it(`re-verify ${r} escalates`, () => expect(reverifyOutcome(r).escalate).toBe(true));
    it(`${r} is not audited as verified`, () => expect(verificationAuditAction(r)).toBe("write.check_failed"));
  }
  it("VERIFIED audited as write.verified", () => expect(verificationAuditAction("VERIFIED")).toBe("write.verified"));
});

import { refusalEligibility, diffPayloads } from "./transitions";
describe("operator refusal", () => {
  const clean = { hasDestinationEffect: false, hasLiveApproval: false };
  const why = "Duplicate order with wrong amount";
  it("allows OPEN and FAILED with a valid reason", () => {
    expect(refusalEligibility("OPEN", why, clean).ok).toBe(true);
    expect(refusalEligibility("FAILED", why, clean).ok).toBe(true);
  });
  for (const s of ["DIAGNOSING", "AWAITING_APPROVAL", "READY_TO_WRITE", "RECONCILE", "VERIFIED", "REFUSED"]) {
    it(`blocks ${s}`, () => expect(refusalEligibility(s, why, clean).ok).toBe(false));
  }
  it("requires 10-500 char reason (whitespace trimmed)", () => {
    expect(refusalEligibility("OPEN", "   short   ", clean).ok).toBe(false);
    expect(refusalEligibility("OPEN", "x".repeat(501), clean).ok).toBe(false);
  });
  it("blocks when a destination effect may exist", () => expect(refusalEligibility("OPEN", why, { ...clean, hasDestinationEffect: true }).ok).toBe(false));
  it("blocks when an approval is live", () => expect(refusalEligibility("OPEN", why, { ...clean, hasLiveApproval: true }).ok).toBe(false));
  it("refused incident can never be repaired or written", async () => {
    const { canClaimRepair, commitEligibility } = await import("./transitions");
    expect(canClaimRepair("REFUSED", new Date()).ok).toBe(false);
    const run = { id: "r", incident_id: "i", org_id: "o", attempt: 1, generation_status: "NOT_NEEDED", execution_status: "NOT_NEEDED", proposed_record: {}, policy: {} };
    expect(commitEligibility(run, { id: "i", org_id: "o", status: "REFUSED" }, "r").ok).toBe(false);
  });
});

describe("conflict comparison", () => {
  it("reports changed, added and removed fields including nested", () => {
    const d = diffPayloads({ external_order_id: "o1", amount_cents: 1200, product: { sku: "A" }, note: "x" }, { external_order_id: "o1", amount_cents: 9999, product: { sku: "B" }, coupon: "Z" });
    expect(d).toEqual([
      { path: "amount_cents", original: 1200, incoming: 9999, kind: "changed" },
      { path: "coupon", original: undefined, incoming: "Z", kind: "added" },
      { path: "note", original: "x", incoming: undefined, kind: "removed" },
      { path: "product.sku", original: "A", incoming: "B", kind: "changed" },
    ]);
  });
  it("identical payloads produce no diff; type change is detected", () => {
    expect(diffPayloads({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffPayloads({ a: 1 }, { a: "1" })[0]?.kind).toBe("changed");
  });
});