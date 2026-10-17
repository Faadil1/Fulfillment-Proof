// Pure incident state-machine guards. Server code enforces these with conditional
// (compare-and-set) UPDATEs; this module is the single source of truth and is tested.

export const REPAIR_CLAIMABLE = ["OPEN", "FAILED"] as const;
/** A DIAGNOSING claim older than this is treated as a crashed worker and may be re-claimed. */
export const DIAGNOSING_TTL_MS = 10 * 60 * 1000;

export type RepairClaim = { ok: true; recovered: boolean } | { ok: false; reason: string };

export function canClaimRepair(status: string, updatedAt: string | Date, now: Date = new Date()): RepairClaim {
  if ((REPAIR_CLAIMABLE as readonly string[]).includes(status)) return { ok: true, recovered: false };
  if (status === "DIAGNOSING") {
    const age = now.getTime() - new Date(updatedAt).getTime();
    if (age >= DIAGNOSING_TTL_MS) return { ok: true, recovered: true };
    return { ok: false, reason: `repair already in progress (claimed ${Math.round(age / 1000)}s ago); stale claims auto-recover after ${DIAGNOSING_TTL_MS / 60000} min` };
  }
  return { ok: false, reason: blockedReason(status) };
}

export function blockedReason(status: string): string {
  switch (status) {
    case "AWAITING_APPROVAL": return "awaiting a human approval decision; approve or refuse first";
    case "READY_TO_WRITE": return "a proposal is ready; commit & verify it instead of re-running";
    case "RECONCILE": return "write outcome is uncertain; reconcile (re-query destination) before any new repair";
    case "VERIFIED": return "incident is VERIFIED; nothing to repair";
    case "REFUSED": return "incident was REFUSED; open a new incident instead";
    default: return `incident status ${status} does not allow this action`;
  }
}

/** Cutoff timestamp for the stale-DIAGNOSING branch of the atomic claim. */
export function staleCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - DIAGNOSING_TTL_MS).toISOString();
}

export type RunLike = { id: string; incident_id: string; org_id: string; attempt: number; generation_status: string; execution_status: string; proposed_record: unknown; policy: unknown };

/** Whether a run's execution evidence permits it to be written at all. */
export function runExecutionEligible(run: Pick<RunLike, "generation_status" | "execution_status">): boolean {
  return (run.generation_status === "GENERATED" && run.execution_status === "SUCCEEDED")
    || (run.generation_status === "NOT_NEEDED" && run.execution_status === "NOT_NEEDED");
}

export type CommitMode = { ok: true; mode: "WRITE" | "RECONCILE" | "REVERIFY_ONLY" } | { ok: false; reason: string };

/**
 * Decides whether commitAndVerify may proceed for this run.
 * latestProposalRunId = id of the newest run of the incident that carries a proposal.
 */
export function commitEligibility(run: RunLike, incident: { id: string; org_id: string; status: string }, latestProposalRunId: string | null): CommitMode {
  if (run.incident_id !== incident.id || run.org_id !== incident.org_id) return { ok: false, reason: "run does not belong to this incident/org" };
  if (!runExecutionEligible(run)) return { ok: false, reason: `run not eligible: ${run.generation_status}/${run.execution_status}` };
  if (!run.proposed_record || !run.policy) return { ok: false, reason: "run has no proposal" };
  if (latestProposalRunId !== run.id) return { ok: false, reason: "stale run: a newer proposal exists for this incident" };
  switch (incident.status) {
    case "READY_TO_WRITE": return { ok: true, mode: "WRITE" };
    case "RECONCILE": return { ok: true, mode: "RECONCILE" };
    case "VERIFIED": return { ok: true, mode: "REVERIFY_ONLY" };
    default: return { ok: false, reason: blockedReason(incident.status) };
  }
}

/** Whether a pending approval may still be decided. */
export function approvalDecidable(approval: { status: string; run_id: string }, incidentStatus: string, latestProposalRunId: string | null): { ok: true } | { ok: false; reason: string } {
  if (approval.status !== "PENDING") return { ok: false, reason: `approval already ${approval.status}` };
  if (incidentStatus !== "AWAITING_APPROVAL") return { ok: false, reason: `stale approval: incident is ${incidentStatus}` };
  if (latestProposalRunId !== approval.run_id) return { ok: false, reason: "stale approval: a newer proposal exists" };
  return { ok: true };
}

/** Operator guidance for each status (rendered in UI). */
export function statusGuidance(status: string): string {
  switch (status) {
    case "OPEN": return "Ready: run Diagnose & repair.";
    case "FAILED": return "Last repair failed; review the run log, then retry.";
    case "DIAGNOSING": return "Repair claimed and running. If a worker crashed, the claim auto-expires after 10 minutes.";
    case "AWAITING_APPROVAL": return "Blocked on a human decision: approve or refuse the latest proposal.";
    case "READY_TO_WRITE": return "Commit & verify the latest proposal.";
    case "RECONCILE": return "Write outcome unknown. Re-query the destination; no new write happens if a record exists.";
    case "VERIFIED": return "Independent readback confirmed the record. Re-verify is read-only.";
    case "REFUSED": return "Refused. No write will happen for this incident.";
    default: return "";
  }
}

/** Re-verification of a VERIFIED incident: anything but VERIFIED is an alert that must escalate to RECONCILE. */
export function reverifyOutcome(result: string): { escalate: boolean } {
  return { escalate: result !== "VERIFIED" };
}

/** Audit action name must reflect the actual verifier outcome. */
export function verificationAuditAction(result: string): string {
  return result === "VERIFIED" ? "write.verified" : "write.check_failed";
}