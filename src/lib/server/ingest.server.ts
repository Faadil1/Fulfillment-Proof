import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectViolations } from "@/lib/domain/contract";

export type EvidenceLevel = "TEST_FIXTURE" | "LIVE_TEST_MODE" | "LIVE_OBSERVED" | "UNKNOWN";

/** Persist an inbound event and open an incident. Returns ids. */
export async function ingestEvent(args: {
  orgId: string;
  integrationId: string | null;
  source: string;
  payload: Record<string, unknown>;
  evidence: EvidenceLevel;
  signatureVerified: boolean;
  actor: string | null;
}) {
  const violations = detectViolations(args.payload);
  const extId = typeof args.payload["external_order_id"] === "string" ? args.payload["external_order_id"] : null;
  const { data: ev, error } = await supabaseAdmin
    .from("inbound_events")
    .insert({
      org_id: args.orgId,
      integration_id: args.integrationId,
      source: args.source,
      evidence_level: args.evidence,
      signature_verified: args.signatureVerified,
      external_order_id: extId,
      payload: args.payload as never,
      contract_ok: violations.length === 0,
      violations: violations as never,
    })
    .select("id")
    .single();
  if (error || !ev) throw new Error(`event insert failed: ${error?.message}`);
  const { data: inc, error: e2 } = await supabaseAdmin
    .from("incidents")
    .insert({ org_id: args.orgId, event_id: ev.id, violations: violations as never })
    .select("id")
    .single();
  if (e2 || !inc) throw new Error(`incident insert failed: ${e2?.message}`);
  await supabaseAdmin.from("audit_events").insert({
    org_id: args.orgId,
    actor: args.actor,
    action: "event.ingested",
    detail: { event_id: ev.id, incident_id: inc.id, evidence: args.evidence, violations: violations.length, signature_verified: args.signatureVerified } as never,
  });
  return { eventId: ev.id, incidentId: inc.id, violations };
}