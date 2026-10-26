"""Initial schema: ledger, institutions, matching, coordination, SLA, audit, row-level security.

Revision ID: 0001
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

APP_ROLE = "samanvay_app"
WORKER_ROLE = "samanvay_worker"

SCHEMA = r"""
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE region (
  id smallint PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL
);

CREATE TABLE unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  name_hi text,
  unit_type text NOT NULL CHECK (unit_type IN ('BUREAU', 'CELL', 'REGIONAL_OFFICE')),
  region_id smallint REFERENCES region(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL CHECK (email = lower(email)),
  full_name text NOT NULL,
  designation text,
  password_hash text,
  unit_id uuid NOT NULL REFERENCES unit(id),
  roles text[] NOT NULL DEFAULT '{}',
  sealed_clearance boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_user_unit_idx ON app_user(unit_id);

CREATE TABLE user_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip text,
  user_agent text
);
CREATE INDEX user_session_user_idx ON user_session(user_id);

CREATE TABLE institution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permanent_id text UNIQUE NOT NULL,
  name text NOT NULL,
  name_norm text NOT NULL,
  address text,
  city text,
  district text,
  state text,
  pin text,
  region_id smallint REFERENCES region(id),
  inst_type text,
  approval_status text NOT NULL DEFAULT 'APPROVED'
    CHECK (approval_status IN ('APPROVED', 'UNAPPROVED', 'CLOSED', 'UNLISTED')),
  trust_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX institution_name_trgm ON institution USING gin (name_norm gin_trgm_ops);
CREATE INDEX institution_region_idx ON institution(region_id);

CREATE TABLE institution_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_norm text NOT NULL,
  source text NOT NULL DEFAULT 'MASTER',
  confirmed_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, alias_norm)
);
CREATE INDEX institution_alias_trgm ON institution_alias USING gin (alias_norm gin_trgm_ops);

