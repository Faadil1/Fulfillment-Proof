CREATE TYPE public.org_role AS ENUM ('owner','operator','viewer');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.memberships (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.org_role NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_member(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = _org AND user_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.can_operate(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = _org AND user_id = auth.uid() AND role IN ('owner','operator'))
$$;

CREATE OR REPLACE FUNCTION public.create_organization(_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.organizations(name, created_by) VALUES (_name, auth.uid()) RETURNING id INTO _id;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (_id, auth.uid(), 'owner');
  INSERT INTO public.audit_events(org_id, actor, action, detail) VALUES (_id, auth.uid(), 'org.created', jsonb_build_object('name', _name));
  RETURN _id;
END $$;

CREATE TABLE public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL CHECK (source ~ '^[a-z0-9_-]{2,40}$'),
  secret_hint text NOT NULL,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source)
);
-- Secrets live in a table only service_role can read
CREATE TABLE public.integration_secrets (
  integration_id uuid PRIMARY KEY REFERENCES public.integrations(id) ON DELETE CASCADE,
  secret text NOT NULL
);

CREATE TABLE public.known_skus (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sku text NOT NULL,
  PRIMARY KEY (org_id, sku)
);

CREATE TABLE public.inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  source text NOT NULL,
  evidence_level text NOT NULL CHECK (evidence_level IN ('TEST_FIXTURE','LIVE_TEST_MODE','LIVE_OBSERVED','UNKNOWN')),
  signature_verified boolean NOT NULL DEFAULT false,
  external_order_id text,
  payload jsonb NOT NULL,
  contract_ok boolean NOT NULL,
  violations jsonb NOT NULL DEFAULT '[]',
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.inbound_events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DIAGNOSING','AWAITING_APPROVAL','READY_TO_WRITE','RECONCILE','VERIFIED','REFUSED','FAILED')),
  violations jsonb NOT NULL DEFAULT '[]',
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  attempt int NOT NULL,
  generation_status text NOT NULL,
  model text,
  generated_code text,
  code_hash text,
  generation_log jsonb NOT NULL DEFAULT '[]',
  execution_status text NOT NULL DEFAULT 'PENDING',
  sandbox_id text,
  sandbox_shape text,
  egress jsonb,
  stdout text,
  stderr text,
  exit_code int,
  exec_ms int,
  proposed_record jsonb,
  policy jsonb,
  error text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  proposal_hash text NOT NULL,
  reasons jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REFUSED','INVALIDATED')),
  decided_by uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.destination_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_order_id text NOT NULL,
  currency text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  sku text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  customer_reference text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_FULFILLMENT',
  idempotency_key text NOT NULL UNIQUE,
  run_id uuid REFERENCES public.runs(id) ON DELETE SET NULL,
  evidence_level text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source, external_order_id)
);

CREATE TABLE public.verification_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('VERIFIED','MISMATCH','MISSING','DUPLICATE')),
  checks jsonb NOT NULL,
  verifier_version text NOT NULL,
  destination_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.provider_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  evidence_level text NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Grants: authenticated reads only for control-plane tables; writes via server (service_role)
GRANT SELECT ON public.organizations, public.memberships, public.integrations, public.known_skus,
  public.inbound_events, public.incidents, public.runs, public.approvals, public.destination_records,
  public.verification_receipts, public.provider_checks, public.audit_events TO authenticated;
GRANT INSERT, DELETE ON public.known_skus TO authenticated;
GRANT ALL ON public.organizations, public.memberships, public.integrations, public.integration_secrets, public.known_skus,
  public.inbound_events, public.incidents, public.runs, public.approvals, public.destination_records,
  public.verification_receipts, public.provider_checks, public.audit_events TO service_role;
GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.known_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.destination_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read org" ON public.organizations FOR SELECT TO authenticated USING (public.is_member(id));
CREATE POLICY "members read memberships" ON public.memberships FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.integrations FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.known_skus FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "operators add" ON public.known_skus FOR INSERT TO authenticated WITH CHECK (public.can_operate(org_id));
CREATE POLICY "operators remove" ON public.known_skus FOR DELETE TO authenticated USING (public.can_operate(org_id));
CREATE POLICY "members read" ON public.inbound_events FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.incidents FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.runs FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.approvals FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.destination_records FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.verification_receipts FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.provider_checks FOR SELECT TO authenticated USING (public.is_member(org_id));
CREATE POLICY "members read" ON public.audit_events FOR SELECT TO authenticated USING (public.is_member(org_id));
-- integration_secrets: no policies => no authenticated access at all.

CREATE INDEX ON public.incidents(org_id, status);
CREATE INDEX ON public.runs(incident_id);
CREATE INDEX ON public.inbound_events(org_id, received_at DESC);
CREATE INDEX ON public.audit_events(org_id, created_at DESC);