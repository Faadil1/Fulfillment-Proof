# Live acceptance — Verified Patch Reuse (operator-run)

**Pending**, not a fabricated recording. The existing `TEST_FIXTURE` run `bee55286-63a2-45f7-85ac-db8f0986dd65` is actual generated code executed in CreateOS with 4 generated tests and an immutable VERIFIED destination receipt. At this writing `verified_patches` had 0 rows.

## Acceptance path

1. Sign in to **https://fulfillment-proof.lovable.app/console** as org operator/owner. Select **ord_upb135** (already VERIFIED). In **Repair provenance** click **Promote verified repair** once. Expect the `Verified patch registry` to show an **ACTIVE** `v1`, provenance evidence `TEST_FIXTURE`, source `shopx`, code hash prefix `766b6398`. Promotion does not trigger any order write. Database `verified_patches` should have 1 active patch referencing the original run, receipt and destination.
2. In **Author test fixture**, select **Shop X checkout** and click **Insert drifted template** (generates a new unique `ord_*` id). Keep the same shape and field names as the original drift, so the contract violation signature/fingerprint is the same; click **Submit fixture** once. Expect **TEST_FIXTURE** OPEN and six contract violations. The event creation in this panel is **unsigned by design**; do not call it signed production traffic.
3. Select new OPEN incident and click **Diagnose & repair** once. Expect CreateOS sandbox execution of the **ACTIVE VERIFIED_PATCH**, re-running **four provenance tests** and applying the code to the **new order id**. On success, a new `runs` row must show `generation_status=REUSED_VERIFIED_PATCH`, `repair_strategy=VERIFIED_PATCH`, `execution_status=SUCCEEDED`, a **new sandbox id**, and 4/4 provenance tests. The run should reach **AWAITING_APPROVAL**, **not VERIFIED**, and must not write automatically.
4. Review `source, external_order_id, currency, amount_cents, sku, quantity, customer_reference` and approve only if all values correctly derive from this new fixture. Human approval must be bound to the current run's code and proposal hashes. Only then click **Commit & verify**, and corroborate one new destination record and 9/9 independent checks.
5. Negative path: a new incompatible payload with the same signature must either be blocked/quarantined with a recorded reason and bounded fresh AI fallback, or require operator review; never silently insert or claim VERIFIED. **Do not intentionally corrupt existing verified receipts or records** to demonstrate this.

## Fail-closed results

- No patch/failed promotion: **NO PATCH PROVEN**; existing validated run remains intact.
- Sandbox failed or no tests: no proposal from reuse; audit and fallback required; **not** evidence of successful patch execution.
- Readback failed: incident **RECONCILE** and no VERIFIED promotion.
- Double-click/concurrent attempt: second claim refused or deduplicated, not two separate committed consequences.
- All this is **TEST_FIXTURE**; no external logistics/shipment or Stripe payment.

## Further operator acceptance

Use the **Test connection** control once after refresh. Expected actual responses: signed new fixture HTTP **202**, *identical signed body replay* HTTP **200 duplicate=true** with **same event id/incident id**, unsigned HTTP **401**, stored duplicate count **1**. This is separate from the unsigned fixture authoring workflow. Capture UI and inspect durable rows before recording as PROVEN.

## Submission facts

- Published app: https://fulfillment-proof.lovable.app
- Public source: https://github.com/Faadil1/Fulfillment-Proof
- Stripe Projects share: https://projects.dev/s#v1:createos~project
- Real sponsor-side CreateOS Sandbox: `sb-01m55xmmmemdh0yt5y0v9j65ta` created/executed/deleted with Stripe Projects-provisioned CLI credentials, **separate** from the Lovable app's earlier SDK key.
- Leaderboard hackathon code is **unknown** until supplied by organizer; previous `CreateOS-2026` string was rejected.
- Video and social links remain **not submitted** unless operator supplies proof.

Record the actual time, new run/sandbox ID, test results, approval and receipt when live actions occur. Do not promote to PROVEN from unit tests alone.
