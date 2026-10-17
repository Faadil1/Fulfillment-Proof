ALTER TABLE public.inbound_events ADD COLUMN IF NOT EXISTS body_sha256 text;
ALTER TABLE public.inbound_events ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.inbound_events ADD COLUMN IF NOT EXISTS last_duplicate_at timestamptz;
ALTER TABLE public.inbound_events ADD COLUMN IF NOT EXISTS conflicts_with_event_id uuid REFERENCES public.inbound_events(id);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_events_signed_body_uniq ON public.inbound_events (integration_id, body_sha256) WHERE body_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbound_events_integration_order_idx ON public.inbound_events (integration_id, external_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_event_uniq ON public.incidents (event_id);

CREATE OR REPLACE FUNCTION public.ingest_signed_event(
  _org uuid, _integration uuid, _source text, _evidence text, _external_order_id text,
  _payload jsonb, _body_sha256 text, _contract_ok boolean, _violations jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _ev uuid; _inc uuid; _conflict uuid; _dups int;
BEGIN
  IF _body_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid body hash' USING ERRCODE = '22023'; END IF;
  IF _evidence NOT IN ('TEST_FIXTURE','LIVE_TEST_MODE','UNKNOWN') THEN RAISE EXCEPTION 'invalid evidence' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM integrations WHERE id = _integration AND org_id = _org AND source = _source) THEN
    RAISE EXCEPTION 'integration/org/source mismatch' USING ERRCODE = '42501';
  END IF;
  -- Serialize per integration+body so concurrent identical deliveries resolve to one row.
  PERFORM pg_advisory_xact_lock(hashtextextended(_integration::text || ':' || _body_sha256, 0));
  SELECT e.id, i.id INTO _ev, _inc FROM inbound_events e LEFT JOIN incidents i ON i.event_id = e.id
   WHERE e.integration_id = _integration AND e.body_sha256 = _body_sha256;
  IF _ev IS NOT NULL THEN
    UPDATE inbound_events SET duplicate_count = duplicate_count + 1, last_duplicate_at = now() WHERE id = _ev RETURNING duplicate_count INTO _dups;
    IF _inc IS NULL THEN
      INSERT INTO incidents(org_id, event_id, violations) VALUES (_org, _ev, _violations) RETURNING id INTO _inc;
    END IF;
    INSERT INTO audit_events(org_id, actor, action, detail)
    VALUES (_org, NULL, 'event.duplicate_suppressed', jsonb_build_object('event_id', _ev, 'incident_id', _inc, 'duplicate_count', _dups));
    RETURN jsonb_build_object('event_id', _ev, 'incident_id', _inc, 'duplicate', true, 'duplicate_count', _dups, 'conflicts_with_event_id', NULL);
  END IF;
  IF _external_order_id IS NOT NULL THEN
    SELECT id INTO _conflict FROM inbound_events
     WHERE integration_id = _integration AND external_order_id = _external_order_id AND body_sha256 IS DISTINCT FROM _body_sha256
     ORDER BY received_at ASC LIMIT 1;
  END IF;
  INSERT INTO inbound_events(org_id, integration_id, source, evidence_level, signature_verified, external_order_id, payload, contract_ok, violations, body_sha256, conflicts_with_event_id)
  VALUES (_org, _integration, _source, _evidence, true, _external_order_id, _payload, _contract_ok, _violations, _body_sha256, _conflict)
  RETURNING id INTO _ev;
  INSERT INTO incidents(org_id, event_id, violations) VALUES (_org, _ev, _violations) RETURNING id INTO _inc;
  INSERT INTO audit_events(org_id, actor, action, detail)
  VALUES (_org, NULL, CASE WHEN _conflict IS NULL THEN 'event.ingested' ELSE 'event.conflicting_payload' END,
    jsonb_build_object('event_id', _ev, 'incident_id', _inc, 'evidence', _evidence, 'signature_verified', true,
      'violations', jsonb_array_length(_violations), 'conflicts_with_event_id', _conflict));
  RETURN jsonb_build_object('event_id', _ev, 'incident_id', _inc, 'duplicate', false, 'duplicate_count', 0, 'conflicts_with_event_id', _conflict);
END $$;

REVOKE ALL ON FUNCTION public.ingest_signed_event(uuid, uuid, text, text, text, jsonb, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_signed_event(uuid, uuid, text, text, text, jsonb, text, boolean, jsonb) TO service_role;