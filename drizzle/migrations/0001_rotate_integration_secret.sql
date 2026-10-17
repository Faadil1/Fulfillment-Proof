CREATE OR REPLACE FUNCTION public.rotate_integration_secret(_integration uuid, _secret text, _hint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  IF _secret !~ '^fpsec_[0-9a-f]{64}$' OR _hint <> right(_secret, 4) THEN
    RAISE EXCEPTION 'Invalid secret format' USING ERRCODE = '22023';
  END IF;
  SELECT org_id INTO _org FROM integrations WHERE id = _integration FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'Integration not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = _org AND user_id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'Forbidden: owner role required' USING ERRCODE = '42501';
  END IF;
  UPDATE integration_secrets SET secret = _secret WHERE integration_id = _integration;
  IF NOT FOUND THEN RAISE EXCEPTION 'Secret row missing' USING ERRCODE = 'P0002'; END IF;
  UPDATE integrations SET secret_hint = _hint WHERE id = _integration;
  INSERT INTO audit_events(org_id, actor, action, detail)
  VALUES (_org, auth.uid(), 'integration.secret_rotated', jsonb_build_object('integration_id', _integration, 'new_hint', _hint));
END $$;
REVOKE ALL ON FUNCTION public.rotate_integration_secret(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_integration_secret(uuid, text, text) TO authenticated;