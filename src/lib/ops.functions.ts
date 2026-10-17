// Control plane. Every mutation is authorized here (membership check as the caller),
// then executed with the privileged client which generated code never sees.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sha256Hex, stableStringify, NormalizedOrder } from "@/lib/domain/contract";
import { evaluatePolicy, type PolicyDecision } from "@/lib/domain/policy";
import { verifyDestination, VERIFIER_VERSION } from "@/lib/domain/verifier";
import { generateSigningSecret, secretHint } from "@/lib/domain/secret";
import { normalizeExecMs } from "@/lib/domain/exec";

const MAX_ATTEMPTS_PER_INCIDENT = 6;
const MAX_GEN_RETRIES = 2;

type Ctx = { supabase: any; userId: string };

async function assertOperator(ctx: Ctx, orgId: string) {
  const { data, error } = await ctx.supabase.rpc("can_operate", { _org: orgId });
  if (error || !data) throw new Error("Forbidden: operator role required for this organization");
}
async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}
async function audit(orgId: string, actor: string | null, action: string, detail: Record<string, unknown>) {
  const db = await admin();
  await db.from("audit_events").insert({ org_id: orgId, actor, action, detail: detail as never });
}

export const createOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ name: z.string().trim().min(2).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("create_organization", { _name: data.name });
    if (error) throw new Error(error.message);
    return { orgId: id as string };
  });

export const createIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ orgId: z.string().uuid(), name: z.string().trim().min(2).max(60), source: z.string().regex(/^[a-z0-9_-]{2,40}$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOperator(context, data.orgId);
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = "fpsec_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const db = await admin();
    const { data: integ, error } = await db
      .from("integrations")
      .insert({ org_id: data.orgId, name: data.name, source: data.source, secret_hint: secret.slice(-4) })
      .select("id")
      .single();
    if (error || !integ) throw new Error(error?.message ?? "insert failed");
    const { error: e2 } = await db.from("integration_secrets").insert({ integration_id: integ.id, secret });
    if (e2) throw new Error(e2.message);
    await audit(data.orgId, context.userId, "integration.created", { integration_id: integ.id, source: data.source });
    // Secret is returned exactly once and never readable again from the client.
    return { integrationId: integ.id, secret };
  });

/**
 * Owner-only rotation. Generates the new secret server-side and swaps it atomically via the
 * rotate_integration_secret SQL function (runs as the caller; it re-checks owner role, updates
 * secret + hint and writes an audit row with the hint only, all in one transaction).
 * The old secret is never read. The new one is returned exactly once.
 */
export const rotateIntegrationSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ integrationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const secret = generateSigningSecret();
    const { error } = await context.supabase.rpc("rotate_integration_secret", {
      _integration: data.integrationId,
      _secret: secret,
      _hint: secretHint(secret),
    });
    if (error) {
      const msg = String(error.message ?? "");
      if (/owner role required/i.test(msg)) throw new Error("Forbidden: only organization owners can rotate secrets");
      if (/not found/i.test(msg)) throw new Error("Integration not found");
      throw new Error("Rotation failed; the existing secret is unchanged");
    }
    return { integrationId: data.integrationId, secret };
  });

/** Real network round-trip: server signs a TEST_FIXTURE and POSTs it to this app's public endpoint. */
export const testIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ integrationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: integ } = await db.from("integrations").select("id, org_id, source").eq("id", data.integrationId).single();
    if (!integ) throw new Error("not found");
    await assertOperator(context, integ.org_id);
    const { data: sec } = await db.from("integration_secrets").select("secret").eq("integration_id", integ.id).single();
    const { signBody } = await import("@/lib/domain/hmac");
    const body = JSON.stringify({
      external_order_id: `conn-test-${Date.now()}`,
      source: integ.source,
      currency: "USD",
      amount_cents: 100,
      sku: "CONNECTION-TEST",
      quantity: 1,
      customer_reference: "connection-test",
      _fixture: "connection test generated by operator UI",
    });
    const origin = new URL(getRequest().url).origin;
    const url = `${origin}/api/public/ingest/${integ.id}`;
    const signed = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fp-signature": await signBody(sec!.secret, body), "x-fp-evidence": "TEST_FIXTURE" },
      body,
    });
    const signedJson = await signed.json().catch(() => ({}));
    const unsigned = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    await audit(integ.org_id, context.userId, "integration.tested", { signed: signed.status, unsigned_rejected: unsigned.status === 401 });
    return { url, signedStatus: signed.status, signedBody: signedJson, unsignedStatus: unsigned.status };
  });

