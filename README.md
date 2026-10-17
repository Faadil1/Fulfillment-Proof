# Fulfillment Proof

**Build Agents That Run Code — CreateOS × Stripe Projects Hackathon (17 October 2026)**

> **Status: BUILD IN PROGRESS.** This public repository is the submission source of truth. Do not infer sponsor compliance, a live agent run, or a completed business outcome from its existence.

## Problem

A paid order can be accepted by a source system but remain absent or incorrect in a downstream fulfillment destination. HTTP 200 and passing unit tests are not proof of the actual business result.

## Product

Fulfillment Proof is an AI-native, **outcome-gated integration recovery** operator:

1. Ingest a signed integration event and persist its source, provenance and contract.
2. Detect contract violations or missing destination consequences.
3. Have an agent write, execute and repair TypeScript/JavaScript code in a **real CreateOS Sandbox** with constrained egress.
4. Evaluate the generated proposed operation independently; keep privileged write credentials in the control plane, never the untrusted agent.
5. Refuse, require human approval, or execute an exactly scoped idempotent operation under deterministic policy.
6. Independently re-read destination state, verify that the correct record exists exactly once, and store a receipt.

## Trust & safety constraints

- No VERIFIED status without independent persisted-state readback and matching operation identifiers.
- CreateOS fork clones a VM snapshot, not external Stripe/Neon state. Fork requires actual plan/quota confirmation.
- Egress allowlists restrict network destinations, not API methods or database permissions.
- Generated code must not receive privileged database credentials or modify policies or verification criteria.
- Never blindly retry external writes of unknown outcome; reconcile destination first.
- Intentionally generated QA source events are TEST_FIXTURE, actual test-mode provider calls LIVE_TEST_MODE, not production processing.
- Never commit secrets or include them in logs, public receipts or screenshots.
- Pause/resume and human authorization must be orchestrated independently, not implied by a suspended VM.

## Sponsors — operational proof required

**CreateOS Sandbox**: actual sandbox ID, code generated and run, captured stdout/stderr/exit code, enforced network rule, and cleanup; pause/fork optional if genuinely supported by quota.
Docs: https://createos.sh/docs/Sandbox/Overview/

**Stripe Projects**: real provisioned service and credentials used in the application core loop, not a screenshot-only setup step.
Docs: https://docs.stripe.com/projects and https://projects.dev/hackathon-participants

CreateOS EU API address provided by organizers: https://api-eu.sb.createos.sh/

**Sponsor provisioning, credentials, and run results have not yet been verified in this conversation.**

## Development

Application code is currently being generated in Lovable. This repository will receive the source when it is available, then the real package scripts, configuration and test instructions will be documented. Avoid GitHub Actions due to unavailable Actions budget.

## Submission checklist (not yet achieved)

- [ ] Application source synchronized and reviewed
- [ ] Authentication, database, security and RLS verified
- [ ] Stripe Projects provisioner proof
- [ ] CreateOS generated/repaired-code execution proof
- [ ] Authorized write + independent destination readback
- [ ] Negative/refusal and idempotency recovery tests
- [ ] Public runtime tested and accessible
- [ ] README updated with exact functionality/limitations
- [ ] 2–3 minute public YouTube video with team member on camera
- [ ] Public X or LinkedIn post
- [ ] Projects leaderboard submission with code CreateOS-2026
- [ ] Official form submission by 17:30 PT / 20:30 EDT

## Governance

QUALIFY → DECIDE → DESIGN → DELIVER → AUDIT → EXPAND. All Conditional Gateway Registry checks must be classified ACTIVE, N/A, BLOCKED, or PROVEN; never silently omitted. Evidence labels: NOT_IMPLEMENTED, NOT_CONFIGURED, TEST_FIXTURE, LIVE_TEST_MODE, LIVE_OBSERVED, PARTIAL, UNKNOWN, REFUSED.