CREATE TABLE category (
  code text PRIMARY KEY,
  name text NOT NULL,
  name_hi text,
  group_code text NOT NULL,
  default_unit_code text,
  sensitivity text NOT NULL DEFAULT 'NORMAL' CHECK (sensitivity IN ('NORMAL', 'RESTRICTED', 'SEALED')),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE category_compat (
  a text NOT NULL REFERENCES category(code),
  b text NOT NULL REFERENCES category(code),
  score real NOT NULL CHECK (score >= 0 AND score <= 1),
  PRIMARY KEY (a, b)
);

CREATE TABLE transition_rule (
  id serial PRIMARY KEY,
  from_status text NOT NULL,
  action text NOT NULL,
  to_status text NOT NULL,
  allowed_roles text[] NOT NULL,
  requires_remarks boolean NOT NULL DEFAULT false,
  consequential boolean NOT NULL DEFAULT false,
  label text NOT NULL,
  label_hi text,
  UNIQUE (from_status, action)
);

CREATE TABLE sla_policy (
  id serial PRIMARY KEY,
  code text NOT NULL,
  version int NOT NULL,
  name text NOT NULL,
  channel text,
  category_code text REFERENCES category(code),
  category_group text,
  unit_id uuid REFERENCES unit(id),
  day_basis text NOT NULL CHECK (day_basis IN ('CALENDAR', 'WORKING')),
  target_days int NOT NULL CHECK (target_days > 0),
  reminder_offsets int[] NOT NULL DEFAULT '{3,1}',
  interim_reply_day int,
  escalate_after_days int NOT NULL DEFAULT 5,
  approval_status text NOT NULL DEFAULT 'PROPOSED' CHECK (approval_status IN ('PROPOSED', 'APPROVED')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE holiday (
  id serial PRIMARY KEY,
  day date NOT NULL,
  region_id smallint REFERENCES region(id),
  name text NOT NULL
);
CREATE UNIQUE INDEX holiday_day_region_uq ON holiday(day, coalesce(region_id, 0));

-- National working-day calendar. wd_index is the running count of working days, so the number of
-- working days in (a, b] is wd_index(b) - wd_index(a): O(1) per row for ageing and SLA maths.
CREATE TABLE calendar_day (
  day date PRIMARY KEY,
  is_working boolean NOT NULL,
  wd_index int NOT NULL
);

CREATE SEQUENCE case_no_seq;
CREATE SEQUENCE coordination_no_seq;

CREATE TABLE import_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES unit(id),
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  filename text NOT NULL,
  file_sha256 text NOT NULL,
  object_key text NOT NULL,
  profile jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  total_rows int NOT NULL DEFAULT 0,
  created_rows int NOT NULL DEFAULT 0,
  duplicate_rows int NOT NULL DEFAULT 0,
  error_rows int NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE mapping_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid REFERENCES unit(id),
  name text NOT NULL,
  channel text NOT NULL,
  column_map jsonb NOT NULL,
  status_map jsonb NOT NULL DEFAULT '{}',
  category_map jsonb NOT NULL DEFAULT '{}',
  date_format text,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, name)
);

CREATE TABLE case_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_no text UNIQUE NOT NULL,
  channel text NOT NULL CHECK (channel IN ('CPGRAMS', 'EMAIL', 'LETTER', 'REFERRAL', 'REGISTER', 'PORTAL',
                                           'WALK_IN', 'COURT', 'PARLIAMENT')),
  source_ref text,
  unit_file_no text,
  cpgrams_no text,
  court_case_no text,
  refs jsonb NOT NULL DEFAULT '{}',
  institution_id uuid REFERENCES institution(id),
  institution_raw text,
  institution_weight real,
  resolution_status text NOT NULL DEFAULT 'PENDING' CHECK (resolution_status IN ('RESOLVED', 'PENDING', 'UNRESOLVED')),
  region_id smallint REFERENCES region(id),
  category_code text NOT NULL REFERENCES category(code),
  sensitivity text NOT NULL DEFAULT 'NORMAL' CHECK (sensitivity IN ('NORMAL', 'RESTRICTED', 'SEALED')),
  status text NOT NULL,
  prior_status text,
  holding_unit_id uuid NOT NULL REFERENCES unit(id),
  holding_officer_id uuid REFERENCES app_user(id),
  holder_since timestamptz NOT NULL DEFAULT now(),
  complainant_type text,
  complainant_hmac text,
  language text NOT NULL DEFAULT 'en',
  received_on date NOT NULL,
  expected_disposal date,
  sla_policy_id int REFERENCES sla_policy(id),
  escalated boolean NOT NULL DEFAULT false,
  last_action text,
  last_action_at timestamptz,
  next_action text,
  next_action_due date,
  disposed_on date,
  import_job_id uuid REFERENCES import_job(id),
  matched_at timestamptz,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX case_source_ref_uq ON case_record(channel, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX case_rollup_idx ON case_record(status, holding_unit_id, received_on);
CREATE INDEX case_region_idx ON case_record(region_id, status);
CREATE INDEX case_inst_idx ON case_record(institution_id, status);
CREATE INDEX case_received_idx ON case_record(received_on DESC, id DESC);
CREATE INDEX case_hmac_idx ON case_record(complainant_hmac) WHERE complainant_hmac IS NOT NULL;
CREATE INDEX case_cpgrams_idx ON case_record(cpgrams_no) WHERE cpgrams_no IS NOT NULL;
CREATE INDEX case_court_idx ON case_record(court_case_no) WHERE court_case_no IS NOT NULL;
CREATE INDEX case_officer_idx ON case_record(holding_officer_id) WHERE holding_officer_id IS NOT NULL;

CREATE TABLE case_content (
  case_id uuid PRIMARY KEY REFERENCES case_record(id) ON DELETE CASCADE,
  subject text NOT NULL,
  body text NOT NULL,
  complainant_name_enc text,
  complainant_contact_enc text,
  search_vector tsvector GENERATED ALWAYS AS
    (to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(body, ''))) STORED
);
CREATE INDEX case_content_fts ON case_content USING gin (search_vector);

CREATE TABLE case_event (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES case_record(id),
  event_type text NOT NULL,
  action text,
  actor_id uuid REFERENCES app_user(id),
  actor_unit_id uuid REFERENCES unit(id),
  at timestamptz NOT NULL DEFAULT now(),
  from_status text,
  to_status text,
  from_unit_id uuid REFERENCES unit(id),
  to_unit_id uuid REFERENCES unit(id),
  remarks text,
  data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX case_event_case_idx ON case_event(case_id, at);

CREATE TABLE transfer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES case_record(id),
  from_unit_id uuid NOT NULL REFERENCES unit(id),
  to_unit_id uuid NOT NULL REFERENCES unit(id),
  proposed_by uuid NOT NULL REFERENCES app_user(id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  prior_status text NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'ACCEPTED', 'RETURNED', 'CANCELLED')),
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  decision_remarks text,
  CHECK (from_unit_id <> to_unit_id)
);
CREATE UNIQUE INDEX transfer_one_open_uq ON transfer(case_id) WHERE status = 'PROPOSED';
CREATE INDEX transfer_to_idx ON transfer(to_unit_id, status);

