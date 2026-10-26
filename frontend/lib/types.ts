export type Me = {
  id: string;
  email: string;
  full_name: string;
  designation: string | null;
  unit: { id: string; code: string; name: string };
  region_id: number | null;
  roles: string[];
  role_labels: string[];
  sealed_clearance: boolean;
  landing: string;
  is_demo: boolean;
  demo_mode: boolean;
};

export type Reason = { code: string; label: string; weight: number; value?: number };

export type CaseRow = {
  id: string;
  case_no: string;
  channel: string;
  source_ref: string | null;
  status: string;
  status_label: string;
  bucket: string;
  sensitivity: string;
  received_on: string;
  expected_disposal: string | null;
  working_days_left: number | null;
  overdue: boolean;
  escalated: boolean;
  last_action: string | null;
  last_action_at: string | null;
  next_action: string | null;
  next_action_due: string | null;
  resolution_status: string;
  institution: { id: string; permanent_id: string; name: string; city: string | null } | null;
  institution_raw: string | null;
  category: { code: string; name: string; group: string };
  holding_unit: { code: string; name: string };
  holding_officer: { id: string; name: string } | null;
  subject: string | null;
  full_access: boolean;
  overlaps: { parallel_open: number; other_open: number };
  transfer_to: string | null;
};

export type CaseList = { items: CaseRow[]; total: number; next_cursor: string | null; as_of: string };

export type Meta = {
  statuses: { code: string; label: string; bucket: string }[];
  channels: string[];
  complainant_types: string[];
  categories: { code: string; name: string; name_hi: string | null; group_code: string; sensitivity: string }[];
  units: { code: string; name: string; unit_type: string; region_id: number | null }[];
  regions: { id: number; code: string; name: string }[];
  consequential_actions: string[];
  phrase: string;
};
