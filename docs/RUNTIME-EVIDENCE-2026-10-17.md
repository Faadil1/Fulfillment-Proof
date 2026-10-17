# Runtime evidence — 17 October 2026

This document captures the first observed CreateOS integration smoke tests executed by the Lovable development agent after the owner set `CREATEOS_SANDBOX_API_KEY` in Lovable Secrets.

## CreateOS Sandbox: real execution (PROVEN by Lovable runtime test)

- Control plane: `https://api-eu.sb.createos.sh`.
- `whoami` succeeded against the live CreateOS API in **216 ms**.
- Sandbox `sb-01m55qhqg9veyhkk0njer7fadg` created with `s-1vcpu-1gb`, `devbox:1` and nonempty egress rule.
- Code syntax check passed; a trivial actual JavaScript transform was executed with **exit code 0** in **75 ms**. One functional scenario was successful.
- The sandbox was destroyed after execution, in approximately **1.3 seconds**.
- Separate sandbox `sb-01m55qj11zyyqw1d8eceg2a002` exercised egress rule `["127.0.0.1:9"]`; access to `example.com` failed with `EAI_AGAIN`. This shows a denied outbound route, **not** exhaustive proof against exfiltration or proof that an allowed remote endpoint can be reached.
- `13/13` tests reported passing by the Lovable build agent (11 domain and 2 sandbox-config tests). Type checking reported clean.

**Evidence boundary:** these observations are based on the development agent's executed provider calls, not an independently authenticated production operator incident run. No owner-paid/production shipment or payment occurred.

## Published operator runtime — observed from participant recording

The participant supplied a 20.8-second screen recording of the **published** https://fulfillment-proof.lovable.app/console operator UI on 17 October 2026. After creating organization `Test`, they clicked `Run live check`, and the visible provider statuses became:

- **CreateOS Sandbox:** `LIVE_OBSERVED` — endpoint `https://api-eu.sb.createos.sh` shown.
- **AI generation:** `CONFIGURED` — this is a configuration status, NOT yet proof of an AI generation run on a real incident.
- **Stripe (via Stripe Projects):** `NOT_CONFIGURED` — no evidence of Stripe Projects provisioning. A separate Stripe test-mode dashboard screenshot only confirms access to Stripe Sandbox; it does not close the Projects gate.
- **Incidents / approvals / reconciliation / verified receipts:** all **0**. No integration or destination record exists yet in the shown workspace.
- A public landing and authenticated operator console visibly rendered without a blank page.

This extends provider-check observation to the published runtime. It **does not** prove the full repair-and-verification loop, vendor compliance or a production order outcome.

## Still unproven

- The **published** site's CreateOS key check is now visibly confirmed by the participant's live console recording. Re-run it after later redeploys.
- Real end-to-end: authenticated user → incident → AI-generated repair → CreateOS → approval → persisted destination → independent verifier receipt. **NOT YET RUN.**
- Stripe Projects CLI provisioning and downstream resource use: **NOT_CONFIGURED**.
- Fork, pause/resume and desktop: **NOT_IMPLEMENTED**; no claim to have used them.
- Production customer order source / real fulfillment provider: **NOT_CONNECTED**. UI manually introduced events must remain `TEST_FIXTURE`.
- The public operator URL and account sign-in should receive a full published-runtime audit before submission.

## Next tests

1. Publish after adding secret; log in and use `Run live check` to confirm CreateOS from published runtime.
2. Create an organization, an integration and a known SKU. Test signed + unsigned ingress.
3. Submit an explicit `TEST_FIXTURE` with `net_total_cents` and `product.sku`; observe created incident.
4. Generate code through AI, execute in CreateOS with actual sandbox ID and stdout/stderr/exit code.
5. Verify refusal path for unknown SKU / high amount, approval binding, authorized write, idempotent retry and independent destination readback receipt.
6. Provision a real service with Stripe Projects, consume its credentials securely and record actual provider receipt.

## Stripe test-mode key validation (development server)

After the project owner added `STRIPE_SECRET_KEY` through the secure Lovable Secrets UI, the Lovable development agent executed a **read-only** request `GET https://api.stripe.com/v1/account` with the configured key on 17 October 2026.

- API returned HTTP **200** with a Stripe request ID (redacted, not recorded in public GitHub).
- Key classification was **LIVE_TEST_MODE**, not production.
- No Stripe objects were created or mutated; no API key value was shown.
- At the time of inspection, the most recent persisted production `provider_checks` had CreateOS **LIVE_OBSERVED** and Stripe **NOT_CONFIGURED**, before the new key was added.
- After deploying the new secret, an authenticated user must run **Run live check** on the *published app* to store and verify the current production status.
- **Stripe Projects CLI provisioning is NOT proven** by this Stripe test-mode API call; independent Stripe Projects `status` and resource evidence are still required.

## Source synchronization note

