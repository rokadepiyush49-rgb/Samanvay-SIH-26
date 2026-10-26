import { describe, expect, it } from "vitest";
import { byUrgency, nextStep, priorityOf } from "@/lib/priority";
import { caseRow } from "./fixtures";

describe("priorityOf", () => {
  it("marks overdue, escalated and parallel-action cases critical", () => {
    expect(priorityOf(caseRow({ overdue: true }))).toBe("critical");
    expect(priorityOf(caseRow({ escalated: true }))).toBe("critical");
    expect(priorityOf(caseRow({ overlaps: { parallel_open: 1, other_open: 0 } }))).toBe("critical");
  });
  it("ranks near deadlines and pending transfers high, then medium and low", () => {
    expect(priorityOf(caseRow({ working_days_left: 2 }))).toBe("high");
    expect(priorityOf(caseRow({ transfer_to: "PGRC" }))).toBe("high");
    expect(priorityOf(caseRow({ working_days_left: 6 }))).toBe("medium");
    expect(priorityOf(caseRow({ resolution_status: "PENDING" }))).toBe("medium");
    expect(priorityOf(caseRow())).toBe("low");
  });
  it("never escalates closed cases", () => {
    expect(priorityOf(caseRow({ bucket: "disposed", overdue: true }))).toBe("low");
  });
});

describe("byUrgency", () => {
  it("sorts by priority, then working days left", () => {
    const rows = [
      caseRow({ case_no: "A", working_days_left: 30 }),
      caseRow({ case_no: "B", overdue: true, working_days_left: null }),
      caseRow({ case_no: "C", working_days_left: 2 }),
      caseRow({ case_no: "D", working_days_left: 1 }),
    ];
    expect([...rows].sort(byUrgency).map((r) => r.case_no)).toEqual(["B", "D", "C", "A"]);
  });
});

describe("nextStep", () => {
  it("prefers the recorded next action", () => {
    expect(nextStep(caseRow({ next_action: "Await reply" }))).toEqual({ text: "Await reply", suggested: false });
  });
  it("labels derived steps as suggestions", () => {
    expect(nextStep(caseRow({ transfer_to: "PGRC" }))).toMatchObject({ suggested: true });
    expect(nextStep(caseRow({ bucket: "disposed" }))).toBeNull();
  });
});
