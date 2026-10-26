import type { CaseRow, GuardResult, Me } from "@/lib/types";

export function me(roles: string[], over: Partial<Me> = {}): Me {
  return {
    id: "u1", email: "officer@aicte.example", full_name: "Test Officer", designation: "Deputy Director",
    unit: { id: "unit-rb", code: "RB", name: "Regulation Bureau" }, region_id: null, roles, role_labels: roles,
    sealed_clearance: false, landing: "/desk", is_demo: true, demo_mode: true, ...over,
  };
}

export function caseRow(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: "c1", case_no: "SMV-2026-000100", channel: "EMAIL", source_ref: null, status: "UNDER_EXAMINATION", status_label: "Under examination",
    bucket: "under_process", sensitivity: "NORMAL", received_on: "2026-10-01", expected_disposal: "2026-11-30", working_days_left: 20,
    overdue: false, escalated: false, last_action: null, last_action_at: null, next_action: null, next_action_due: null,
    resolution_status: "RESOLVED", institution: { id: "i1", permanent_id: "1-1000000001", name: "Shivaji Institute of Technology", city: "Kolhapur" },
    institution_raw: null, category: { code: "GRV_CERTIFICATE", name: "Withholding of certificates", group: "GRIEVANCE" },
    holding_unit: { code: "RB", name: "Regulation Bureau" }, holding_officer: { id: "o1", name: "Rohit Verma" }, subject: "Certificates withheld",
    full_access: true, overlaps: { parallel_open: 0, other_open: 0 }, transfer_to: null, ...over,
  };
}

export function guard(over: Partial<GuardResult> = {}): GuardResult {
  return {
    guard_check_id: "g1", action: "SHOW_CAUSE_NOTICE", result: "COORDINATION_SUGGESTED",
    other_matters: [{ case_no: "SMV-2026-000002", unit_code: "RO-W", status_label: "Registered", category: "Infrastructure", link_type: "P", probability: null, decided: false, coordination_code: "C-2026-00001", lead_unit: null, decision: null }],
    restricted_matter_exists: false, restricted_note: null, fallback: false, fallback_note: null,
    choices: ["OPEN_COORDINATION", "PROCEED_AND_NOTIFY", "CANCEL"], ...over,
  };
}
