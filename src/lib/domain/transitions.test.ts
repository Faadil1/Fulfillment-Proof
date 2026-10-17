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