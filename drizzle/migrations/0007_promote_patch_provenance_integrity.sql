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
  IF jsonb_typeof(_r.generation_log->0->'tests') IS DISTINCT FROM 'array' OR jsonb_array_length(_r.generation_log->0->'tests') NOT BETWEEN 2 AND 8 THEN
    RAISE EXCEPTION 'Blocked: provenance run has no valid 2-8 generated tests to re-run on reuse' USING ERRCODE = '55000';
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
  IF _dest.run_id IS DISTINCT FROM _r.id THEN
    RAISE EXCEPTION 'Blocked: receipt links a destination record written by a different run' USING ERRCODE = '55000';
  END IF;
  IF _ev.external_order_id IS NOT NULL AND _dest.external_order_id IS DISTINCT FROM _ev.external_order_id THEN
    RAISE EXCEPTION 'Blocked: destination record is for a different order than the inbound event' USING ERRCODE = '55000';
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

REVOKE ALL ON FUNCTION public.promote_verified_patch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_verified_patch(uuid) TO authenticated, service_role;