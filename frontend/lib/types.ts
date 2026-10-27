/** Response shapes of the Samanvay API (backend/app/modules/*). Keep in step with the routers. */

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

export type DemoUser = { id: string; full_name: string; designation: string | null; unit_code: string; unit_name: string; role_labels: string[] };

export type Reason = { code: string; label: string; weight: number; value?: number };

export type Bucket = "pending" | "under_process" | "disposed" | "rejected" | "transferred";

export type CaseRow = {
  id: string;
  case_no: string;
  channel: string;
  source_ref: string | null;
  status: string;
  status_label: string;
  bucket: Bucket | string;
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
  region_id?: number | null;
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

export type AllowedAction = { action: string; label: string; to_status: string; requires_remarks: boolean; consequential: boolean };

export type TimelineEvent = {
  id: number; type: string; action: string | null; action_label: string | null; at: string; actor: string; actor_unit: string | null;
  from_status: string | null; to_status: string | null; from_unit: string | null; to_unit: string | null; remarks?: string | null;
  data: Record<string, unknown>;
};

export type CaseLink = {
  id: string; type: string; type_label: string; probability: number; reasons: Reason[]; status: string; other_case: string;
  other_status_label: string | null; other_unit: string; coordination_code: string | null; coordination_status: string | null;
  decision: string | null; lead_unit: string | null;
};

export type CaseDocument = {
  id: string; filename: string; mime: string; size_bytes: number; sha256: string; scan_status: string; scan_detail: string;
  uploaded_at: string; uploaded_by: string;
};

export type CaseDetail = CaseRow & {
  row_version: number;
  tier: "full" | "metadata";
  cpgrams_no: string | null;
  language: string;
  institution_weight: number | null;
  holder_since: string;
  timeline: TimelineEvent[];
  links: CaseLink[];
  coordination: { code: string; status: string; decision: string | null; lead_unit: string | null; other_case: string; other_unit: string; type: string; probability: number }[];
  coordination_required: boolean;
  phrase: string;
  allowed_actions: AllowedAction[];
  can_transfer: boolean;
  pending_transfer: { id: string; reason: string | null; proposed_at: string; from_unit: string; to_unit: string; can_decide: boolean } | null;
  content: { subject: string; body: string; complainant_on_file: boolean } | null;
  documents: CaseDocument[] | null;
  upcoming?: { kind: string; due_at: string }[];
  institution_candidates?: { institution_id: string; permanent_id: string; name: string; city: string; probability: number; reasons: Reason[] }[];
  sla_policy?: { code: string; version: number; name: string; day_basis: string; target_days: number; approval_status: string } | null;
  access_note?: string;
  assistance: AssistanceRequest[];
  can_request_assistance: boolean;
  routing: RoutingRecommendation | null;
};

/** Bureau routing recommendation (backend/app/modules/routing/service.py): advisory, the officer decides. */
export type RoutingAlternative = { unit: string; unit_name: string; score: number; mandate: "PRIMARY" | "SUPPORT" | null; reasons: Reason[] };
export type RoutingRecommendation = {
  model: string;
  action: "KEEP" | "TRANSFER" | "ASSIST";
  unit: string;
  unit_name: string;
  unit_type: "BUREAU" | "CELL" | "REGIONAL_OFFICE";
  holder: string;
  confidence: number;
  ambiguous: boolean;
  reasons: Reason[];
  holder_reasons: Reason[];
  alternatives: RoutingAlternative[];
  coordinating: { unit: string; coordination: string }[];
  note: string;
};

export type DirectoryEntry = {
  id: string; code: string; name: string; region_id: number | null; category_code: string; category: string;
  role: "PRIMARY" | "SUPPORT"; own_region_only: boolean; basis: string; approval_status: string;
};

export type AssistanceKind = "VERIFICATION" | "INFORMATION" | "OPINION" | "ACTION";
export type AssistanceRequest = {
  id: string; code: string; kind: AssistanceKind; kind_label: string; request: string; due_on: string; overdue: boolean;
  status: "SENT" | "ACCEPTED" | "DECLINED" | "COMPLETED" | "CANCELLED"; requested_at: string; responded_at: string | null;
  response: string | null; suggested_unit: string | null; row_version: number; followed_recommendation: boolean;
  case_no: string; case_status: string; case_status_label: string; category: string;
  institution: { name: string; permanent_id: string } | null; from_unit: string; to_unit: string; requested_by: string;
  assignee: string | null; can_respond: boolean; can_cancel: boolean;
};
export type AssistanceList = {
  items: AssistanceRequest[];
  counts: { awaiting_ack: number; incoming_open: number; outgoing_open: number; overdue: number };
};

export type GuardResult = {
  guard_check_id: string;
  action: string;
  result: "NO_CONFLICT" | "COORDINATION_SUGGESTED" | "COORDINATED";
  other_matters: {
    case_no: string; unit_code: string; status_label: string; category: string; link_type: string; probability: number | null;
    decided: boolean; coordination_code: string | null; lead_unit: string | null; decision: string | null;
  }[];
  restricted_matter_exists: boolean;
  restricted_note: string | null;
  fallback: boolean;
  fallback_note: string | null;
  choices: string[];
};

export type CoordSide = {
  case_id: string; case_no: string; status: string; status_label: string; unit: string; officer: string | null;
  category: string; received_on: string; holder_since: string; subject?: string | null; body?: string | null;
};

export type CoordinationCard = {
  id: string; code: string; status: string; decision: string | null; lead_unit: string | null; phrase: string; type: string; type_label: string;
  probability: number; reasons: Reason[]; decide_by: string; working_days_left: number; proposal: Record<string, string | null> | null;
  row_version: number; institution: { name: string | null; permanent_id: string | null; city: string | null }; a: CoordSide; b: CoordSide;
  participant: boolean; awaiting_me: boolean; can_decide: boolean;
  verification: { what: string; by: string; by_unit: string; verify_by: string; at: string } | null;
};

export type CoordinationRoom = CoordinationCard & {
  messages: { id: string; body: string; at: string; author: string; unit: string }[];
  units: string[];
};

export type CoordinationList = { items: CoordinationCard[]; counts: { awaiting_me: number; parallel: number; escalated: number } };

export type Transfer = {
  id: string; status: "PROPOSED" | "ACCEPTED" | "RETURNED" | string; case_no: string; case_status: string; category: string;
  institution: { name: string; permanent_id: string } | null; from_unit: string; to_unit: string; holding_unit: string;
  proposed_by: string; proposed_at: string; reason: string | null; decided_by: string | null; decided_at: string | null;
  decision_remarks: string | null; can_decide: boolean;
};

export type Notification = { id: string; family: string; severity: string; title: string; body: string; link: string | null; created_at: string; read: boolean };
export type NotificationList = { items: Notification[]; unread: Record<string, number>; unread_total: number };

export type Desk = {
  as_of: string;
  scope: "unit" | "mine";
  worklist: CaseRow[];
  worklist_total: number;
  due_this_week: number;
  overdue: number;
  transfers_awaiting: { id: string; case_no: string; from_unit: string; proposed_at: string; category: string }[];
  coordination_open: { code: string; status: string; type: string; decide_by: string; cases: string[] }[];
  unresolved_institutions: number;
};

export type Summary = {
  scope: { unit: string | null; region: number | null };
  as_of: string;
  tiles: { key: string; label: string; value: number; query: string }[];
  rejected_at_intake: number;
  ageing: { bucket: string; count: number }[];
  workload: { unit: string; open: number; overdue: number; "0–10": number; "11–21": number; "22–60": number; ">60": number }[];
  within_timeline: { on_time: number; disposed: number; pct: number | null; window_days: number };
  undecided_overlaps: { count: number; oldest_working_days: number | null };
  multi_unit_institutions: number;
  kpis: { consequential_actions_past_undecided_overlap: number; consequential_actions_total: number; coordination_opened_from_guard: number; median_alert_to_decision_hours: number | null };
  register_health: { unit: string; open: number; resolved_pct: number | null; assigned_pct: number | null; stale_pct: number | null; score: number | null }[];
};

export type BreakdownRow = {
  key: string | number; name: string; total: number; pending: number; under_process: number; transferred: number; disposed: number;
  overdue: number; sla_pct: number | null; disposed_90: number;
};

export type Analytics = {
  scope: { unit: string | null; region: number | null };
  as_of: string;
  trend: { month: string; received: number; disposed: number; on_time: number }[];
  by_unit: BreakdownRow[];
  by_region: BreakdownRow[];
  by_category: BreakdownRow[];
};

export type InstitutionListItem = {
  id: string; permanent_id: string; name: string; city: string; state: string; region_code: string; approval_status: string;
  open_cases: number; total_cases: number; units_involved: number; units: string[]; oldest_open: string | null;
};

export type Institution360 = {
  institution: {
    permanent_id: string; name: string; address: string; city: string; state: string; pin: string;
    region: { code: string; name: string } | null; inst_type: string; approval_status: string; trust_name: string | null;
  };
  aliases: { alias: string; source: string }[];
  siblings: { permanent_id: string; name: string; city: string }[];
  cases: CaseRow[];
  by_unit: { unit: string; unit_name: string; open: number; total: number; custodians: string[] }[];
  links?: { a: string; b: string; type: string; status: string; probability: number }[];
  clusters: string[][];
  restricted_matter_exists: boolean;
  multi_unit?: boolean;
};

export type ReportSpec = { code: string; title: string; description: string; period: boolean };
export type ReportSnapshot = {
  id: string; report_code: string; title: string; cut_off: string; checksum: string; created_at: string; scope: Record<string, unknown>;
  checksum_verified?: boolean;
  data?: { columns: string[]; rows: (string | number | null)[][]; totals?: (string | number | null)[]; notes?: string[]; period?: { label: string } };
};

export type AuditEvents = {
  items: { seq: number; at: string; action: string; entity_type: string | null; entity_id: string | null; payload: Record<string, unknown>; hash: string; actor: string | null; unit: string | null }[];
  head_seq: number;
  last_checkpoint: { upto_seq: number; at: string; key_id: string } | null;
};
export type AuditVerify = { ok: boolean; entries: number; checkpoints: number; first_broken_seq: number | null; problem: string | null; public_key_id: string };
