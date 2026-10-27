import { describe, expect, it } from "vitest";
import {
  assistanceReplySchema, assistanceSchema, decisionSchema, guardReasonSchema, loginSchema, transferSchema, verificationSchema,
} from "@/lib/schemas";

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
  it("needs a unit and a 10-character request to ask for assistance (API rule)", () => {
    const ok = { to_unit: "RO-W", kind: "VERIFICATION" as const, request: "Verify faculty on rolls", due_on: "" };
    expect(assistanceSchema.safeParse(ok).success).toBe(true);
    expect(assistanceSchema.safeParse({ ...ok, to_unit: "" }).success).toBe(false);
    expect(assistanceSchema.safeParse({ ...ok, request: "check" }).success).toBe(false);
    expect(assistanceReplySchema.safeParse({ text: "Done.", suggested_unit: "" }).success).toBe(false);
  });
  it("needs a 10-character note of what to verify before deciding", () => {
    expect(verificationSchema.safeParse({ remarks: "check", verify_by: "" }).success).toBe(false);
    expect(verificationSchema.safeParse({ remarks: "Confirm the batch year", verify_by: "" }).success).toBe(true);
  });
  it("matches the guard's 10-character rule for proceeding past an overlap", () => {
    expect(guardReasonSchema.safeParse("urgent").success).toBe(false);
    expect(guardReasonSchema.safeParse("Statutory hearing is due tomorrow").success).toBe(true);
  });
});
