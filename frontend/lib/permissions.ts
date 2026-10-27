/**
 * Capability model for the web app. Mirrors the role sets in backend/app/modules/policy/roles.py so navigation and
 * buttons match what the API will allow. This is a usability layer only: the API and PostgreSQL row-level security
 * enforce every rule, and a hidden button is never the protection.
 */
import type { Me } from "./types";

export type Role =
  | "INTAKE_OFFICER" | "CASE_OFFICER" | "UNIT_HEAD" | "REGIONAL_OFFICER" | "SENIOR_MGMT" | "COMPETENT_AUTHORITY"
  | "NODAL_OFFICER" | "DATA_STEWARD" | "SYS_ADMIN" | "AUDITOR";

const CASE_VIEW: Role[] = ["INTAKE_OFFICER", "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY", "NODAL_OFFICER", "AUDITOR"];
const INTAKE: Role[] = ["INTAKE_OFFICER", "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER"];
const CASEWORK: Role[] = ["CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER", "COMPETENT_AUTHORITY"];
const COORDINATION: Role[] = ["CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER", "COMPETENT_AUTHORITY", "NODAL_OFFICER"];
const MANAGEMENT: Role[] = ["UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY"];
const OVERSIGHT: Role[] = ["SENIOR_MGMT", "COMPETENT_AUTHORITY", "NODAL_OFFICER", "AUDITOR"];

export const CAPABILITIES = {
  "desk.view": INTAKE,
  "worklist.view": INTAKE,
  "cases.view": CASE_VIEW,
  "cases.create": INTAKE,
  "cases.act": CASEWORK,
  "cases.export": [...MANAGEMENT, "AUDITOR"] as Role[],
  "coordination.view": [...COORDINATION, "SENIOR_MGMT", "AUDITOR"] as Role[],
  "coordination.decide": COORDINATION,
  "transfers.view": CASE_VIEW,
  "transfers.decide": CASEWORK,
  "assistance.view": CASE_VIEW,
  "assistance.respond": CASEWORK,
  "institutions.view": [...CASE_VIEW, "DATA_STEWARD"] as Role[],
  "institutions.steward": ["DATA_STEWARD"] as Role[],
  "imports.run": INTAKE,
  "cockpit.view": MANAGEMENT,
  "reports.view": [...MANAGEMENT, "AUDITOR"] as Role[],
  "benchmark.view": ["UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY", "SYS_ADMIN", "AUDITOR", "DATA_STEWARD", "CASE_OFFICER"] as Role[],
  "admin.view": ["SYS_ADMIN"] as Role[],
  "audit.view": ["SYS_ADMIN", "AUDITOR"] as Role[],
  "audit.checkpoint": ["SYS_ADMIN"] as Role[],
  "oversight.all_units": OVERSIGHT,
} satisfies Record<string, Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(me: Pick<Me, "roles"> | null | undefined, cap: Capability): boolean {
  if (!me) return false;
  return CAPABILITIES[cap].some((r) => me.roles.includes(r));
}

export function hasRole(me: Pick<Me, "roles"> | null | undefined, ...roles: string[]): boolean {
  return !!me && roles.some((r) => me.roles.includes(r));
}
