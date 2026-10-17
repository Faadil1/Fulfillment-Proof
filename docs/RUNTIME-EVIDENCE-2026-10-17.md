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

## FIRST VERIFIED END-TO-END OUTCOME — PostgreSQL independently checked at 20:54 UTC (17 Oct 2026)

The signed-in operator completed a human approval and `Commit & verify` for test order `shopx/ord_upb135`. Screenshot shows `VERIFIED`; this assistant independently read live Lovable Cloud PostgreSQL to corroborate the effect.

- Incident `736c6140-35e4-4e98-a099-9cbeeda70d4a`: **VERIFIED**, 1 attempt, evidence `TEST_FIXTURE`.
- AI-generated CreateOS run `bee55286-63a2-45f7-85ac-db8f0986dd65`: **GENERATED / SUCCEEDED**, exit 0, sandbox `sb-01m55t2svhvmbrn0s97xvz4dxm`, execution 83 ms, code SHA-256 prefix `766b6398`.
- Human approval `4a2d5f9e-9a70-4cbf-8323-fad43701bfc6`: **APPROVED** at 20:54:04 UTC, reason `high-risk field currency changed ("usd" -> "USD")`.
- Persisted destination row `0bd60f31-f5a1-4978-9e29-f846fdada921` created 20:54:13 UTC: `shopx/ord_upb135`, `42.00 USD`, `TEE-BLK-M`, quantity `2`, customer `cus_test_01`, `PENDING_FULFILLMENT`, `TEST_FIXTURE`.
- Verifier receipt `3e38c85e-a507-4ce9-b03a-bc7dd8e502db` created at 20:54:14 UTC: **VERIFIED**, write outcome `INSERTED`, verifier `verifier-v1`, exactly **9/9 independent readback checks** passed (including unique count = 1). It references the persisted destination row and the exact AI run.
- Global DB counts checked: 1 integration, 2 incidents, 1 agent run, **1 destination record, 1 verifier receipt** at time of audit.

**Scope and limitations:** This is a real live CreateOS execution followed by human approval, an actual database write and independent database readback, using a deliberately authored `TEST_FIXTURE`. It is **not** a live Shopify transaction, a physical shipment, a Stripe payment or a Stripe Projects-provisioned external database. Stripe Projects gate remains **NOT_CONFIGURED**; cross-tenant authorization, duplicate attempts under concurrency, provider failure/recovery and deploy-from-GitHub parity require further tests.

**Gateway transitions supported by evidence:** CreateOS Execution PROVEN, Agent Code Write/Run/Fix PROVEN for this case, Independent Destination Proof PROVEN in Lovable Cloud fixture destination, Human Approval PROVEN, Evidence Integrity PROVEN for honest fixture labeling. Product Live External Destination PARTIAL; Stripe Projects BLOCKED; Production Grade Reliability ACTIVE / unproven.

## Stripe Projects initialized — operator CLI evidence (17 Oct 2026)

The owner successfully switched Stripe CLI to the authorized Stripe **live context** `acct_1TXRJrAY1xa1RYw5` for Projects infrastructure provisioning, then ran `stripe projects init fulfillment-proof` from the Codespaces checkout. CLI returned `Your project is ready` with project `fulfillment-proof` and project ID `project_61Vb3Gboaa5JldL2X16UgpHD1CA8XdO7YS7VU5JA8L4S`. CLI created `.projects/`, updated `.gitignore`, created `.claude/settings.json`, and added Stripe Projects skills.

**Truth boundary:** `PROJECT_INITIALIZED` is proven by the operator-provided CLI output. This does **not** prove that `createos/project` or any other service has been provisioned, any project-managed credential has been consumed by the published Lovable application, or any payments have been processed. Those gates remain `BLOCKED` pending `stripe projects status`, service provisioning evidence, and an authenticated subsequent CreateOS runtime test with project-managed credentials. Stripe Projects' live-account context is an infrastructure requirement, not evidence of Stripe Payments live transactions. Never commit local `.env`, `.projects/vault/`, `.projects/state.local.json` or CLI auth credentials.

## STRIPE PROJECTS SERVICE PROVISIONED — observed operator CLI (17 Oct 2026)

