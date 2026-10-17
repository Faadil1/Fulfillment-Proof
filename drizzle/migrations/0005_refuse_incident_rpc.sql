CREATE OR REPLACE FUNCTION public.refuse_incident(_incident uuid, _reason text, _keep_destination uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _inc incidents%ROWTYPE; _ev inbound_events%ROWTYPE; _dest destination_records%ROWTYPE; _reason_t text := btrim(coalesce(_reason, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  IF length(_reason_t) < 10 OR length(_reason_t) > 500 THEN RAISE EXCEPTION 'Blocked: reason must be 10-500 characters' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _inc FROM incidents WHERE id = _incident FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'incident not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = _inc.org_id AND user_id = auth.uid() AND role IN ('owner','operator')) THEN
    RAISE EXCEPTION 'Forbidden: operator role required' USING ERRCODE = '42501';
  END IF;
  IF _inc.status NOT IN ('OPEN','FAILED') THEN RAISE EXCEPTION 'Blocked: cannot refuse an incident in status %', _inc.status USING ERRCODE = '55000'; END IF;
  -- Any destination effect or live approval tied to this incident's runs means the outcome is not safely closable.
  IF EXISTS (SELECT 1 FROM destination_records d JOIN runs r ON r.id = d.run_id WHERE r.incident_id = _inc.id) THEN
    RAISE EXCEPTION 'Blocked: a destination record exists for this incident; reconcile instead' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id WHERE r.incident_id = _inc.id AND a.status IN ('PENDING','APPROVED')) THEN
    RAISE EXCEPTION 'Blocked: a pending/approved proposal exists for this incident' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO _ev FROM inbound_events WHERE id = _inc.event_id;
  IF _keep_destination IS NOT NULL THEN
    SELECT * INTO _dest FROM destination_records WHERE id = _keep_destination AND org_id = _inc.org_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Blocked: destination record not found in this organization' USING ERRCODE = '42501'; END IF;
    IF _dest.source <> _ev.source OR _dest.external_order_id IS DISTINCT FROM _ev.external_order_id THEN
      RAISE EXCEPTION 'Blocked: destination record is for a different order' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM verification_receipts WHERE destination_record_id = _dest.id AND result = 'VERIFIED' AND org_id = _inc.org_id) THEN
      RAISE EXCEPTION 'Blocked: existing destination record has no VERIFIED receipt' USING ERRCODE = '55000';
    END IF;
  END IF;
  UPDATE incidents SET status = 'REFUSED', updated_at = now() WHERE id = _inc.id;
  INSERT INTO audit_events(org_id, actor, action, detail)
  VALUES (_inc.org_id, auth.uid(), CASE WHEN _keep_destination IS NULL THEN 'incident.refused' ELSE 'incident.refused_keep_existing' END,
    jsonb_build_object('incident_id', _inc.id, 'event_id', _inc.event_id, 'conflicts_with_event_id', _ev.conflicts_with_event_id,
      'kept_destination_record_id', _keep_destination, 'previous_status', _inc.status, 'reason', _reason_t));
  RETURN jsonb_build_object('incident_id', _inc.id, 'status', 'REFUSED', 'kept_destination_record_id', _keep_destination);
END $$;

REVOKE ALL ON FUNCTION public.refuse_incident(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refuse_incident(uuid, text, uuid) TO authenticated, service_role;