export const submitFixture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ integrationId: z.string().uuid(), payloadJson: z.string().min(2).max(60_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: integ } = await db.from("integrations").select("id, org_id, source").eq("id", data.integrationId).single();
    if (!integ) throw new Error("integration not found");
    await assertOperator(context, integ.org_id);
    let payload: unknown;
    try {
      payload = JSON.parse(data.payloadJson);
    } catch {
      throw new Error("Fixture is not valid JSON");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Fixture must be a JSON object");
    const { ingestEvent } = await import("@/lib/server/ingest.server");
    return ingestEvent({
      orgId: integ.org_id,
      integrationId: integ.id,
      source: integ.source,
      payload: payload as Record<string, unknown>,
      evidence: "TEST_FIXTURE",
      signatureVerified: false,
      actor: context.userId,
    });
  });

export const addSku = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orgId: z.string().uuid(), sku: z.string().trim().min(1).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOperator(context, data.orgId);
    const { error } = await context.supabase.from("known_skus").insert({ org_id: data.orgId, sku: data.sku });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    await audit(data.orgId, context.userId, "sku.added", { sku: data.sku });
    return { ok: true };
  });

/** Diagnose → generate (AI) → execute in CreateOS → validate → policy. Bounded retries. */
export const runRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ incidentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: inc } = await db.from("incidents").select("*, inbound_events(*)").eq("id", data.incidentId).single();
    if (!inc) throw new Error("incident not found");
    await assertOperator(context, inc.org_id);
    if (["VERIFIED", "REFUSED"].includes(inc.status)) throw new Error(`incident is ${inc.status}; open a new incident instead`);
    if (inc.attempts >= MAX_ATTEMPTS_PER_INCIDENT) throw new Error("attempt budget exhausted for this incident");
    const ev = (inc as any).inbound_events;
    const payload = ev.payload as Record<string, unknown>;
    const { data: skus } = await db.from("known_skus").select("sku").eq("org_id", inc.org_id);
    const knownSkus = (skus ?? []).map((s: { sku: string }) => s.sku);
    await db.from("incidents").update({ status: "DIAGNOSING", updated_at: new Date().toISOString() }).eq("id", inc.id);

    // Operation boundary: any unexpected failure below (e.g. a run-row insert rejecting provider
    // data) must not strand the incident in DIAGNOSING with lost evidence. Return it to OPEN
    // (only if still DIAGNOSING — terminal states set by finishRun are preserved), audit, rethrow.
    try {
    const violations = inc.violations as unknown[];
    const base = { org_id: inc.org_id, incident_id: inc.id, created_by: context.userId };
    let attempt = inc.attempts;

    // Clean contract: no code generation needed; proposal is the payload itself.
    if (violations.length === 0) {
      attempt++;
      const proposed = Object.fromEntries(Object.entries(payload).filter(([k]) => !k.startsWith("_")));
      const policy = evaluatePolicy(proposed, payload, ev.source, knownSkus);
      const runId = await finishRun(db, { ...base, attempt, generation_status: "NOT_NEEDED", execution_status: "NOT_NEEDED", proposed, policy });
      await db.from("incidents").update({ attempts: attempt }).eq("id", inc.id);
      return { runId, outcome: policy.allowed ? "PROPOSED" : "REFUSED_BY_POLICY" };
    }

    const { generateTransform, staticCheck, GEN_MODEL } = await import("@/lib/server/ai.server");
    const { runInSandbox, createosConfig, SANDBOX_SHAPE, SANDBOX_EGRESS } = await import("@/lib/server/createos.server");
    let previousError: string | undefined;
    let lastRunId = "";
    for (let g = 0; g <= MAX_GEN_RETRIES; g++) {
      attempt++;
      const log: unknown[] = [];
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30_000);
      let gen;
      try {
        gen = await generateTransform({ source: ev.source, payload, violations, previousError, signal: ac.signal });
      } catch (e) {
        gen = { ok: false as const, status: 0, error: `generation aborted: ${(e as Error).message}` };
      } finally {
        clearTimeout(timer);
      }
      if (!gen.ok) {
        lastRunId = await finishRun(db, { ...base, attempt, model: GEN_MODEL, generation_status: "GENERATION_UNAVAILABLE", execution_status: "SKIPPED", error: gen.error, generation_log: [{ status: gen.status }] });
        await db.from("incidents").update({ attempts: attempt, status: "FAILED" }).eq("id", inc.id);
        return { runId: lastRunId, outcome: "GENERATION_UNAVAILABLE" };
      }
      const code = gen.data.code;
      const codeHash = await sha256Hex(code);
      log.push({ rationale: gen.data.rationale, tests: gen.data.tests, gateway_run_id: gen.runId });
      const problems = staticCheck(code);
      if (problems.length) {
        previousError = `static check: ${problems.join("; ")}`;
        lastRunId = await finishRun(db, { ...base, attempt, model: GEN_MODEL, generated_code: code, code_hash: codeHash, generation_status: "GENERATED", generation_log: log, execution_status: "REJECTED_STATIC", error: previousError });
        continue;
      }
      if (!createosConfig().configured) {
        lastRunId = await finishRun(db, { ...base, attempt, model: GEN_MODEL, generated_code: code, code_hash: codeHash, generation_status: "GENERATED", generation_log: log, execution_status: "NOT_CONFIGURED", error: "CreateOS sandbox not configured; generated code was NOT executed and cannot be proposed." });
        await db.from("incidents").update({ attempts: attempt, status: "OPEN" }).eq("id", inc.id);
        return { runId: lastRunId, outcome: "NOT_CONFIGURED" };
      }
      const sb = await runInSandbox(code, payload, gen.data.tests);
      const common = {
        ...base, attempt, model: GEN_MODEL, generated_code: code, code_hash: codeHash, generation_status: "GENERATED", generation_log: [...log, { sandbox_destroyed: sb.destroyed, tests: sb.parsed?.tests }],
        execution_status: sb.status, sandbox_id: sb.sandbox_id ?? null, sandbox_shape: SANDBOX_SHAPE, egress: SANDBOX_EGRESS,
        stdout: sb.stdout ?? null, stderr: sb.stderr ?? null, exit_code: sb.exit_code ?? null, exec_ms: sb.exec_ms ?? null,
      };
      if (sb.status !== "SUCCEEDED") {
        previousError = `${sb.error ?? ""}\n${sb.stderr ?? ""}\n${JSON.stringify(sb.parsed?.tests ?? [])}`;
        lastRunId = await finishRun(db, { ...common, error: sb.error ?? "execution failed" });
        if (sb.status === "ERROR") break; // infrastructure failure: don't burn generations
        continue;
      }
      const proposed = sb.parsed!.proposed;
      const policy = evaluatePolicy(proposed, payload, ev.source, knownSkus);
      lastRunId = await finishRun(db, { ...common, proposed, policy });
      await db.from("incidents").update({ attempts: attempt }).eq("id", inc.id);
      return { runId: lastRunId, outcome: policy.allowed ? "PROPOSED" : "REFUSED_BY_POLICY" };
    }
    await db.from("incidents").update({ attempts: attempt, status: "FAILED" }).eq("id", inc.id);
    return { runId: lastRunId, outcome: "FAILED_AFTER_RETRIES" };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await db.from("incidents").update({ status: "OPEN", updated_at: new Date().toISOString() }).eq("id", inc.id).eq("status", "DIAGNOSING");
      await audit(inc.org_id, context.userId, "incident.repair_failed", { incident_id: inc.id, error: msg });
      throw new Error(`Repair failed before completion: ${msg}. Incident returned to OPEN; safe to retry.`);
    }
  });

