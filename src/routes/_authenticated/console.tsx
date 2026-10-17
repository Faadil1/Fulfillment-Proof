import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Evidence, Status, Empty } from "@/components/Evidence";
import {
  createOrganization, createIntegration, testIntegration, submitFixture, addSku,
  runRepair, decideApproval, commitAndVerify, providerStatus,
} from "@/lib/ops.functions";

export const Route = createFileRoute("/_authenticated/console")({
  head: () => ({
    meta: [
      { title: "Control room — Fulfillment Proof" },
      { name: "description", content: "Incident queue, sandbox execution, approvals and verification ledger." },
      { property: "og:title", content: "Control room — Fulfillment Proof" },
      { property: "og:description", content: "Operator control room." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Console,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function loadWorkspace() {
  const { data: mems } = await supabase.from("memberships").select("org_id, role, organizations(name)");
  if (!mems?.length) return null;
  const m = mems[0] as Any;
  const org = m.org_id as string;
  const q = (t: string, order = "created_at", limit = 50) =>
    (supabase.from(t as never).select("*").eq("org_id", org).order(order, { ascending: false }).limit(limit) as any).then((r: Any) => (r.data ?? []) as Any[]);
  const [integrations, events, incidents, runs, approvals, records, receipts, audit, skus, checks] = await Promise.all([
    q("integrations"), q("inbound_events", "received_at"), q("incidents"), q("runs", "created_at", 200), q("approvals", "created_at", 100),
    q("destination_records"), q("verification_receipts", "created_at", 100), q("audit_events", "created_at", 40),
    (supabase.from("known_skus").select("sku").eq("org_id", org) as any).then((r: Any) => r.data ?? []), q("provider_checks", "created_at", 10),
  ]);
  return { org, orgName: m.organizations?.name as string, role: m.role as string, integrations, events, incidents, runs, approvals, records, receipts, audit, skus: skus.map((s: Any) => s.sku) as string[], checks };
}

const DRIFT_FIXTURE = (source: string) =>
  JSON.stringify({ external_order_id: `ord_${Math.random().toString(36).slice(2, 8)}`, source, currency: "usd", net_total_cents: "4200", product: { sku: "TEE-BLK-M", qty: 2 }, customer: { ref: "cus_test_01" } }, null, 2);

function Console() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const ws = useQuery({ queryKey: ["ws"], queryFn: loadWorkspace });
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ws"] });

  async function act<T>(label: string, fn: () => Promise<T>, ok?: (r: T) => string) {
    setBusy(label); setFlash(null);
    try { const r = await fn(); if (ok) setFlash({ tone: "ok", text: ok(r) }); }
    catch (e) { setFlash({ tone: "err", text: (e as Error).message }); }
    finally { setBusy(null); refresh(); }
  }

  const fCreateOrg = useServerFn(createOrganization);
  if (ws.isLoading) return <div className="p-8 font-mono text-sm text-muted-foreground">Loading workspace…</div>;
  if (ws.error) return <div className="p-8 text-destructive">{(ws.error as Error).message}</div>;
  if (!ws.data) return <CreateOrg onCreate={(name) => act("org", () => fCreateOrg({ data: { name } }))} busy={busy === "org"} flash={flash} />;

  const d: Any = ws.data;
  const inc = d.incidents.find((i: Any) => i.id === selected) ?? null;
  const counts = {
    open: d.incidents.filter((i: Any) => !["VERIFIED", "REFUSED"].includes(i.status)).length,
    approval: d.approvals.filter((a: Any) => a.status === "PENDING").length,
    verified: d.receipts.filter((r: Any) => r.result === "VERIFIED").length,
    reconcile: d.incidents.filter((i: Any) => i.status === "RECONCILE").length,
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-4 px-5 py-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Fulfillment Proof · {d.orgName} · {d.role}</p>
            <h1 className="mt-1 text-3xl text-foreground">Order → fulfillment control room</h1>
          </div>
          <dl className="flex flex-wrap gap-6">
            {[["Open incidents", counts.open], ["Awaiting approval", counts.approval], ["Need reconcile", counts.reconcile], ["Verified receipts", counts.verified]].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-display text-2xl">{v}</dd></div>
            ))}
            <button className="btn-ghost self-center" onClick={async () => { await supabase.auth.signOut(); nav({ to: "/auth" }); }}>Sign out</button>
          </dl>
        </div>
      </header>
      {flash && (
        <div role="status" className={`mx-auto mt-3 max-w-[1500px] px-5 text-sm ${flash.tone === "err" ? "text-destructive" : "text-primary"}`}>{flash.text}</div>
      )}
      <main className="mx-auto grid max-w-[1500px] gap-5 px-5 py-5 lg:grid-cols-[420px_1fr]">
        <div className="space-y-5">
          <Providers orgId={d.org} checks={d.checks} act={act} busy={busy} />
          <Integrations d={d} act={act} busy={busy} />
          <Fixture d={d} act={act} busy={busy} />
          <section className="panel" aria-labelledby="queue">
            <div className="panel-head"><h2 id="queue" className="panel-title">Incident queue</h2><span className="text-xs text-muted-foreground">{d.incidents.length}</span></div>
            {d.incidents.length === 0 ? <Empty>No incidents. Send a signed event or author a test fixture.</Empty> : (
              <ul className="max-h-[420px] divide-y divide-border overflow-auto">
                {d.incidents.map((i: Any) => {
                  const ev = d.events.find((e: Any) => e.id === i.event_id);
                  return (
                    <li key={i.id}>
                      <button onClick={() => setSelected(i.id)} aria-pressed={selected === i.id}
                        className={`w-full px-4 py-2.5 text-left hover:bg-muted ${selected === i.id ? "bg-accent" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs">{ev?.external_order_id ?? "(no order id)"}</span>
                          <Status s={i.status} />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          {ev && <Evidence level={ev.evidence_level} />}
                          <span>{(i.violations as unknown[]).length} violations · {i.attempts} attempts</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <Events d={d} />
        </div>
        <div className="space-y-5 min-w-0">
          {inc ? <Inspector d={d} inc={inc} act={act} busy={busy} /> : (
            <section className="panel"><div className="panel-head"><h2 className="panel-title">Contract inspector</h2></div><Empty>Select an incident to inspect its contract, runs and approvals.</Empty></section>
          )}
          <Ledger d={d} />
          <Policy d={d} act={act} busy={busy} />
          <Audit d={d} />
        </div>
      </main>
    </div>
  );
}

type ActFn = <T>(label: string, fn: () => Promise<T>, ok?: (r: T) => string) => Promise<void>;

function CreateOrg({ onCreate, busy, flash }: { onCreate: (n: string) => void; busy: boolean; flash: { text: string } | null }) {
  const [name, setName] = useState("");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <form className="panel w-full max-w-md p-6" onSubmit={(e) => { e.preventDefault(); onCreate(name); }}>
        <h1 className="text-2xl">Create your organization</h1>
        <p className="mt-2 text-sm text-muted-foreground">All integrations, incidents and records are scoped to it. You become owner.</p>
        <label htmlFor="org" className="mt-5 block text-sm font-medium">Organization name</label>
        <input id="org" className="field mt-1" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        {flash && <p className="mt-3 text-sm text-destructive">{flash.text}</p>}
        <button disabled={busy} className="btn-primary mt-5 w-full">Create</button>
      </form>
    </main>
  );
}

function Providers({ orgId, checks, act, busy }: { orgId: string; checks: Any[]; act: ActFn; busy: string | null }) {
  const f = useServerFn(providerStatus);
  const [res, setRes] = useState<Any | null>(null);
  const last = (p: string) => checks.find((c) => c.provider === p);
  const cos = res?.createos ?? (last("createos") && { level: last("createos").evidence_level, detail: last("createos").detail });
  const st = res?.stripe ?? (last("stripe") && { level: last("stripe").evidence_level, detail: last("stripe").detail });
  return (
    <section className="panel" aria-labelledby="prov">
      <div className="panel-head"><h2 id="prov" className="panel-title">Provider status</h2>
        <button className="btn-ghost text-xs" disabled={busy === "prov"} onClick={() => act("prov", async () => setRes(await f({ data: { orgId } })))}>{busy === "prov" ? "Checking…" : "Run live check"}</button>
      </div>
      <ul className="divide-y divide-border text-sm">
        <li className="px-4 py-3">
          <div className="flex items-center justify-between"><span className="font-medium">CreateOS Sandbox</span><Evidence level={cos?.level ?? "UNKNOWN"} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{cos ? (cos.detail?.error ?? `Endpoint ${cos.detail?.baseUrl ?? "?"}`) : "Not checked yet."}</p>
          {cos?.level === "NOT_CONFIGURED" && (
            <ol className="mt-2 list-decimal pl-5 text-xs text-muted-foreground">
              <li>Get an API key at createos.sh → Profile.</li>
              <li>Add secret <code className="code">CREATEOS_SANDBOX_API_KEY</code> in Project Settings → Secrets.</li>
              <li>Optional <code className="code">CREATEOS_SANDBOX_BASE_URL</code> (defaults to api-eu.sb.createos.sh).</li>
              <li>Run live check again — only a successful whoami counts.</li>
            </ol>
          )}
        </li>
        <li className="px-4 py-3">
          <div className="flex items-center justify-between"><span className="font-medium">AI generation</span><Evidence level={res?.ai?.level ?? "UNKNOWN"} /></div>
          <p className="mt-1 text-xs text-muted-foreground">Lovable AI gateway. A run shows GENERATION_UNAVAILABLE if a call fails.</p>
        </li>
        <li className="px-4 py-3">
          <div className="flex items-center justify-between"><span className="font-medium">Stripe (via Stripe Projects)</span><Evidence level={st?.level ?? "UNKNOWN"} /></div>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {st?.detail?.account_id ? `Account ${st.detail.account_id} · request ${st.detail.request_id} · Stripe Projects provenance: ${st.detail.provisioned_via_stripe_projects}` : st?.detail?.error ?? "Provision with `stripe projects` CLI, then add STRIPE_SECRET_KEY (and STRIPE_PROJECTS_RESOURCE_ID) as secrets. Evidence requires a successful /v1/account call."}
          </p>
        </li>
      </ul>
    </section>
  );
}

function Integrations({ d, act, busy }: { d: Any; act: ActFn; busy: string | null }) {
  const fCreate = useServerFn(createIntegration);
  const fTest = useServerFn(testIntegration);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [secret, setSecret] = useState<{ id: string; secret: string } | null>(null);
  const [test, setTest] = useState<Any | null>(null);
  return (
    <section className="panel" aria-labelledby="integ">
      <div className="panel-head"><h2 id="integ" className="panel-title">Integrations</h2></div>
      {d.integrations.length === 0 && <Empty>No integrations yet. Create one to get a signed ingestion endpoint.</Empty>}
      <ul className="divide-y divide-border">
        {d.integrations.map((i: Any) => (
          <li key={i.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span><b className="font-medium">{i.name}</b> <span className="font-mono text-xs text-muted-foreground">{i.source}</span></span>
              <button className="btn-ghost text-xs" disabled={busy === "test" + i.id}
                onClick={() => act("test" + i.id, async () => setTest(await fTest({ data: { integrationId: i.id } })))}>Test connection</button>
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">POST /api/public/ingest/{i.id} · secret …{i.secret_hint} · last signed event {i.last_verified_at ? new Date(i.last_verified_at).toLocaleString() : "never"}</p>
          </li>
        ))}
      </ul>
      {test && (
        <div className="border-t border-border px-4 py-3 text-xs">
          <p>Signed request → <b className={test.signedStatus === 202 ? "text-primary" : "text-destructive"}>HTTP {test.signedStatus}</b>; unsigned request → <b className={test.unsignedStatus === 401 ? "text-primary" : "text-destructive"}>HTTP {test.unsignedStatus}</b> {test.unsignedStatus === 401 ? "(correctly rejected)" : ""}</p>
          <p className="mt-1 text-muted-foreground">Recorded as a TEST_FIXTURE event (incident {test.signedBody?.incident_id?.slice(0, 8)}).</p>
        </div>
      )}
      {secret && (
        <div className="border-t border-border bg-accent px-4 py-3 text-xs">
          <p className="font-medium">Signing secret — shown once, copy it now:</p>
          <code className="code mt-1 block break-all">{secret.secret}</code>
          <button className="btn-ghost mt-2 text-xs" onClick={() => setSecret(null)}>I've stored it</button>
        </div>
      )}
      <form className="grid grid-cols-2 gap-2 border-t border-border px-4 py-3"
        onSubmit={(e) => { e.preventDefault(); act("integ", async () => { const r = await fCreate({ data: { orgId: d.org, name, source } }); setSecret({ id: r.integrationId, secret: r.secret }); setName(""); setSource(""); }); }}>
        <input aria-label="Integration name" placeholder="Name (Shop X checkout)" className="field" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        <input aria-label="Source slug" placeholder="source slug (shopx)" className="field font-mono" value={source} onChange={(e) => setSource(e.target.value.toLowerCase())} pattern="[a-z0-9_-]{2,40}" required />
        <button disabled={busy === "integ"} className="btn-primary col-span-2">Create integration</button>
      </form>
    </section>
  );
}

function Fixture({ d, act, busy }: { d: Any; act: ActFn; busy: string | null }) {
  const f = useServerFn(submitFixture);
  const [integ, setInteg] = useState("");
  const [json, setJson] = useState("");
  const chosen = d.integrations.find((i: Any) => i.id === integ) ?? d.integrations[0];
  if (!chosen) return null;
  return (
    <section className="panel" aria-labelledby="fix">
      <div className="panel-head"><h2 id="fix" className="panel-title">Author test fixture</h2><Evidence level="TEST_FIXTURE" /></div>
      <div className="space-y-2 px-4 py-3">
        <p className="text-xs text-muted-foreground">Writes a real database event labelled TEST_FIXTURE. It is never treated as a production order.</p>
        <select aria-label="Integration" className="field" value={chosen.id} onChange={(e) => setInteg(e.target.value)}>
          {d.integrations.map((i: Any) => <option key={i.id} value={i.id}>{i.name} ({i.source})</option>)}
        </select>
        <textarea aria-label="Fixture JSON" className="field code h-44" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"external_order_id": "...", ...}' />
        <div className="flex gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={() => setJson(DRIFT_FIXTURE(chosen.source))}>Insert drifted template</button>
          <button className="btn-primary ml-auto" disabled={!json || busy === "fix"}
            onClick={() => act("fix", () => f({ data: { integrationId: chosen.id, payloadJson: json } }), (r) => `Event stored; ${r.violations.length} contract violations.`)}>Submit fixture</button>
        </div>
      </div>
    </section>
  );
}

function Events({ d }: { d: Any }) {
  return (
    <section className="panel" aria-labelledby="ev">
      <div className="panel-head"><h2 id="ev" className="panel-title">Inbound events</h2></div>
      {d.events.length === 0 ? <Empty>Nothing received yet.</Empty> : (
        <ul className="max-h-72 divide-y divide-border overflow-auto text-xs">
          {d.events.map((e: Any) => (
            <li key={e.id} className="flex items-center gap-2 px-4 py-2">
              <Evidence level={e.evidence_level} />
              <span className="truncate font-mono">{e.source}/{e.external_order_id ?? "?"}</span>
              <span className={`ml-auto ${e.contract_ok ? "text-primary" : "text-destructive"}`}>{e.contract_ok ? "contract ok" : "drift"}</span>
              <span className="text-muted-foreground">{e.signature_verified ? "signed" : "unsigned"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function lineDiff(a: string, b: string) {
  const A = a.split("\n"), B = b.split("\n");
  const setA = new Set(A), setB = new Set(B);
  return [...A.filter((l) => !setB.has(l)).map((l) => ({ t: "-", l })), ...B.map((l) => ({ t: setA.has(l) ? " " : "+", l }))];
}

function Inspector({ d, inc, act, busy }: { d: Any; inc: Any; act: ActFn; busy: string | null }) {
  const fRun = useServerFn(runRepair);
  const fDecide = useServerFn(decideApproval);
  const fCommit = useServerFn(commitAndVerify);
  const ev = d.events.find((e: Any) => e.id === inc.event_id);
  const runs = useMemo(() => d.runs.filter((r: Any) => r.incident_id === inc.id).sort((a: Any, b: Any) => b.attempt - a.attempt), [d.runs, inc.id]);
  const [runSel, setRunSel] = useState<string | null>(null);
  const run = runs.find((r: Any) => r.id === runSel) ?? runs[0];
  const prev = run && runs.find((r: Any) => r.attempt < run.attempt && r.generated_code);
  const approval = run && d.approvals.find((a: Any) => a.run_id === run.id);
  const receipts = run ? d.receipts.filter((r: Any) => r.run_id === run.id) : [];
  const [note, setNote] = useState("");
  const terminal = ["VERIFIED", "REFUSED"].includes(inc.status);

  function download() {
    const blob = new Blob([JSON.stringify({ incident: inc, event: ev, run, approval, receipts, exported_at: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fulfillment-proof-receipt-${run?.id ?? inc.id}.json`;
    a.click();
  }

  return (
    <>
      <section className="panel" aria-labelledby="insp">
        <div className="panel-head">
          <h2 id="insp" className="panel-title">Contract inspector · {ev?.external_order_id ?? inc.id.slice(0, 8)}</h2>
          <div className="flex items-center gap-2">{ev && <Evidence level={ev.evidence_level} />}<Status s={inc.status} /></div>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Violations</h3>
            {(inc.violations as Any[]).length === 0 ? <p className="mt-1 text-sm text-primary">Payload satisfies the normalized contract.</p> : (
              <ul className="mt-1 space-y-1 text-sm">
                {(inc.violations as Any[]).map((v, i) => (
                  <li key={i}><span className="font-mono text-xs text-destructive">{v.field}</span> {v.message}{v.hint && <span className="block text-xs text-muted-foreground">{v.hint}</span>}</li>
                ))}
              </ul>
            )}
          </div>
          <pre className="code max-h-56 overflow-auto rounded-md bg-muted p-3">{JSON.stringify(ev?.payload, null, 2)}</pre>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          <button className="btn-primary" disabled={terminal || !!busy}
            onClick={() => act("run", () => fRun({ data: { incidentId: inc.id } }), (r) => `Run finished: ${r.outcome}`)}>
            {busy === "run" ? "Generating & executing in sandbox…" : (inc.violations as unknown[]).length ? (runs.length ? "Retry repair" : "Diagnose & repair") : "Propose as-is"}
          </button>
          {run?.proposed_record && run?.policy?.allowed && !terminal && (
            <button className="btn-ghost" disabled={!!busy || (run.policy.requires_approval && approval?.status !== "APPROVED")}
              onClick={() => act("commit", () => fCommit({ data: { runId: run.id } }), (r) => `Write ${r.writeOutcome}; verifier: ${r.result}`)}>
              {inc.status === "RECONCILE" ? "Reconcile & verify" : "Commit & verify"}
            </button>
          )}
          {inc.status === "RECONCILE" && run && (
            <button className="btn-ghost" disabled={!!busy} onClick={() => act("commit", () => fCommit({ data: { runId: run.id } }), (r) => `Reconciled: ${r.result}`)}>Re-query destination</button>
          )}
          {run && <button className="btn-ghost ml-auto" onClick={download}>Download receipt</button>}
        </div>
      </section>

      <section className="panel" aria-labelledby="hist">
        <div className="panel-head"><h2 id="hist" className="panel-title">Run history</h2></div>
        {runs.length === 0 ? <Empty>No attempts yet.</Empty> : (
          <div className="flex flex-wrap gap-1 px-4 py-2">
            {runs.map((r: Any) => (
              <button key={r.id} onClick={() => setRunSel(r.id)} aria-pressed={run?.id === r.id}
                className={`rounded-sm border px-2 py-1 font-mono text-[11px] ${run?.id === r.id ? "border-primary bg-accent" : "border-border"}`}>
                #{r.attempt} {r.generation_status}/{r.execution_status}
              </button>
            ))}
          </div>
        )}
        {run && (
          <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Live execution console</h3>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Evidence level={run.execution_status === "SUCCEEDED" || run.execution_status === "FAILED" ? (run.sandbox_id ? "LIVE_OBSERVED" : "UNKNOWN") : run.execution_status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : run.execution_status === "NOT_NEEDED" ? "UNKNOWN" : "PARTIAL"} />
                <span className="font-mono">sandbox {run.sandbox_id ?? "—"}</span>
                {run.sandbox_shape && <span className="font-mono">{run.sandbox_shape} · devbox:1</span>}
                {run.exit_code !== null && <span className="font-mono">exit {run.exit_code}</span>}
                {run.exec_ms !== null && <span className="font-mono">{run.exec_ms}ms</span>}
              </div>
              <pre className="code mt-2 max-h-64 overflow-auto rounded-md bg-console p-3 text-console-foreground">
{`$ node --check transform.js && timeout 10 node harness.js
${run.stdout ?? ""}${run.stderr ? `\n[stderr]\n${run.stderr}` : ""}${run.error ? `\n[control-plane] ${run.error}` : ""}${!run.stdout && !run.stderr && !run.error ? "(no execution output recorded)" : ""}`}
              </pre>
              {run.egress && <p className="mt-1 font-mono text-[11px] text-muted-foreground">egress allowlist: {JSON.stringify(run.egress)}</p>}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Generated patch {run.code_hash && <span className="font-mono text-[11px] text-muted-foreground">sha256 {run.code_hash.slice(0, 12)}</span>}</h3>
              {run.generated_code ? (
                <pre className="code mt-2 max-h-64 overflow-auto rounded-md border border-border bg-card p-3">
                  {(prev ? lineDiff(prev.generated_code, run.generated_code) : run.generated_code.split("\n").map((l: string) => ({ t: "+", l }))).map((x: Any, i: number) => (
                    <div key={i} className={x.t === "+" ? "text-primary" : x.t === "-" ? "text-destructive line-through" : ""}>{x.t} {x.l}</div>
                  ))}
                </pre>
              ) : <p className="mt-2 text-sm text-muted-foreground">{run.generation_status === "NOT_NEEDED" ? "No transform needed." : "No code generated."}</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">Model: {run.model ?? "—"} · {prev ? `diff vs attempt #${prev.attempt}` : "first version"}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Proposed normalized record</h3>
              <pre className="code mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3">{run.proposed_record ? JSON.stringify(run.proposed_record, null, 2) : "—"}</pre>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Policy decision {run.policy && <span className="font-mono text-[11px] text-muted-foreground">{run.policy.version}</span>}</h3>
              {!run.policy ? <p className="mt-2 text-sm text-muted-foreground">No proposal evaluated.</p> : (
                <ul className="mt-2 space-y-1 text-sm">
                  <li>{run.policy.allowed ? <span className="text-primary">Allowed</span> : <Evidence level="REFUSED" />} {run.policy.requires_approval && <span className="text-warning">· human approval required</span>}</li>
                  {[...run.policy.refusals, ...run.policy.reasons].map((r: string) => <li key={r} className="text-xs text-muted-foreground">— {r}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {approval && (
        <section className="panel" aria-labelledby="appr">
          <div className="panel-head"><h2 id="appr" className="panel-title">Approval request</h2><Status s={approval.status} /></div>
          <div className="space-y-2 p-4 text-sm">
            <ul>{(approval.reasons as string[]).map((r) => <li key={r}>— {r}</li>)}</ul>
            <p className="font-mono text-[11px] text-muted-foreground">bound to code {approval.code_hash.slice(0, 12)} · proposal {approval.proposal_hash.slice(0, 12)} — a new patch invalidates this approval</p>
            {approval.status === "PENDING" && (
              <div className="flex flex-wrap gap-2">
                <input aria-label="Decision note" className="field max-w-xs" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn-primary" disabled={!!busy} onClick={() => act("dec", () => fDecide({ data: { approvalId: approval.id, decision: "APPROVED", note } }), () => "Approved.")}>Approve</button>
                <button className="btn-danger" disabled={!!busy} onClick={() => act("dec", () => fDecide({ data: { approvalId: approval.id, decision: "REFUSED", note } }), () => "Refused. No write will occur.")}>Refuse</button>
              </div>
            )}
            {approval.note && <p className="text-xs text-muted-foreground">Note: {approval.note}</p>}
          </div>
        </section>
      )}

      {receipts.length > 0 && (
        <section className="panel" aria-labelledby="rcpt">
          <div className="panel-head"><h2 id="rcpt" className="panel-title">Verification receipts</h2></div>
          <ul className="divide-y divide-border text-xs">
            {receipts.map((r: Any) => (
              <li key={r.id} className="px-4 py-2">
                <div className="flex items-center gap-2"><Status s={r.result} /><span className="font-mono">{r.verifier_version}</span><span className="text-muted-foreground">write: {r.checks.write_outcome}</span><span className="ml-auto text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span></div>
                <div className="mt-1 flex flex-wrap gap-x-3">{(r.checks.checks as Any[]).map((c) => <span key={c.check} className={c.pass ? "text-primary" : "text-destructive"}>{c.pass ? "✓" : "✗"} {c.check}</span>)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Ledger({ d }: { d: Any }) {
  return (
    <section className="panel" aria-labelledby="ledger">
      <div className="panel-head"><h2 id="ledger" className="panel-title">Destination evidence ledger</h2><span className="text-xs text-muted-foreground">fulfillment_records · no shipments or money movement</span></div>
      {d.records.length === 0 ? <Empty>No destination records written yet.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground"><tr>{["Order", "Evidence", "Amount", "SKU", "Qty", "Customer", "Status", "Verified"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {d.records.map((r: Any) => {
                const v = d.receipts.find((x: Any) => x.destination_record_id === r.id && x.result === "VERIFIED");
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-mono">{r.source}/{r.external_order_id}</td>
                    <td className="px-4 py-2"><Evidence level={r.evidence_level} /></td>
                    <td className="px-4 py-2 font-mono">{(Number(r.amount_cents) / 100).toFixed(2)} {r.currency}</td>
                    <td className="px-4 py-2 font-mono">{r.sku}</td><td className="px-4 py-2">{r.quantity}</td>
                    <td className="px-4 py-2 font-mono">{r.customer_reference}</td><td className="px-4 py-2">{r.status}</td>
                    <td className="px-4 py-2">{v ? <span className="text-primary">✓ {new Date(v.created_at).toLocaleTimeString()}</span> : <span className="text-muted-foreground">not verified</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Policy({ d, act, busy }: { d: Any; act: ActFn; busy: string | null }) {
  const f = useServerFn(addSku);
  const [sku, setSku] = useState("");
  return (
    <section className="panel" aria-labelledby="pol">
      <div className="panel-head"><h2 id="pol" className="panel-title">Security policy</h2><span className="font-mono text-[11px] text-muted-foreground">policy-v1</span></div>
      <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
        <ul className="space-y-1 text-muted-foreground">
          <li>— Generated code runs only in a CreateOS microVM, egress restricted, no DB credentials.</li>
          <li>— It may only return a proposed record; the control plane validates and writes.</li>
          <li>— Human approval: amount &gt; 500,000 cents, unknown SKU, changed order id / customer / currency.</li>
          <li>— Approval is bound to code + proposal hash. Refused incidents never write.</li>
          <li>— Writes are idempotent per source + order id; destination is re-read before verdict.</li>
        </ul>
        <div>
          <h3 className="font-semibold text-foreground">Known SKU catalogue</h3>
          <div className="mt-2 flex flex-wrap gap-1">{d.skus.length ? d.skus.map((s: string) => <span key={s} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]">{s}</span>) : <span className="text-xs text-muted-foreground">Empty — every SKU will require approval.</span>}</div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); act("sku", async () => { await f({ data: { orgId: d.org, sku } }); setSku(""); }); }}>
            <input aria-label="Add SKU" className="field font-mono" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="TEE-BLK-M" required />
            <button className="btn-ghost" disabled={busy === "sku"}>Add</button>
          </form>
        </div>
      </div>
    </section>
  );
}

function Audit({ d }: { d: Any }) {
  return (
    <section className="panel" aria-labelledby="aud">
      <div className="panel-head"><h2 id="aud" className="panel-title">Audit trail</h2></div>
      {d.audit.length === 0 ? <Empty>No activity.</Empty> : (
        <ul className="max-h-72 divide-y divide-border overflow-auto font-mono text-[11px]">
          {d.audit.map((a: Any) => (
            <li key={a.id} className="flex gap-3 px-4 py-1.5">
              <span className="shrink-0 text-muted-foreground">{new Date(a.created_at).toLocaleTimeString()}</span>
              <span className="shrink-0 font-medium">{a.action}</span>
              <span className="truncate text-muted-foreground">{JSON.stringify(a.detail)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}