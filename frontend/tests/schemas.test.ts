import { describe, expect, it } from "vitest";
import { decisionSchema, guardReasonSchema, loginSchema, transferSchema } from "@/lib/schemas";

const base = { decision: "RELATED" as const, lead_unit: "", joint_next_action: "", joint_due: "", remarks: "" };

describe("coordination decision", () => {
  it("requires a lead unit for related and duplicate matters", () => {
    const r = decisionSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["lead_unit"]);
    expect(decisionSchema.safeParse({ ...base, decision: "DUPLICATE", lead_unit: "RB" }).success).toBe(true);
  });
  it("requires a reason to dismiss as not related", () => {
    expect(decisionSchema.safeParse({ ...base, decision: "NOT_RELATED" }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...base, decision: "NOT_RELATED", remarks: "Different campuses" }).success).toBe(true);
  });
});

describe("other forms", () => {
  it("validates sign-in input", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@aicte-india.org", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: " a@aicte-india.org ", password: "x" }).success).toBe(true);
  });
  it("needs a receiving unit and a reason to transfer", () => {
    expect(transferSchema.safeParse({ to_unit: "", reason: "RB has jurisdiction" }).success).toBe(false);
    expect(transferSchema.safeParse({ to_unit: "RB", reason: "RB has jurisdiction" }).success).toBe(true);
  });
  it("matches the guard's 10-character rule for proceeding past an overlap", () => {
    expect(guardReasonSchema.safeParse("urgent").success).toBe(false);
    expect(guardReasonSchema.safeParse("Statutory hearing is due tomorrow").success).toBe(true);
  });
});