async function finishRun(db: any, row: any): Promise<string> {
  const { proposed, policy, ...rest } = row as { proposed?: unknown; policy?: PolicyDecision };
  // Defense in depth: normalize exec_ms here too so no call path can insert a fractional/invalid int4.
  const rawExecMs: unknown = (rest as Record<string, unknown>)["exec_ms"];
  const { data: run, error } = await db
    .from("runs")
    .insert({ ...rest, exec_ms: normalizeExecMs(rawExecMs), proposed_record: proposed ?? null, policy: policy ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await audit(row.org_id, row.created_by, "run.recorded", { run_id: run.id, generation: row.generation_status, execution: row.execution_status, sandbox_id: row.sandbox_id ?? null });
  if (policy) {
    if (!policy.allowed) {
      await db.from("incidents").update({ status: "OPEN" }).eq("id", row.incident_id);
    } else if (policy.requires_approval) {
      const proposalHash = await sha256Hex(stableStringify(proposed));
      await db.from("approvals").update({ status: "INVALIDATED" }).eq("status", "PENDING").in("run_id",
        ((await db.from("runs").select("id").eq("incident_id", row.incident_id)).data ?? []).map((r: { id: string }) => r.id));
      await db.from("approvals").insert({ org_id: row.org_id, run_id: run.id, code_hash: row.code_hash ?? "no-code", proposal_hash: proposalHash, reasons: policy.reasons });
      await db.from("incidents").update({ status: "AWAITING_APPROVAL" }).eq("id", row.incident_id);
    } else {
      await db.from("incidents").update({ status: "READY_TO_WRITE" }).eq("id", row.incident_id);
    }
  }
  return run.id;
}

export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ approvalId: z.string().uuid(), decision: z.enum(["APPROVED", "REFUSED"]), note: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: ap } = await db.from("approvals").select("*, runs(incident_id)").eq("id", data.approvalId).single();
    if (!ap) throw new Error("approval not found");
    await assertOperator(context, ap.org_id);
    if (ap.status !== "PENDING") throw new Error(`approval already ${ap.status}`);
    await db.from("approvals").update({ status: data.decision, decided_by: context.userId, decided_at: new Date().toISOString(), note: data.note ?? null }).eq("id", ap.id);
    const incidentId = (ap as any).runs.incident_id;
    await db.from("incidents").update({ status: data.decision === "APPROVED" ? "READY_TO_WRITE" : "REFUSED" }).eq("id", incidentId);
    await audit(ap.org_id, context.userId, `approval.${data.decision.toLowerCase()}`, { approval_id: ap.id, run_id: ap.run_id, code_hash: ap.code_hash });
    return { ok: true };
  });