CREATE TABLE access_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES case_record(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  granted_by uuid NOT NULL REFERENCES app_user(id),
  reason text NOT NULL,
  valid_to timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_grant_case_user_idx ON access_grant(case_id, user_id);

CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES case_record(id),
  event_id bigint REFERENCES case_event(id),
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL,
  scan_status text NOT NULL CHECK (scan_status IN ('QUARANTINED', 'CLEAN', 'REJECTED')),
  scan_detail text,
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_case_idx ON document(case_id);

CREATE TABLE case_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  left_id uuid NOT NULL REFERENCES case_record(id),
  right_id uuid NOT NULL REFERENCES case_record(id),
  link_type text NOT NULL CHECK (link_type IN ('D', 'R', 'P', 'C', 'L')),
  probability real NOT NULL,
  score real NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]',
  hard_keys text[] NOT NULL DEFAULT '{}',
  model_version text NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'CONFIRMED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (left_id < right_id),
  UNIQUE (left_id, right_id)
);
CREATE INDEX case_link_right_idx ON case_link(right_id);

CREATE TABLE coordination (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  link_id uuid UNIQUE NOT NULL REFERENCES case_link(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'AWAITING_CONFIRMATION', 'DECIDED', 'ESCALATED')),
  proposal jsonb,
  proposed_by uuid REFERENCES app_user(id),
  proposed_unit_id uuid REFERENCES unit(id),
  proposed_at timestamptz,
  decision text CHECK (decision IN ('DUPLICATE', 'RELATED', 'NOT_RELATED')),
  lead_unit_id uuid REFERENCES unit(id),
  joint_next_action text,
  joint_due date,
  remarks text,
  confirmed_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  decide_by date NOT NULL,
  escalated_at timestamptz,
  opened_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  row_version int NOT NULL DEFAULT 1
);
CREATE INDEX coordination_status_idx ON coordination(status);

CREATE TABLE coordination_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coordination_id uuid NOT NULL REFERENCES coordination(id),
  author_id uuid NOT NULL REFERENCES app_user(id),
  unit_id uuid NOT NULL REFERENCES unit(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coordination_message_idx ON coordination_message(coordination_id, created_at);

CREATE TABLE guard_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES case_record(id),
  action text NOT NULL,
  result text NOT NULL CHECK (result IN ('NO_CONFLICT', 'COORDINATION_SUGGESTED', 'COORDINATED')),
  found jsonb NOT NULL DEFAULT '[]',
  restricted_exists boolean NOT NULL DEFAULT false,
  fallback boolean NOT NULL DEFAULT false,
  choice text CHECK (choice IN ('OPEN_COORDINATION', 'PROCEED_AND_NOTIFY', 'PROCEED', 'CANCEL')),
  reason text,
  actor_id uuid NOT NULL REFERENCES app_user(id),
  at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
CREATE INDEX guard_check_case_idx ON guard_check(case_id, at);

CREATE TABLE timer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  case_id uuid REFERENCES case_record(id),
  transfer_id uuid REFERENCES transfer(id),
  coordination_id uuid REFERENCES coordination(id),
  payload jsonb NOT NULL DEFAULT '{}',
  dedupe_key text UNIQUE NOT NULL,
  fired_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timer_due_idx ON timer(due_at) WHERE fired_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX timer_case_idx ON timer(case_id) WHERE fired_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id),
  family text NOT NULL CHECK (family IN ('OVERLAP', 'SLA', 'TRANSFER', 'ESCALATION', 'COORDINATION', 'SYSTEM')),
  severity text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  case_id uuid REFERENCES case_record(id),
  dedupe_key text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  email_status text NOT NULL DEFAULT 'NONE' CHECK (email_status IN ('NONE', 'PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  email_attempts int NOT NULL DEFAULT 0,
  email_next_at timestamptz
);
CREATE INDEX notification_user_idx ON notification(user_id, created_at DESC);
CREATE INDEX notification_email_idx ON notification(email_next_at) WHERE email_status = 'PENDING';

CREATE TABLE job (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'DEAD')),
  priority int NOT NULL DEFAULT 100,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX job_ready_idx ON job(priority, run_after) WHERE status = 'QUEUED';