The owner performed `stripe projects add createos/project` under the authorized **Stripe live-account infrastructure context**, account ending `RYw5`. Interactive checkout explicitly chose `createos/free` (Free tier, **$0**), then accepted the CreateOS provider terms and disclosure. Output confirmed:

- `✓ Connected createos account` (owner-associated identity).
- `✓ createos/free provisioned`
- `✓ Resource requested`, `✓ Resource provisioned`, `✓ Credentials synced`, `✓ Project updated`.
- `● createos/project ready`.
- Project environment `default` contains `createos-plan` and `createos-project`, with eight created variables of form `CREATEOS_{PLAN,PROJECT}_{API_KEY,API_URL,CREDENTIALS,DASHBOARD_URL}`.
- Project identifier `project_61Vb3Gboaa5JldL2X16UgpHD1CA8XdO7YS7VU5JA8L4S` (public project metadata, **not** a credential).

**Stage boundary:** Stripe Projects `PROJECT_INITIALIZED`, `PROVIDER_CONNECTED`, `RESOURCE_PROVISIONED`, `CREDENTIALS_SYNCED` are supported by observed operator CLI output. `stripe projects status` after addition, a public `stripe projects share` link, and runtime use of the **new provisioned resource by the published Fulfillment Proof app** remain to be verified. The earlier sandbox run `sb-01m55t2svhvmbrn0s97xvz4dxm` used the app's preexisting `CREATEOS_SANDBOX_API_KEY`, so it **must not be falsely attributed** to Stripe Projects. In particular, `CREATEOS_PROJECT_API_KEY` (provider project control plane) must not be blindly substituted into the separately documented Sandbox SDK `CREATEOS_SANDBOX_API_KEY`.

**Secret hygiene:** Never commit `.env`, credentials, or `.projects/vault/`; `stripe projects env` (without dump flags) lists names, not secrets. Stripe's current official docs say `.projects/state.json` and `.projects/state.local.json` are intended to be committed for project sharing, after reviewing that they contain metadata rather than secret values. The repository's public `.gitignore` was aligned with this document. The new CLI-generated local changes and permissions have **not yet been reviewed or committed**.

**Citation**: https://docs.stripe.com/projects.md and https://createos.sh/docs/Services/Stripe-Projects/

## Stripe Projects verified status — provider linked, service active (operator CLI)

A subsequent `stripe projects status` output independently confirms project `fulfillment-proof` in Stripe account ending `RYw5`, with **Providers (1): createos ✓ Linked**, **Services (1): createos-project / createos / project / Free**, and **Plans (1): createos-plan / createos / free / Free**. The operator had previously generated the share URL `https://projects.dev/s#v1:createos~project`, listing the service composition. `stripe projects env` displayed the names of eight redacted variables, not their secret values. `command -v createos` returned no path in the GitHub Codespace, so CLI runtime identity has not yet been checked. A preexisting CreateOS Sandbox SDK key produced an actual generated-code run earlier, but that alone does not prove use of the **Stripe Projects-provisioned** credential. Next proof: install official CreateOS CLI, run `createos whoami` / `createos projects list` with provisioned credentials; compare resource identity and independently exercise the provisioned runtime before claiming end-to-end sponsor integration.

## Provisioned CreateOS CLI identity — owner read-only probe (17 Oct 2026)

The operator installed the official `createos` CLI release `v0.0.31` in their GitHub Codespace. The installer verified its checksum. Running `createos whoami` from the directory containing Stripe Projects-synced `.env` succeeded for the CreateOS user associated with the provider account, showing `Plan free-plan` and account creation dated 17 Oct 2026. `createos projects list` returned **"You don't have any projects yet."** This is not a Stripe Projects provisioning error: Stripe Projects `createos/project` creates the CreateOS account/resource/credentials, while an actual deployable application project is a separate explicit CreateOS project (`createos projects add`). Do not fabricate a deployed CreateOS project or conflate this CLI success with published Lovable use of new `CREATEOS_PROJECT_*` credentials.

Next test, still pending: list sandboxes, inspect available CLI actions and create a short-lived isolated sandbox using Stripe-project-provisioned account credentials if allowed by free plan, record actual sandbox ID/exit code and destroy it. Keep pre-existing verified Lovable fixture runtime undisturbed.