/** Authorized write with idempotency + query-first reconciliation, then independent verification. */
export const commitAndVerify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: run } = await db.from("runs").select("*, incidents(id, status, event_id, inbound_events(payload, source, evidence_level))").eq("id", data.runId).single();
    if (!run) throw new Error("run not found");
    await assertOperator(context, run.org_id);
    const inc = (run as any).incidents;
    const ev = inc.inbound_events;
    if (!run.proposed_record || !run.policy) throw new Error("run has no proposal");

    // Re-evaluate policy at write time (catalogue may have changed).
    const { data: skus } = await db.from("known_skus").select("sku").eq("org_id", run.org_id);
    const policy = evaluatePolicy(run.proposed_record, ev.payload, ev.source, (skus ?? []).map((s: { sku: string }) => s.sku));
    if (!policy.allowed) {
      await audit(run.org_id, context.userId, "write.refused", { run_id: run.id, refusals: policy.refusals });
      throw new Error(`Refused by policy: ${policy.refusals.join("; ")}`);
    }
    if (policy.requires_approval) {
      const proposalHash = await sha256Hex(stableStringify(run.proposed_record));
      const { data: ap } = await db.from("approvals").select("*").eq("run_id", run.id).eq("status", "APPROVED").maybeSingle();
      if (!ap || ap.proposal_hash !== proposalHash || ap.code_hash !== (run.code_hash ?? "no-code"))
        throw new Error("Human approval required (or approval does not match this exact code+proposal hash)");
    }
    if (inc.status === "REFUSED") throw new Error("incident was refused");

    const order = NormalizedOrder.parse(run.proposed_record);
    const idem = await sha256Hex(`${run.org_id}|${order.source}|${order.external_order_id}`);
    const readBack = async () =>
      (await db.from("destination_records").select("*").eq("org_id", run.org_id).eq("source", order.source).eq("external_order_id", order.external_order_id)).data ?? [];

    // Query first: handles retries, duplicates, and unknown prior outcomes.
    let existing = await readBack();
    let writeOutcome = "SKIPPED_EXISTS";
    if (existing.length === 0) {
      const { error } = await db.from("destination_records").insert({
        org_id: run.org_id, ...order, idempotency_key: idem, run_id: run.id,
        evidence_level: ev.evidence_level === "TEST_FIXTURE" ? "TEST_FIXTURE" : ev.evidence_level,
      });
      writeOutcome = error ? (error.code === "23505" ? "CONFLICT_DUPLICATE" : "UNKNOWN") : "INSERTED";
      if (writeOutcome === "UNKNOWN") {
        await db.from("incidents").update({ status: "RECONCILE" }).eq("id", inc.id);
        await audit(run.org_id, context.userId, "write.unknown", { run_id: run.id, error: error?.message });
      }
      existing = await readBack();
    }
    // Independent verifier (separate module, reads durable state only).
    const v = verifyDestination(order, existing as never);
    await db.from("verification_receipts").insert({ org_id: run.org_id, run_id: run.id, result: v.result, checks: { write_outcome: writeOutcome, idempotency_key: idem, checks: v.checks } as never, verifier_version: VERIFIER_VERSION, destination_record_id: v.record_id ?? null });
    await db.from("incidents").update({ status: v.result === "VERIFIED" ? "VERIFIED" : "RECONCILE", updated_at: new Date().toISOString() }).eq("id", inc.id);
    await audit(run.org_id, context.userId, "write.verified", { run_id: run.id, result: v.result, write_outcome: writeOutcome });
    return { writeOutcome, result: v.result, checks: JSON.parse(JSON.stringify(v.checks)) as { check: string; pass: boolean }[] };
  });

