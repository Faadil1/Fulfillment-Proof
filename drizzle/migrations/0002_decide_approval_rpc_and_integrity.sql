CREATE UNIQUE INDEX IF NOT EXISTS runs_incident_attempt_uniq ON public.runs (incident_id, attempt);
ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_attempts_bounds;
ALTER TABLE public.incidents ADD CONSTRAINT incidents_attempts_bounds CHECK (attempts BETWEEN 0 AND 6);
ALTER TABLE public.destination_records DROP CONSTRAINT IF EXISTS destination_records_source_format;
ALTER TABLE public.destination_records ADD CONSTRAINT destination_records_source_format CHECK (source ~ '^[a-z0-9_-]{2,40}$');

CREATE OR REPLACE FUNCTION public.decide_approval(_approval uuid, _decision text, _note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _ap approvals%ROWTYPE; _run runs%ROWTYPE; _inc incidents%ROWTYPE; _latest uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  IF _decision NOT IN ('APPROVED','REFUSED') THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _ap FROM approvals WHERE id = _approval FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = _ap.org_id AND user_id = auth.uid() AND role IN ('owner','operator')) THEN
    RAISE EXCEPTION 'Forbidden: operator role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM runs WHERE id = _ap.run_id;
  IF NOT FOUND OR _run.org_id <> _ap.org_id THEN RAISE EXCEPTION 'Blocked: approval/run org mismatch' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inc FROM incidents WHERE id = _run.incident_id FOR UPDATE;
  IF NOT FOUND OR _inc.org_id <> _ap.org_id THEN RAISE EXCEPTION 'Blocked: incident org mismatch' USING ERRCODE = '42501'; END IF;
  IF _ap.status <> 'PENDING' THEN RAISE EXCEPTION 'Blocked: approval already %', _ap.status USING ERRCODE = '55000'; END IF;
  IF _inc.status <> 'AWAITING_APPROVAL' THEN RAISE EXCEPTION 'Blocked: stale approval: incident is %', _inc.status USING ERRCODE = '55000'; END IF;
  SELECT id INTO _latest FROM runs WHERE incident_id = _inc.id AND proposed_record IS NOT NULL ORDER BY attempt DESC, created_at DESC LIMIT 1;
  IF _latest IS DISTINCT FROM _ap.run_id THEN RAISE EXCEPTION 'Blocked: stale approval: a newer proposal exists' USING ERRCODE = '55000'; END IF;
  UPDATE approvals SET status = _decision, decided_by = auth.uid(), decided_at = now(), note = left(_note, 500) WHERE id = _ap.id;
  UPDATE incidents SET status = CASE WHEN _decision = 'APPROVED' THEN 'READY_TO_WRITE' ELSE 'REFUSED' END, updated_at = now() WHERE id = _inc.id;
  INSERT INTO audit_events(org_id, actor, action, detail)
  VALUES (_ap.org_id, auth.uid(), 'approval.' || lower(_decision), jsonb_build_object('approval_id', _ap.id, 'run_id', _ap.run_id, 'code_hash', _ap.code_hash, 'incident_id', _inc.id));
END $$;

REVOKE ALL ON FUNCTION public.decide_approval(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_approval(uuid, text, text) TO authenticated, service_role;