# Fulfillment Proof

CreateOS × Stripe Projects hackathon entry. An operator control room that prevents orphaned paid orders:
inbound order → strict normalized contract → AI-generated repair executed **only** inside a CreateOS Sandbox →
policy + human approval → idempotent write to `destination_records` → **independent verifier** reads the row back.

## Architecture / security boundary

```text
signed POST /api/public/ingest/:integrationId  ──►  inbound_events ─► incidents
                                                         │
operator "Diagnose & repair"  ──► Lovable AI Gateway (code as TEXT, never eval'd on server)
                                    │ static gate (no require/process/fetch/eval)
                                    ▼
                         CreateOS microVM s-1vcpu-1gb devbox:1, egress ["127.0.0.1:9"]
                         node --check + harness → stdout FP_RESULT {tests, proposed}
                         sandbox destroyed in finally
                                    ▼
             control plane: zod contract + policy-v1 (+ approval bound to code+proposal sha256)
                                    ▼
             query-first idempotent insert (unique org+source+external_order_id, idempotency_key)
                                    ▼
             verifier-v1 (src/lib/domain/verifier.ts, separate from generator) → verification_receipts
```

* Generated code never receives DB credentials; it can only print a proposed record.
* Browser clients have **SELECT-only** RLS access (org-scoped via `is_member`). All writes go through server functions that first check `can_operate` as the caller, then use the service role.
* `integration_secrets` has RLS enabled and no policies/grants for clients; the secret is shown once at creation.
* Max 2 generation retries per run (3 attempts), 30 s abort per generation, 6 attempts per incident.

## Environment / secrets (Project Settings → Secrets)

| Name | Required | Purpose |
|---|---|---|
| `LOVABLE_API_KEY` | managed | AI gateway (model `openai/gpt-6-astra`). Missing/failed → run `GENERATION_UNAVAILABLE`. |
| `CREATEOS_SANDBOX_API_KEY` | yes for execution | CreateOS key (createos.sh → Profile). Missing → `NOT_CONFIGURED`; generated code is not executed nor proposed. |
| `CREATEOS_SANDBOX_BASE_URL` | optional | Defaults to `api-eu.sb.createos.sh`. |
| `STRIPE_SECRET_KEY` | optional | From Stripe Projects provisioning. Status shows `LIVE_TEST_MODE`/`LIVE_OBSERVED` only after a successful `GET /v1/account` (account id + request id recorded in `provider_checks`). |
| `STRIPE_PROJECTS_RESOURCE_ID` | optional | Declares the Stripe Projects resource; shown as `DECLARED_BY_ENV`, not as proof. |

### Stripe Projects (external setup)
1. Install Stripe CLI and the Projects plugin; `stripe projects init` in this repo.
2. Provision services through `stripe projects add ...` (e.g. Stripe sandbox account / other providers offered by the catalog).
3. Copy the generated credentials into Project Settings → Secrets (`STRIPE_SECRET_KEY`, `STRIPE_PROJECTS_RESOURCE_ID`).
4. In the console click **Run live check**. Without a successful call the badge stays `NOT_CONFIGURED`/`REFUSED`/`UNKNOWN`.

## Evidence levels
`NOT_CONFIGURED`, `TEST_FIXTURE` (operator-authored or connection-test events: real DB rows, not production orders),
`LIVE_TEST_MODE`, `LIVE_OBSERVED` (requires real IDs from a successful network call, e.g. a sandbox id), `PARTIAL`, `UNKNOWN`, `REFUSED`.

## Signing inbound events
```
t=$(date +%s); body='{"external_order_id":"A1",...}'
sig=$(printf "%s.%s" "$t" "$body" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)
curl -X POST "$APP/api/public/ingest/$INTEGRATION_ID" -H "x-fp-signature: t=$t,v1=$sig" -H "x-fp-evidence: TEST_FIXTURE" -d "$body"
```
Tolerance 300 s. Unsigned / wrong signature → 401. Unknown integration → 404.

## Operational test plan
1. Sign up, confirm email, create organization.
2. Create integration → copy secret → **Test connection** (expect signed 202, unsigned 401).
3. Author drifted fixture (`net_total_cents`, nested `product.sku`) → incident with violations.
4. **Diagnose & repair**: without CreateOS key → run `NOT_CONFIGURED`, no proposal. With key → sandbox id, stdout, exit code.
5. Unknown SKU → approval request → Approve → **Commit & verify** → receipt `VERIFIED`; repeat commit → `SKIPPED_EXISTS` still one row.
6. Refuse an approval → commit is blocked; no destination row.
7. `bunx vitest run src/lib/domain` — contract, policy (500000 threshold), verifier, HMAC tests.

## Limitations
* Sandbox pause/resume and fork are **not used** (optional capabilities; not simulated).
* Egress allowlist uses a single loopback rule because an empty list means allow-all in CreateOS.
* Model output is constrained by JSON schema + static gate, but true isolation is the microVM.
* No shipments, refunds or money movement are ever created.

## Hackathon submission checklist
- [ ] Public GitHub URL (connect GitHub in Lovable; no GitHub Actions used)
- [ ] 2–3 min camera YouTube video
- [ ] Public post
- [ ] Leaderboard tag `CreateOS-2026`
- [ ] Official form before **20:30 EDT**