export const providerStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOperator(context, data.orgId);
    const { createosWhoami } = await import("@/lib/server/createos.server");
    const createos = await createosWhoami();
    const ai = { level: process.env["LOVABLE_API_KEY"] ? "CONFIGURED" : "NOT_CONFIGURED" };
    // Stripe test API: only a successful authenticated read-only GET counts as evidence.
    const { classifyStripeApi, classifyStripeProjects } = await import("@/lib/domain/stripe-evidence");
    const sk = process.env["STRIPE_SECRET_KEY"];
    let stripe: { level: string; detail: Record<string, unknown> } = { level: classifyStripeApi(sk, null), detail: {} };
    if (sk) {
      try {
        const r = await fetch("https://api.stripe.com/v1/account", { headers: { Authorization: `Bearer ${sk}` } });
        const j: any = await r.json();
        stripe = r.ok
          ? { level: classifyStripeApi(sk, true), detail: { account_id: j.id, country: j.country, request_id: r.headers.get("request-id"), http_status: r.status } }
          : { level: classifyStripeApi(sk, false), detail: { status: r.status, error: j?.error?.message } };
      } catch (e) {
        stripe = { level: classifyStripeApi(sk, null), detail: { error: (e as Error).message } };
      }
    }
    // Stripe Projects provisioning: not verifiable from inside the app; never proven by an env var.
    const stripeProjects = classifyStripeProjects(process.env["STRIPE_PROJECTS_RESOURCE_ID"]);
    const db = await admin();
    await db.from("provider_checks").insert([
      { org_id: data.orgId, provider: "createos", evidence_level: createos.level, detail: createos.detail as never },
      { org_id: data.orgId, provider: "stripe", evidence_level: stripe.level, detail: stripe.detail as never },
      { org_id: data.orgId, provider: "stripe_projects", evidence_level: stripeProjects.level, detail: stripeProjects.detail as never },
    ]);
    return JSON.parse(JSON.stringify({ createos, ai, stripe, stripeProjects })) as { createos: { level: string; detail: Record<string, string> }; ai: { level: string }; stripe: { level: string; detail: Record<string, string> }; stripeProjects: { level: string; detail: Record<string, string> } };
  });