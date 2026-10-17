# Fulfillment Proof — 2:30 Judge Video Plan

**Status:** proposed shotlist based on independently checked test-fixture evidence, **not yet recorded**. Include an identifiable team member **on camera**, as required by event instructions. Submit a public YouTube link.

## Story: "200 OK is not a business outcome"

**0:00–0:15 — Camera + user problem.**
> "I'm building Fulfillment Proof. An integration can accept an order but fail to create it in the fulfillment destination. We don't call that success just because a webhook returned HTTP 200."

**0:15–0:30 — Show the actual published dashboard at https://fulfillment-proof.lovable.app.**
> "Here is a deliberately induced test incident. Its payload differs from the expected order contract in six ways. The app labels this TEST_FIXTURE; it isn't a real customer's order."

Show `shopx/ord_upb135`, contract violations, and clearly legible fixture provenance. The incident is now VERIFIED, so use the persisted incident history to explain the progression; don't pretend it is live-progressing now.

**0:30–1:05 — Show generated repair code + real sandbox run.**
> "Our agent generated this JavaScript transform instead of using a hard-coded one. It ran in a real CreateOS sandbox with restricted egress. The sandbox reported exit code zero and passed four generated tests, including negative cases."

Show run history: `GENERATED` / `SUCCEEDED`, actual `sb-` ID, short code excerpt and tests. **Do not claim fork, desktop or pause/resume:** these are not implemented. Distinguish "4 generated tests" from robustness under repeated trials.

**1:05–1:35 — The policy is separate from the generated code.**
> "The agent normalized lowercase USD, but currency is a sensitive field. It was not allowed to promote itself. The control plane required explicit operator approval, bound to the exact code and proposal hashes."

Show `approval.approved` audit and the high-risk currency-change reason. Do not pretend the approved action happened live if showing historical records.

**1:35–2:05 — Independent persisted-state verification.**
> "After approval, our server committed one test fulfillment record and separately queried the database. The verifier checked uniqueness, order ID, source, currency, amount, SKU, quantity, customer and status. All nine checks passed."

Show `verification_receipts` VERIFIED, `write: INSERTED`, destination evidence ledger `shopx/ord_upb135`, `42.00 USD`, `TEE-BLK-M`, quantity 2, status `PENDING_FULFILLMENT`. **No package was shipped, no payment made.**

**2:05–2:25 — Security and negative outcomes.**
> "An unsigned integration request was refused with HTTP 401 while a signed test request was accepted with 202. A missing destination result would not be VERIFIED. And database uniqueness prevents duplicate rows from retries."

Only show actual observed signed/unsigned test and SQL uniqueness as supporting evidence; if describing missing-result behavior, label it as policy/code-tested rather than an observed live failure.

**2:25–2:30 — Close on camera.**
> "Fulfillment Proof: not just a passing agent run — a verifiable, controlled business result."

## Reality / sponsor disclaimers

- **CreateOS: PROVEN** via real sandbox execution `sb-01m55t2svhvmbrn0s97xvz4dxm`, exit 0, egress constrained.
- **Stripe test API: PROVEN** with read-only GET in sandbox mode; this does not imply Stripe Projects provisioned anything.
- **Stripe Projects provisioning: NOT_CONFIGURED** at last independent check. If successfully provisioned before recording, update this statement based on actual resource IDs and `stripe projects status`; otherwise do not claim meaningful Projects provisioning.
- **Test fixture: TEST_FIXTURE**, not commercial production customer.
- **Destination**: Lovable Cloud PostgreSQL `destination_records`, not a Shopify/3PL external connector.
- GitHub mirror contains text source; independent build from a fresh checkout and binary asset sync are not yet proved.

## Submission checklist

- [ ] Film the actual member on camera and share screen of published app.
- [ ] Verify video length 2–3 min and public YouTube access in incognito.
- [ ] Update this script for any newly **observed** Stripe Projects integration; do not embellish.
- [ ] Public GitHub repo: https://github.com/Faadil1/Fulfillment-Proof
- [ ] Public app: https://fulfillment-proof.lovable.app
- [ ] Publish X tagging @createosai or LinkedIn tagging CreateOS.
- [ ] Projects leaderboard with code `CreateOS-2026`, URL, public repo and share link when available.
- [ ] Official submission form before **17:30 PT / 20:30 EDT**.
