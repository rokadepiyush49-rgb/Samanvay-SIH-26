"""Inter-bureau routing and assistance (ministry note pp. 13–15) and the "needs verification" coordination state.

* unit_mandate — the unit directory (proposed v0): which unit holds the PRIMARY mandate for a category and which
  units SUPPORT it. Rows name one unit or every unit of a type (Regional Offices, own region only).
* assistance_request — another unit is asked for input or a task while the holding unit keeps the case. The assisting
  unit sees the case's content only while its request is open (smv_case_full below).
* coordination.status gains VERIFYING: officers record that the link needs verification before deciding.

Revision ID: 0003
"""

import sqlalchemy as sa
from alembic import op

from app.reference_data import CATEGORIES, MANDATE_BASIS, SUPPORT_MANDATES

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

APP_ROLE = "samanvay_app"
WORKER_ROLE = "samanvay_worker"

SCHEMA = r"""
CREATE TABLE unit_mandate (
  id serial PRIMARY KEY,
  unit_code text,
  unit_type text CHECK (unit_type IN ('BUREAU', 'CELL', 'REGIONAL_OFFICE')),
  category_code text NOT NULL REFERENCES category(code),
  role text NOT NULL CHECK (role IN ('PRIMARY', 'SUPPORT')),
  own_region_only boolean NOT NULL DEFAULT false,
  basis text NOT NULL,
  approval_status text NOT NULL DEFAULT 'PROPOSED' CHECK (approval_status IN ('PROPOSED', 'APPROVED')),
  CHECK ((unit_code IS NULL) <> (unit_type IS NULL)),
  UNIQUE NULLS NOT DISTINCT (unit_code, unit_type, category_code)
);

CREATE SEQUENCE assistance_no_seq;
CREATE TABLE assistance_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  case_id uuid NOT NULL REFERENCES case_record(id),
  from_unit_id uuid NOT NULL REFERENCES unit(id),
  to_unit_id uuid NOT NULL REFERENCES unit(id),
  kind text NOT NULL CHECK (kind IN ('VERIFICATION', 'INFORMATION', 'OPINION', 'ACTION')),
  request text NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED')),
  requested_by uuid NOT NULL REFERENCES app_user(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  assignee_id uuid REFERENCES app_user(id),
  responded_by uuid REFERENCES app_user(id),
  responded_at timestamptz,
  response text,
  suggested_unit text,
  followed_recommendation boolean NOT NULL DEFAULT false,
  row_version int NOT NULL DEFAULT 1,
  CHECK (from_unit_id <> to_unit_id)
);
CREATE UNIQUE INDEX assistance_one_open_uq ON assistance_request(case_id, to_unit_id)
  WHERE status IN ('SENT', 'ACCEPTED');
CREATE INDEX assistance_to_idx ON assistance_request(to_unit_id, status);
CREATE INDEX assistance_from_idx ON assistance_request(from_unit_id, status);

ALTER TABLE timer ADD COLUMN assistance_id uuid REFERENCES assistance_request(id);

ALTER TABLE coordination DROP CONSTRAINT coordination_status_check;
ALTER TABLE coordination ADD CONSTRAINT coordination_status_check
  CHECK (status IN ('OPEN', 'AWAITING_CONFIRMATION', 'VERIFYING', 'DECIDED', 'ESCALATED'));
ALTER TABLE coordination ADD COLUMN verification jsonb;

ALTER TABLE notification DROP CONSTRAINT notification_family_check;
ALTER TABLE notification ADD CONSTRAINT notification_family_check
  CHECK (family IN ('OVERLAP', 'SLA', 'TRANSFER', 'ESCALATION', 'COORDINATION', 'ASSISTANCE', 'SYSTEM'));
"""

# Same function as 0001 plus one clause: the unit asked for assistance, while the request is open.
CASE_FULL = r"""
CREATE OR REPLACE FUNCTION smv_case_full(p_case uuid) RETURNS boolean
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
  IF EXISTS (SELECT 1 FROM assistance_request a WHERE a.case_id = p_case AND a.to_unit_id = smv_unit()
             AND a.status IN ('SENT', 'ACCEPTED') AND smv_case_role()) THEN RETURN true; END IF;
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

ALTER TABLE assistance_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistance_select ON assistance_request FOR SELECT
  USING (from_unit_id = smv_unit() OR to_unit_id = smv_unit() OR smv_case_full(case_id));
CREATE POLICY assistance_insert ON assistance_request FOR INSERT
  WITH CHECK (from_unit_id = smv_unit() OR smv_has_role('COMPETENT_AUTHORITY'));
CREATE POLICY assistance_update ON assistance_request FOR UPDATE
  USING (from_unit_id = smv_unit() OR to_unit_id = smv_unit() OR smv_has_role('COMPETENT_AUTHORITY'));
"""

GRANTS = f"""
GRANT SELECT, INSERT, UPDATE ON assistance_request TO {APP_ROLE}, {WORKER_ROLE};
GRANT SELECT ON unit_mandate TO {APP_ROLE}, {WORKER_ROLE};
GRANT USAGE, SELECT ON SEQUENCE assistance_no_seq TO {APP_ROLE}, {WORKER_ROLE};
"""


def upgrade() -> None:
    op.execute(SCHEMA)
    op.execute(CASE_FULL)
    op.execute(GRANTS)
    bind = op.get_bind()
    insert = sa.text(
        "INSERT INTO unit_mandate (unit_code, unit_type, category_code, role, own_region_only, basis) "
        "VALUES (:u, :t, :c, :r, :o, :b)"
    )
    for code, *_, unit, _sens in CATEGORIES:
        if unit in MANDATE_BASIS:
            bind.execute(
                insert, {"u": unit, "t": None, "c": code, "r": "PRIMARY", "o": False, "b": MANDATE_BASIS[unit]}
            )
    for unit, unit_type, category, own_region, basis in SUPPORT_MANDATES:
        bind.execute(insert, {"u": unit, "t": unit_type, "c": category, "r": "SUPPORT", "o": own_region, "b": basis})


def downgrade() -> None:
    raise RuntimeError("Not reversible; restore from backup instead.")
