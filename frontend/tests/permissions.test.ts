import { describe, expect, it } from "vitest";
import { visibleNav } from "@/components/shell/nav";
import { can } from "@/lib/permissions";
import { me } from "./fixtures";

const hrefs = (roles: string[]) => visibleNav(me(roles)).flatMap((g) => g.items.map((i) => i.href));

describe("capabilities mirror the API role sets", () => {
  it("lets case officers act and coordinate but not administer", () => {
    const officer = me(["CASE_OFFICER"]);
    expect(can(officer, "cases.act")).toBe(true);
    expect(can(officer, "coordination.decide")).toBe(true);
    expect(can(officer, "admin.view")).toBe(false);
    expect(can(officer, "cockpit.view")).toBe(false);
  });
  it("keeps data stewards out of the case register", () => {
    expect(can(me(["DATA_STEWARD"]), "cases.view")).toBe(false);
    expect(can(me(["DATA_STEWARD"]), "institutions.steward")).toBe(true);
  });
  it("gives auditors the audit trail and reports, read-only", () => {
    const auditor = me(["AUDITOR"]);
    expect(can(auditor, "audit.view")).toBe(true);
    expect(can(auditor, "audit.checkpoint")).toBe(false);
    expect(can(auditor, "cases.act")).toBe(false);
  });
  it("treats an unknown or missing user as having nothing", () => {
    expect(can(null, "cases.view")).toBe(false);
    expect(can(me([]), "cases.view")).toBe(false);
  });
});

describe("navigation is role-based", () => {
  it("shows the desk and worklist to case officers", () => {
    const h = hrefs(["CASE_OFFICER"]);
    expect(h).toEqual(expect.arrayContaining(["/desk", "/worklist", "/cases", "/coordination", "/transfers", "/notifications", "/settings"]));
    expect(h).not.toContain("/admin");
    expect(h).not.toContain("/audit");
  });
  it("shows administration and audit to system administrators but no case register", () => {
    const h = hrefs(["SYS_ADMIN"]);
    expect(h).toEqual(expect.arrayContaining(["/admin", "/audit", "/settings"]));
    expect(h).not.toContain("/cases");
  });
  it("always offers notifications and settings", () => {
    expect(hrefs(["DATA_STEWARD"])).toEqual(expect.arrayContaining(["/institutions", "/notifications", "/settings"]));
  });
});
