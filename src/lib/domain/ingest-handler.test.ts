import { describe, it, expect, beforeEach } from "vitest";
import { handleSignedIngest, type IngestDeps, type IngestResult } from "./ingest-handler";
import { signBody } from "./hmac";

// In-memory store that mirrors the SQL contract of ingest_signed_event (unique integration+body hash,
// event + incident created together, conflict flag for same order id with different body).
function makeStore() {
  const events: { id: string; integration: string; hash: string; order: string | null; dup: number; conflict: string | null; evidence: string }[] = [];
  const incidents: { id: string; event: string }[] = [];
  let n = 0;
  const deps: IngestDeps = {
    async loadIntegration(id) {
      return id === INTEG ? { id, org_id: "org-a", source: "shopx", secret: SECRET } : null;
    },
    async ingestSigned(a): Promise<IngestResult> {
      await Promise.resolve(); // yield, to interleave concurrent calls
      const hit = events.find((e) => e.integration === a.integration && e.hash === a.bodySha256);
      if (hit) { hit.dup++; return { event_id: hit.id, incident_id: incidents.find((i) => i.event === hit.id)!.id, duplicate: true, duplicate_count: hit.dup, conflicts_with_event_id: null }; }
      const conflict = events.find((e) => e.integration === a.integration && a.externalOrderId && e.order === a.externalOrderId)?.id ?? null;
      const ev = { id: `ev${++n}`, integration: a.integration, hash: a.bodySha256, order: a.externalOrderId, dup: 0, conflict, evidence: a.evidence };
      events.push(ev); const inc = { id: `inc${n}`, event: ev.id }; incidents.push(inc);
      return { event_id: ev.id, incident_id: inc.id, duplicate: false, duplicate_count: 0, conflicts_with_event_id: conflict };
    },
    async markVerified() {},
  };
  return { deps, events, incidents };
}
const INTEG = "11111111-1111-4111-8111-111111111111";
const SECRET = "fpsec_" + "a".repeat(64);
const order = { external_order_id: "ord_1", source: "shopx", currency: "USD", amount_cents: 1200, sku: "TEE-BLK-M", quantity: 1, customer_reference: "c1" };
const body = JSON.stringify(order);
const h = async (b: string, extra: Record<string, string> = {}, t?: number) =>
  new Headers({ "x-fp-signature": await signBody(SECRET, b, t), "x-fp-evidence": "TEST_FIXTURE", ...extra });

let s: ReturnType<typeof makeStore>;
beforeEach(() => { s = makeStore(); });

describe("signed ingest — business consequences", () => {
  it("valid signed delivery → 202, one event + one incident, TEST_FIXTURE label kept", async () => {
    const r = await handleSignedIngest(s.deps, INTEG, body, await h(body));
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ duplicate: false, event_id: "ev1", incident_id: "inc1", evidence: "TEST_FIXTURE" });
    expect(s.events).toHaveLength(1); expect(s.incidents).toHaveLength(1);
  });
  it("unsigned → 401 and no rows (no operator work created by forgeries)", async () => {
    const r = await handleSignedIngest(s.deps, INTEG, body, new Headers());
    expect(r.status).toBe(401); expect(s.events).toHaveLength(0);
  });
  it("wrong secret → 401, no rows", async () => {
    const r = await handleSignedIngest(s.deps, INTEG, body, new Headers({ "x-fp-signature": await signBody("fpsec_wrong", body) }));
    expect(r.status).toBe(401); expect(s.events).toHaveLength(0);
  });
  it("stale timestamp (>5 min) → 401, no rows (replay window closed)", async () => {
    const r = await handleSignedIngest(s.deps, INTEG, body, await h(body, {}, Math.floor(Date.now() / 1000) - 301));
    expect(r.status).toBe(401); expect(r.json["reason"]).toMatch(/tolerance/); expect(s.events).toHaveLength(0);
  });
  it("retried identical body (new timestamp) → same ids, duplicate=true, no second incident", async () => {
    const a = await handleSignedIngest(s.deps, INTEG, body, await h(body));
    const b = await handleSignedIngest(s.deps, INTEG, body, await h(body, {}, Math.floor(Date.now() / 1000) - 10));
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ duplicate: true, duplicate_count: 1, event_id: a.json["event_id"], incident_id: a.json["incident_id"] });
    expect(s.incidents).toHaveLength(1);
  });
  it("same order id with changed payload is NOT dropped: new event flagged as conflicting", async () => {
    await handleSignedIngest(s.deps, INTEG, body, await h(body));
    const changed = JSON.stringify({ ...order, amount_cents: 9999 });
    const r = await handleSignedIngest(s.deps, INTEG, changed, await h(changed));
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ duplicate: false, conflicts_with_event_id: "ev1" });
    expect(s.events).toHaveLength(2); expect(s.incidents).toHaveLength(2);
  });
  it("concurrent identical POSTs resolve to one event/incident with identical ids", async () => {
    const hdr = await h(body);
    const rs = await Promise.all(Array.from({ length: 5 }, () => handleSignedIngest(s.deps, INTEG, body, hdr)));
    expect(new Set(rs.map((r) => r.json["event_id"])).size).toBe(1);
    expect(new Set(rs.map((r) => r.json["incident_id"])).size).toBe(1);
    expect(rs.filter((r) => r.json["duplicate"] === false)).toHaveLength(1);
    expect(s.events).toHaveLength(1); expect(s.incidents).toHaveLength(1);
  });
  it("unknown integration → 404, no rows; malformed id → 404", async () => {
    expect((await handleSignedIngest(s.deps, "22222222-2222-4222-8222-222222222222", body, await h(body))).status).toBe(404);
    expect((await handleSignedIngest(s.deps, "not-a-uuid", body, await h(body))).status).toBe(404);
    expect(s.events).toHaveLength(0);
  });
  it("unrecognised evidence header is recorded as UNKNOWN, never upgraded", async () => {
    const r = await handleSignedIngest(s.deps, INTEG, body, await h(body, { "x-fp-evidence": "LIVE_OBSERVED" }));
    expect(r.json["evidence"]).toBe("UNKNOWN");
  });
  it("concurrent DIFFERENT payloads for the same order id: exactly one is flagged as conflicting", async () => {
    const b1 = JSON.stringify({ ...order, amount_cents: 1 }), b2 = JSON.stringify({ ...order, amount_cents: 2 });
    const rs = await Promise.all([handleSignedIngest(s.deps, INTEG, b1, await h(b1)), handleSignedIngest(s.deps, INTEG, b2, await h(b2))]);
    expect(rs.every((r) => r.status === 202)).toBe(true);
    expect(rs.filter((r) => r.json["conflicts_with_event_id"]).length).toBe(1);
    expect(s.incidents).toHaveLength(2);
  });
});