CREATE UNIQUE INDEX job_dedupe_uq ON job(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('QUEUED', 'RUNNING');

CREATE TABLE text_vector (
  case_id uuid PRIMARY KEY REFERENCES case_record(id) ON DELETE CASCADE,
  model text NOT NULL,
  text_hash text NOT NULL,
  vector real[] NOT NULL
);

CREATE TABLE matching_model (
  version text PRIMARY KEY,
  params jsonb NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES case_record(id),
  recipient_type text NOT NULL CHECK (recipient_type IN ('COMPLAINANT', 'INSTITUTION', 'OTHER')),
  template_code text,
  subject text NOT NULL,
  body text NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX communication_case_idx ON communication(case_id);

CREATE TABLE report_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code text NOT NULL,
  title text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  scope jsonb NOT NULL DEFAULT '{}',
  cut_off timestamptz NOT NULL,
  data jsonb NOT NULL,
  checksum text NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_snapshot_created_idx ON report_snapshot(created_at DESC);

CREATE TABLE audit_event (
  seq bigint PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_id uuid,
  actor_unit_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  payload jsonb NOT NULL,
  prev_hash bytea NOT NULL,
  hash bytea NOT NULL
);
CREATE INDEX audit_event_entity_idx ON audit_event(entity_type, entity_id);

CREATE TABLE audit_checkpoint (
  id serial PRIMARY KEY,
  from_seq bigint NOT NULL,
  upto_seq bigint NOT NULL,
  merkle_root bytea NOT NULL,
  chain_head bytea NOT NULL,
  signature bytea NOT NULL,
  key_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
"""

# Session context set by the API at the start of every transaction (SET LOCAL via set_config).
RLS = r"""
CREATE FUNCTION smv_uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION smv_unit() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.unit_id', true), '')::uuid $$;
CREATE FUNCTION smv_region() RETURNS smallint LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.region_id', true), '')::smallint $$;
CREATE FUNCTION smv_has_role(r text) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT r = ANY (string_to_array(coalesce(current_setting('app.roles', true), ''), ',')) $$;
CREATE FUNCTION smv_cleared() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.clearance', true), '') = 'on' $$;
CREATE FUNCTION smv_case_role() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT smv_has_role('INTAKE_OFFICER') OR smv_has_role('CASE_OFFICER') OR smv_has_role('UNIT_HEAD')
      OR smv_has_role('REGIONAL_OFFICER') OR smv_has_role('SENIOR_MGMT') OR smv_has_role('COMPETENT_AUTHORITY')
      OR smv_has_role('NODAL_OFFICER') OR smv_has_role('AUDITOR')
$$;

-- Metadata tier: every official with a case role sees that a case exists, except sealed categories.
CREATE FUNCTION smv_case_meta(p_sensitivity text, p_holding_unit uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_sensitivity = 'SEALED' THEN
      smv_has_role('COMPETENT_AUTHORITY')
      OR (smv_cleared() AND (p_holding_unit = smv_unit() OR smv_has_role('SENIOR_MGMT') OR smv_has_role('AUDITOR')))
    ELSE smv_case_role()
  END
$$;

-- Full tier (content). SECURITY DEFINER so the lookups below are not themselves filtered by RLS.
CREATE FUNCTION smv_case_full(p_case uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c record;
BEGIN
  SELECT id, sensitivity, holding_unit_id, region_id INTO c FROM case_record WHERE id = p_case;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT smv_case_meta(c.sensitivity, c.holding_unit_id) THEN RETURN false; END IF;
  IF c.sensitivity = 'SEALED' THEN RETURN true; END IF;
  IF c.holding_unit_id = smv_unit() AND smv_case_role() THEN RETURN true; END IF;
  IF smv_has_role('COMPETENT_AUTHORITY') THEN RETURN true; END IF;
  IF c.sensitivity = 'NORMAL' AND (smv_has_role('SENIOR_MGMT') OR smv_has_role('AUDITOR')) THEN RETURN true; END IF;
  IF c.sensitivity = 'NORMAL' AND smv_has_role('REGIONAL_OFFICER') AND c.region_id = smv_region() THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM transfer t WHERE t.case_id = p_case AND t.status = 'PROPOSED' AND t.to_unit_id = smv_unit())
    THEN RETURN true; END IF;
  -- Participants of an active (or decided, related) coordination on this case.
  IF EXISTS (
    SELECT 1 FROM case_link l
    JOIN coordination co ON co.link_id = l.id
    JOIN case_record o ON o.id = CASE WHEN l.left_id = p_case THEN l.right_id ELSE l.left_id END
    WHERE (l.left_id = p_case OR l.right_id = p_case)
      AND (co.status <> 'DECIDED' OR co.decision <> 'NOT_RELATED')
      AND (o.holding_unit_id = smv_unit() OR smv_has_role('NODAL_OFFICER'))
  ) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM access_grant g WHERE g.case_id = p_case AND g.user_id = smv_uid()
             AND g.revoked_at IS NULL AND g.valid_to > now()) THEN RETURN true; END IF;
  RETURN false;
END $$;

CREATE FUNCTION smv_case_meta_by_id(p_case uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT smv_case_meta(sensitivity, holding_unit_id) FROM case_record WHERE id = p_case), false)
$$;

-- The Action Conflict Guard may reveal that a sealed matter exists on an institution, nothing more.
CREATE FUNCTION smv_restricted_matter_exists(p_institution uuid, p_exclude uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM case_record WHERE institution_id = p_institution AND id <> p_exclude
                 AND sensitivity = 'SEALED' AND status NOT IN ('DISPOSED', 'REJECTED_AT_INTAKE'))
$$;

ALTER TABLE case_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY case_select ON case_record FOR SELECT USING (smv_case_meta(sensitivity, holding_unit_id));
CREATE POLICY case_insert ON case_record FOR INSERT
  WITH CHECK (holding_unit_id = smv_unit() OR smv_has_role('COMPETENT_AUTHORITY'));
CREATE POLICY case_update ON case_record FOR UPDATE USING (smv_case_full(id)) WITH CHECK (true);

ALTER TABLE case_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY content_select ON case_content FOR SELECT USING (smv_case_full(case_id));
CREATE POLICY content_insert ON case_content FOR INSERT WITH CHECK (smv_case_full(case_id));
CREATE POLICY content_update ON case_content FOR UPDATE USING (smv_case_full(case_id));

ALTER TABLE case_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_select ON case_event FOR SELECT USING (smv_case_meta_by_id(case_id));
CREATE POLICY event_insert ON case_event FOR INSERT WITH CHECK (smv_case_meta_by_id(case_id));

ALTER TABLE document ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_select ON document FOR SELECT USING (smv_case_full(case_id));
CREATE POLICY document_insert ON document FOR INSERT WITH CHECK (smv_case_full(case_id));
CREATE POLICY document_update ON document FOR UPDATE USING (smv_case_full(case_id));

ALTER TABLE communication ENABLE ROW LEVEL SECURITY;
CREATE POLICY communication_select ON communication FOR SELECT USING (smv_case_full(case_id));
CREATE POLICY communication_insert ON communication FOR INSERT WITH CHECK (smv_case_full(case_id));
CREATE POLICY communication_update ON communication FOR UPDATE USING (smv_case_full(case_id));
"""

GRANTS = f"""
GRANT USAGE ON SCHEMA public TO {APP_ROLE}, {WORKER_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}, {WORKER_ROLE};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}, {WORKER_ROLE};
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {APP_ROLE}, {WORKER_ROLE};
-- History is append-only for both application roles.
REVOKE UPDATE, DELETE ON audit_event, case_event FROM {APP_ROLE}, {WORKER_ROLE};
REVOKE DELETE ON case_record, case_content, document, case_link, coordination, transfer FROM {APP_ROLE}, {WORKER_ROLE};
REVOKE ALL ON alembic_version FROM {APP_ROLE}, {WORKER_ROLE};
"""


def upgrade() -> None:
    op.execute(SCHEMA)
    op.execute(RLS)
    op.execute(GRANTS)


def downgrade() -> None:
    raise RuntimeError("The initial schema is not reversible; restore from backup instead.")
