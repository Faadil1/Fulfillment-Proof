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

## Still unproven

- The **published** site's CreateOS key must be checked after the redeployment (preview secret visibility is not identical to active public runtime).
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
