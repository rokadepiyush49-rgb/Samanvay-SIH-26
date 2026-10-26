"""Roles (blueprint §15.1), the caller identity, and role checks.

Data visibility (full / metadata / none) is decided by the database functions smv_case_meta and smv_case_full,
which back the row-level security policies; the API asks the same functions so there is one source of truth.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum

from app.core.errors import forbidden


class Role(StrEnum):
    INTAKE_OFFICER = "INTAKE_OFFICER"
    CASE_OFFICER = "CASE_OFFICER"
    UNIT_HEAD = "UNIT_HEAD"
    REGIONAL_OFFICER = "REGIONAL_OFFICER"
    SENIOR_MGMT = "SENIOR_MGMT"
    COMPETENT_AUTHORITY = "COMPETENT_AUTHORITY"
    NODAL_OFFICER = "NODAL_OFFICER"
    DATA_STEWARD = "DATA_STEWARD"
    SYS_ADMIN = "SYS_ADMIN"
    AUDITOR = "AUDITOR"


ROLE_LABELS = {
    Role.INTAKE_OFFICER: "Intake officer",
    Role.CASE_OFFICER: "Case officer",
    Role.UNIT_HEAD: "Unit head",
    Role.REGIONAL_OFFICER: "Regional officer",
    Role.SENIOR_MGMT: "Senior management",
    Role.COMPETENT_AUTHORITY: "Competent Authority",
    Role.NODAL_OFFICER: "Coordination nodal officer",
    Role.DATA_STEWARD: "Data steward",
    Role.SYS_ADMIN: "System administrator",
    Role.AUDITOR: "Auditor",
}

CASE_VIEW_ROLES = frozenset(
    {
        Role.INTAKE_OFFICER,
        Role.CASE_OFFICER,
        Role.UNIT_HEAD,
        Role.REGIONAL_OFFICER,
        Role.SENIOR_MGMT,
        Role.COMPETENT_AUTHORITY,
        Role.NODAL_OFFICER,
        Role.AUDITOR,
    }
)
INTAKE_ROLES = frozenset({Role.INTAKE_OFFICER, Role.CASE_OFFICER, Role.UNIT_HEAD, Role.REGIONAL_OFFICER})
CASEWORK_ROLES = frozenset({Role.CASE_OFFICER, Role.UNIT_HEAD, Role.REGIONAL_OFFICER, Role.COMPETENT_AUTHORITY})
COORDINATION_ROLES = frozenset(
    {Role.CASE_OFFICER, Role.UNIT_HEAD, Role.REGIONAL_OFFICER, Role.COMPETENT_AUTHORITY, Role.NODAL_OFFICER}
)
MANAGEMENT_ROLES = frozenset({Role.UNIT_HEAD, Role.REGIONAL_OFFICER, Role.SENIOR_MGMT, Role.COMPETENT_AUTHORITY})
REPORT_ROLES = MANAGEMENT_ROLES | {Role.AUDITOR}
ALL_UNIT_ROLES = frozenset({Role.SENIOR_MGMT, Role.COMPETENT_AUTHORITY, Role.AUDITOR})

LANDING = [
    (Role.SYS_ADMIN, "/admin"),
    (Role.AUDITOR, "/audit"),
    (Role.DATA_STEWARD, "/institutions"),
    (Role.COMPETENT_AUTHORITY, "/cockpit"),
    (Role.SENIOR_MGMT, "/cockpit"),
    (Role.NODAL_OFFICER, "/coordination"),
    (Role.REGIONAL_OFFICER, "/cockpit"),
    (Role.UNIT_HEAD, "/desk"),
    (Role.CASE_OFFICER, "/desk"),
    (Role.INTAKE_OFFICER, "/desk"),
]


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    email: str
    full_name: str
    designation: str | None
    unit_id: uuid.UUID
    unit_code: str
    unit_name: str
    region_id: int | None
    roles: frozenset[str]
    sealed_clearance: bool
    session_id: uuid.UUID
    is_demo: bool = False

    def has(self, *roles: str) -> bool:
        return any(r in self.roles for r in roles)

    def require(self, roles: frozenset[str] | set[str], what: str) -> None:
        if not self.roles & set(roles):
            raise forbidden(f"Your role does not allow you to {what}.", required_roles=sorted(roles))

    @property
    def landing(self) -> str:
        for role, path in LANDING:
            if role in self.roles:
                return path
        return "/desk"

    @property
    def sees_all_units(self) -> bool:
        return bool(self.roles & ALL_UNIT_ROLES)
