// Transport logic for the public signed ingest endpoint, with injected storage so the
// behaviour (status codes, dedup contract, no rows on auth failure) is testable.
import { verifySignature } from "./hmac";
import { detectViolations, sha256Hex } from "./contract";

export type IngestResult = { event_id: string; incident_id: string; duplicate: boolean; duplicate_count: number; conflicts_with_event_id: string | null };

export type IngestDeps = {
  loadIntegration(id: string): Promise<{ id: string; org_id: string; source: string; secret: string } | null>;
  /** Must be atomic: same (integration, body hash) always resolves to one event + one incident. */
  ingestSigned(args: { org: string; integration: string; source: string; evidence: string; externalOrderId: string | null; payload: Record<string, unknown>; bodySha256: string; contractOk: boolean; violations: unknown[] }): Promise<IngestResult>;
  markVerified(id: string): Promise<void>;
  now?: () => number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleSignedIngest(deps: IngestDeps, integrationId: string, body: string, headers: Headers): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!UUID.test(integrationId)) return { status: 404, json: { error: "unknown integration" } };
  if (body.length > 64_000) return { status: 413, json: { error: "payload too large" } };
  const integ = await deps.loadIntegration(integrationId);
  if (!integ) return { status: 404, json: { error: "integration not configured" } };
  const sig = await verifySignature(integ.secret, headers.get("x-fp-signature"), body, deps.now?.());
  if (!sig.ok) return { status: 401, json: { error: "invalid signature", reason: sig.reason } };
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return { status: 400, json: { error: "invalid JSON" } }; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { status: 400, json: { error: "payload must be an object" } };
  const p = payload as Record<string, unknown>;
  const evHeader = headers.get("x-fp-evidence");
  const evidence = evHeader === "TEST_FIXTURE" || evHeader === "LIVE_TEST_MODE" ? evHeader : "UNKNOWN";
  const violations = detectViolations(p);
  const r = await deps.ingestSigned({
    org: integ.org_id, integration: integ.id, source: integ.source, evidence,
    externalOrderId: typeof p["external_order_id"] === "string" ? (p["external_order_id"] as string) : null,
    payload: p, bodySha256: await sha256Hex(body), contractOk: violations.length === 0, violations,
  });
  await deps.markVerified(integ.id);
  return {
    status: r.duplicate ? 200 : 202,
    json: { accepted: true, duplicate: r.duplicate, duplicate_count: r.duplicate_count, event_id: r.event_id, incident_id: r.incident_id, conflicts_with_event_id: r.conflicts_with_event_id, evidence, contract_violations: violations.length },
  };
}