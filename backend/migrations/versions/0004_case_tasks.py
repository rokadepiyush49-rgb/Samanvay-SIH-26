"""Case tasks: next actions with an owner, a deadline, a status and dependencies (ministry note p. 4 and data model
`case_tasks`; "convert messages into actions", p. 16).

Revision ID: 0004
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

APP_ROLE = "samanvay_app"
WORKER_ROLE = "samanvay_worker"

SQL = f"""
CREATE TABLE case_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES case_record(id),
  title text NOT NULL,
  owner_unit_id uuid NOT NULL REFERENCES unit(id),
  owner_id uuid REFERENCES app_user(id),
  due_on date,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'CANCELLED')),
  depends_on uuid REFERENCES case_task(id),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'COORDINATION', 'MESSAGE')),
  source_ref text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_by uuid REFERENCES app_user(id),
  done_at timestamptz,
  done_note text,
  row_version int NOT NULL DEFAULT 1,
  CHECK (depends_on IS NULL OR depends_on <> id)
);
CREATE INDEX case_task_case_idx ON case_task(case_id, status);
CREATE INDEX case_task_owner_idx ON case_task(owner_unit_id, status, due_on);

ALTER TABLE case_task ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_select ON case_task FOR SELECT USING (owner_unit_id = smv_unit() OR smv_case_full(case_id));
CREATE POLICY task_insert ON case_task FOR INSERT WITH CHECK (smv_case_full(case_id));
CREATE POLICY task_update ON case_task FOR UPDATE USING (owner_unit_id = smv_unit() OR smv_case_full(case_id));

ALTER TABLE notification DROP CONSTRAINT notification_family_check;
ALTER TABLE notification ADD CONSTRAINT notification_family_check
  CHECK (family IN ('OVERLAP', 'SLA', 'TRANSFER', 'ESCALATION', 'COORDINATION', 'ASSISTANCE', 'TASK', 'SYSTEM'));

GRANT SELECT, INSERT, UPDATE ON case_task TO {APP_ROLE}, {WORKER_ROLE};
"""


def upgrade() -> None:
    op.execute(SQL)


def downgrade() -> None:
    raise RuntimeError("Not reversible; restore from backup instead.")
