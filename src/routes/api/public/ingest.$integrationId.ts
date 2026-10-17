import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Public signed ingestion endpoint. Caller must sign with the per-integration secret.
// Header x-fp-signature: t=<unix>,v1=<hex hmac_sha256(secret, `${t}.${body}`)>
// Header x-fp-evidence: TEST_FIXTURE | LIVE_TEST_MODE (anything else is recorded as UNKNOWN)
export const Route = createFileRoute("/api/public/ingest/$integrationId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const id = z.string().uuid().safeParse(params.integrationId);
        if (!id.success) return Response.json({ error: "unknown integration" }, { status: 404 });
        const body = await request.text();
        if (body.length > 64_000) return Response.json({ error: "payload too large" }, { status: 413 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verifySignature } = await import("@/lib/domain/hmac");
        const { ingestEvent } = await import("@/lib/server/ingest.server");

        const { data: integ } = await supabaseAdmin.from("integrations").select("id, org_id, source").eq("id", id.data).maybeSingle();
        const { data: sec } = integ
          ? await supabaseAdmin.from("integration_secrets").select("secret").eq("integration_id", integ.id).maybeSingle()
          : { data: null };
        if (!integ || !sec) return Response.json({ error: "integration not configured" }, { status: 404 });

        const sig = await verifySignature(sec.secret, request.headers.get("x-fp-signature"), body);
        if (!sig.ok) return Response.json({ error: "invalid signature", reason: sig.reason }, { status: 401 });

        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return Response.json({ error: "invalid JSON" }, { status: 400 });
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          return Response.json({ error: "payload must be an object" }, { status: 400 });

        const evHeader = request.headers.get("x-fp-evidence");
        const evidence = evHeader === "TEST_FIXTURE" || evHeader === "LIVE_TEST_MODE" ? evHeader : "UNKNOWN";
        const r = await ingestEvent({
          orgId: integ.org_id,
          integrationId: integ.id,
          source: integ.source,
          payload: payload as Record<string, unknown>,
          evidence,
          signatureVerified: true,
          actor: null,
        });
        await supabaseAdmin.from("integrations").update({ last_verified_at: new Date().toISOString() }).eq("id", integ.id);
        return Response.json({ accepted: true, event_id: r.eventId, incident_id: r.incidentId, contract_violations: r.violations.length }, { status: 202 });
      },
    },
  },
});