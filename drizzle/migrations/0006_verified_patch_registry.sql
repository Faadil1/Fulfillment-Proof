CREATE TABLE IF NOT EXISTS public.verified_patches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  source text NOT NULL,
  fingerprint text NOT NULL,
  violation_signature text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  code text NOT NULL,
  code_hash text NOT NULL,
  evidence_level text NOT NULL,
  provenance_run_id uuid NOT NULL REFERENCES public.runs(id),
  provenance_receipt_id uuid NOT NULL REFERENCES public.verification_receipts(id),
  destination_record_id uuid NOT NULL REFERENCES public.destination_records(id),
  promoted_by uuid NOT NULL,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text,
  UNIQUE (org_id, fingerprint, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS verified_patches_one_active ON public.verified_patches (org_id, fingerprint) WHERE status = 'ACTIVE';
GRANT SELECT ON public.verified_patches TO authenticated;
GRANT ALL ON public.verified_patches TO service_role;
ALTER TABLE public.verified_patches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read" ON public.verified_patches FOR SELECT TO authenticated USING (public.is_member(org_id));

ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS repair_strategy text;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS patch_id uuid REFERENCES public.verified_patches(id);

-- Deterministic drift fingerprint: sha256(source || E'\n' || sorted "field:code" joined by '|'), C collation.
CREATE OR REPLACE FUNCTION public.drift_signature(_violations jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT coalesce(string_agg(s, '|' ORDER BY s COLLATE "C"), '')
  FROM (SELECT DISTINCT (v->>'field') || ':' || (v->>'code') AS s FROM jsonb_array_elements(coalesce(_violations, '[]'::jsonb)) v) x
$$;

CREATE OR REPLACE FUNCTION public.promote_verified_patch(_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r runs%ROWTYPE; _inc incidents%ROWTYPE; _ev inbound_events%ROWTYPE; _rc verification_receipts%ROWTYPE;
  _dest destination_records%ROWTYPE; _latest uuid; _sig text; _fp text; _ver int; _prev uuid; _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM runs WHERE id = _run;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = _r.org_id AND user_id = auth.uid() AND role IN ('owner','operator')) THEN
    RAISE EXCEPTION 'Forbidden: operator role required' USING ERRCODE = '42501';
  END IF;
  IF _r.generation_status <> 'GENERATED' OR _r.execution_status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'Blocked: only AI-generated code that SUCCEEDED in the CreateOS sandbox can be promoted (run is %/%)', _r.generation_status, _r.execution_status USING ERRCODE = '55000';
  END IF;
  IF _r.generated_code IS NULL OR _r.code_hash IS NULL OR _r.code_hash <> encode(sha256(convert_to(_r.generated_code, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'Blocked: code hash does not match stored code' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO _inc FROM incidents WHERE id = _r.incident_id FOR UPDATE;
  IF _inc.org_id <> _r.org_id OR _inc.status <> 'VERIFIED' THEN RAISE EXCEPTION 'Blocked: incident must be VERIFIED' USING ERRCODE = '55000'; END IF;
  SELECT * INTO _ev FROM inbound_events WHERE id = _inc.event_id;
  IF _ev.org_id <> _r.org_id THEN RAISE EXCEPTION 'Blocked: org mismatch' USING ERRCODE = '42501'; END IF;
  SELECT id INTO _latest FROM runs WHERE incident_id = _inc.id AND proposed_record IS NOT NULL ORDER BY attempt DESC, created_at DESC LIMIT 1;
  IF _latest IS DISTINCT FROM _r.id THEN RAISE EXCEPTION 'Blocked: stale run; not the latest proposal' USING ERRCODE = '55000'; END IF;
  SELECT * INTO _rc FROM verification_receipts WHERE run_id = _r.id AND org_id = _r.org_id AND result = 'VERIFIED' AND destination_record_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Blocked: run has no VERIFIED receipt linked to a destination record' USING ERRCODE = '55000'; END IF;
  SELECT * INTO _dest FROM destination_records WHERE id = _rc.destination_record_id;
  IF NOT FOUND OR _dest.org_id <> _r.org_id OR _dest.source <> _ev.source THEN
    RAISE EXCEPTION 'Blocked: destination record missing or for a different org/source' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM verified_patches WHERE provenance_run_id = _r.id) THEN
    RAISE EXCEPTION 'Blocked: this run was already promoted' USING ERRCODE = '55000';
  END IF;
  _sig := drift_signature(_inc.violations);
  IF _sig = '' THEN RAISE EXCEPTION 'Blocked: incident had no contract drift to fingerprint' USING ERRCODE = '55000'; END IF;
  _fp := encode(sha256(convert_to(_ev.source || E'\n' || _sig, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('patch:' || _r.org_id::text || ':' || _fp, 0));
  SELECT coalesce(max(version), 0) + 1 INTO _ver FROM verified_patches WHERE org_id = _r.org_id AND fingerprint = _fp;
  UPDATE verified_patches SET status = 'REVOKED', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = 'superseded by version ' || _ver
   WHERE org_id = _r.org_id AND fingerprint = _fp AND status = 'ACTIVE' RETURNING id INTO _prev;
  INSERT INTO verified_patches(org_id, source, fingerprint, violation_signature, version, code, code_hash, evidence_level, provenance_run_id, provenance_receipt_id, destination_record_id, promoted_by)
  VALUES (_r.org_id, _ev.source, _fp, _sig, _ver, _r.generated_code, _r.code_hash, _ev.evidence_level, _r.id, _rc.id, _dest.id, auth.uid())
  RETURNING id INTO _id;
  INSERT INTO audit_events(org_id, actor, action, detail) VALUES (_r.org_id, auth.uid(), 'patch.promoted',
    jsonb_build_object('patch_id', _id, 'version', _ver, 'fingerprint', _fp, 'source', _ev.source, 'code_hash', _r.code_hash,
      'run_id', _r.id, 'receipt_id', _rc.id, 'destination_record_id', _dest.id, 'evidence', _ev.evidence_level, 'superseded_patch_id', _prev));
  RETURN jsonb_build_object('patch_id', _id, 'version', _ver, 'fingerprint', _fp);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_verified_patch(_patch uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p verified_patches%ROWTYPE; _why text := btrim(coalesce(_reason, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  IF length(_why) < 5 OR length(_why) > 300 THEN RAISE EXCEPTION 'Blocked: reason must be 5-300 characters' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _p FROM verified_patches WHERE id = _patch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'patch not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = _p.org_id AND user_id = auth.uid() AND role IN ('owner','operator')) THEN
    RAISE EXCEPTION 'Forbidden: operator role required' USING ERRCODE = '42501';
  END IF;
  IF _p.status <> 'ACTIVE' THEN RAISE EXCEPTION 'Blocked: patch already %', _p.status USING ERRCODE = '55000'; END IF;
  UPDATE verified_patches SET status = 'REVOKED', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = _why WHERE id = _p.id;
  INSERT INTO audit_events(org_id, actor, action, detail) VALUES (_p.org_id, auth.uid(), 'patch.revoked',
    jsonb_build_object('patch_id', _p.id, 'version', _p.version, 'fingerprint', _p.fingerprint, 'reason', _why));
END $$;

REVOKE ALL ON FUNCTION public.promote_verified_patch(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_verified_patch(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_verified_patch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_verified_patch(uuid, text) TO authenticated, service_role;