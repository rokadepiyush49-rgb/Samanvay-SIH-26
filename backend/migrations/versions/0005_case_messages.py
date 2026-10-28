"""Secure case-linked messaging (ministry note p. 16, messaging module): a thread on each case for the units that can
see its content.

Visibility is the case's own full-content rule (smv_case_full), so a unit reads and writes the thread exactly while it
holds, coordinates on, assists with or is being offered the case. Messages are insert-only: the API role has no
UPDATE or DELETE grant, and the audit chain records a SHA-256 of each body so a later change would be detectable.

Revision ID: 0005
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

APP_ROLE = "samanvay_app"
WORKER_ROLE = "samanvay_worker"

SQL = f"""
CREATE TABLE case_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES case_record(id),
  author_id uuid NOT NULL REFERENCES app_user(id),
  unit_id uuid NOT NULL REFERENCES unit(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  body_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_message_case_idx ON case_message(case_id, created_at);

ALTER TABLE case_message ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_select ON case_message FOR SELECT USING (smv_case_full(case_id));
CREATE POLICY message_insert ON case_message FOR INSERT
  WITH CHECK (smv_case_full(case_id) AND author_id = smv_uid() AND unit_id = smv_unit());

ALTER TABLE notification DROP CONSTRAINT notification_family_check;
ALTER TABLE notification ADD CONSTRAINT notification_family_check
  CHECK (family IN ('OVERLAP', 'SLA', 'TRANSFER', 'ESCALATION', 'COORDINATION', 'ASSISTANCE', 'TASK', 'MESSAGE',
                    'SYSTEM'));

GRANT SELECT, INSERT ON case_message TO {APP_ROLE};
GRANT SELECT ON case_message TO {WORKER_ROLE};
"""


def upgrade() -> None:
    op.execute(SQL)


def downgrade() -> None:
    raise RuntimeError("Not reversible; restore from backup instead.")