The manually created public GitHub repository contains core backend, SQL migrations, routes, domain logic, and deployment configuration imported from Lovable. The UI primitives and binary assets are not yet fully mirrored and the GitHub checkout has not been proven build-identical to the published Lovable runtime. Do not report `GITHUB_SYNC_COMPLETE` until the actual checkout passes build and runtime checks.

## Published operator provider checks persisted (20:26 UTC)

With the participant signed into the published app, the provider-check action persisted these status rows to Lovable Cloud PostgreSQL on 17 October 2026, verified separately by querying the application's `provider_checks` table:

- `createos`: `LIVE_OBSERVED`
- `stripe`: `LIVE_TEST_MODE` (`GET /v1/account` success shown on the participant's screenshot)
- `stripe_projects`: `NOT_CONFIGURED`

This verifies the **published authenticated runtime's provider reachability**, not the full business transaction or Stripe Projects provisioning. The screenshot disclosed a Stripe account identifier and request identifier; these are intentionally not repeated here.

An independent read-only database count at the same point showed one organization and zero integrations, inbound events, incidents, agent runs, approvals, destination records and verification receipts. The next required reality gate is an end-to-end authenticated `TEST_FIXTURE` incident with CreateOS execution, policy decision and independent destination readback.

## Run persistence regression: fractional CreateOS execution duration

On 17 Oct 2026, the authenticated operator triggered `Diagnose & repair` for a `TEST_FIXTURE` incident with six contract violations. The operation failed before recording a `runs` row with the PostgreSQL error `invalid input syntax for type integer: "72.967"`.

**Root cause verified in source and database schema:** CreateOS returned a fractional `exec_ms` value, but `public.runs.exec_ms` is `integer`. The run insert rejected 72.967; incident was left `DIAGNOSING` with zero attempts recorded. No destination rows or independent receipts were created.

**Repair:** Introduced `normalizeExecMs`, at both the provider boundary and the persistence boundary, to round valid finite non-negative durations (72.967 → 73) to a bounded integer and map invalid inputs to null. Added a guarded failure path to make DIAGNOSING incidents recoverable and a targeted regression suite. Lovable build agent reported **31/31 tests passing**, typecheck clean and build successful.

**Recovery verified independently:** Only incident `736c6140-35e4-4e98-a099-9cbeeda70d4a` was conditionally reset from `DIAGNOSING` to `OPEN`, while retaining `attempts=0`; an `incident.recovered_after_exec_ms_serialization_failure` audit event exists. No evidence of successful business repair from the failed attempt survives, so it is **UNKNOWN** rather than success. App redeploy was initiated, but full production retry had not yet been observed at this audit point.

Code sync commit: `e048a5b21cc6d05668c12945c00c47f342986d4c`.

## First AI-generated CreateOS repair — approved only by evidence gate pending (20:50:34 UTC)

A participant screen recording of the published authenticated control room was cross-checked against live PostgreSQL tables `incidents`, `runs`, `approvals`, `destination_records` and `verification_receipts`.

- Input: `TEST_FIXTURE` order `ord_upb135`, source `shopx`, six contract violations; **not a live merchant order**.
- Actual AI generation: `runs.generation_status=GENERATED`, model gateway run recorded; agent-written `transform(input)` saved with SHA-256 code hash `766b6398e611a4604b565fd2341924965f4c1ab27f612e621d3d54bede5dfde`.
- Actual CreateOS execution: `runs.execution_status=SUCCEEDED`, sandbox `sb-01m55t2svhvmbrn0s97xvz4dxm`, `s-1vcpu-1gb`, constrained egress `127.0.0.1:9`, exit code `0`, duration `83` ms, empty stderr.
- Generated transformation returned canonical order: `shopx/ord_upb135`, currency `USD` normalized from `usd`, amount `4200` cents, `TEE-BLK-M`, quantity `2`, `cus_test_01`.
- Four **generated** tests executed in sandbox and reported passing: drifted sample, decimal major-unit / string-quantity, rejection of fractional quantity, rejection of inconsistent totals.
- Independent policy evaluated the proposal and returned `allowed=true; requires_approval=true` because a currency field was changed. `incidents.status=AWAITING_APPROVAL`. The approval proposal is bound to the recorded code hash and proposal hash. Approval row status `PENDING`.
- At this verification, there were **zero destination records and zero verification receipts**. **A successful CreateOS code run is not a verified business effect.** No Stripe live payments, shipments or external destination effects are demonstrated.
- Next required operator action: review the exact proposal and explicitly approve or refuse the `TEST_FIXTURE` change. Only after separate `Commit & verify` should the control plane write to the app's own `destination_records` table and independently read it back. Re-check evidence before promoting `VERIFIED`.
- The local app-owned PostgreSQL table is currently the destination; it is **not evidence of an independently provisioned Stripe Projects database**. Stripe Projects remains `NOT_CONFIGURED`.

Evidence boundary: generated-code tests and a production browser run were observed; no claim of general reliability, end-to-end real commerce fulfillment, or Stripe Projects provisioner compliance.
