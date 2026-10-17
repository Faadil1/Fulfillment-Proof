import { createFileRoute } from "@tanstack/react-router";

// Public signed ingestion endpoint. Caller must sign with the per-integration secret.
// Header x-fp-signature: t=<unix>,v1=<hex hmac_sha256(secret, `${t}.${body}`)>
// Header x-fp-evidence: TEST_FIXTURE | LIVE_TEST_MODE (anything else is recorded as UNKNOWN)
// At-least-once safe: an identical signed body for the same integration returns the original
// event/incident with duplicate=true (HTTP 200) and creates no new rows.
export const Route = createFileRoute("/api/public/ingest/$integrationId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const body = await request.text();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { handleSignedIngest } = await import("@/lib/domain/ingest-handler");
        const r = await handleSignedIngest(
          {
            async loadIntegration(id) {
              const { data: integ } = await supabaseAdmin.from("integrations").select("id, org_id, source").eq("id", id).maybeSingle();
              if (!integ) return null;
              const { data: sec } = await supabaseAdmin.from("integration_secrets").select("secret").eq("integration_id", integ.id).maybeSingle();
              return sec ? { ...integ, secret: sec.secret } : null;
            },
            async ingestSigned(a) {
              const { data, error } = await supabaseAdmin.rpc("ingest_signed_event", {
                _org: a.org, _integration: a.integration, _source: a.source, _evidence: a.evidence,
                _external_order_id: a.externalOrderId as string, _payload: a.payload as never, _body_sha256: a.bodySha256,
                _contract_ok: a.contractOk, _violations: a.violations as never,
              });
              // Never log payload/signature; only the DB error code.
              if (error || !data) throw new Error(`ingest failed (${error?.code ?? "no data"})`);
              return data as never;
            },
            async markVerified(id) {
              await supabaseAdmin.from("integrations").update({ last_verified_at: new Date().toISOString() }).eq("id", id);
            },
          },
          params.integrationId,
          body,
          request.headers,
        ).catch(() => ({ status: 500, json: { error: "ingest failed; no partial rows (transactional). Safe to retry." } }));
        return Response.json(r.json, { status: r.status });
      },
    },
  },
});