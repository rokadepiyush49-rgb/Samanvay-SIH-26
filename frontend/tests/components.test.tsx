import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuardSummary, guardLevel } from "@/components/conflict-guard";
import { EvidenceList, PriorityIndicator, StatusBadge } from "@/components/status";
import type { AllowedAction } from "@/lib/types";
import { guard } from "./fixtures";

const action: AllowedAction = { action: "SHOW_CAUSE_NOTICE", label: "Issue show-cause notice", to_status: "ACTION_INITIATED", requires_remarks: true, consequential: true };

describe("Action Conflict Guard", () => {
  it("maps API results to the four levels", () => {
    expect(guardLevel(guard({ result: "NO_CONFLICT", choices: ["PROCEED", "CANCEL"] }))).toBe("approved");
    expect(guardLevel(guard({ result: "COORDINATED", choices: ["PROCEED", "CANCEL"] }))).toBe("info");
    expect(guardLevel(guard())).toBe("review");
    expect(guardLevel(guard({ choices: ["OPEN_COORDINATION", "CANCEL"] }))).toBe("blocked");
  });
  it("shows the proposed action, the related case, its unit and why it was flagged", () => {
    render(<GuardSummary guard={guard()} action={action} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Review required/);
    expect(screen.getByText("Issue show-cause notice")).toBeInTheDocument();
    const item = screen.getByRole("link", { name: "SMV-2026-000002" }).closest("li")!;
    expect(within(item).getByText(/RO-W/)).toBeInTheDocument();
    expect(within(item).getByText("Parallel action")).toBeInTheDocument();
    expect(within(item).getByText("Undecided")).toBeInTheDocument();
  });
  it("uses a status role, not an alert, when the action is approved", () => {
    render(<GuardSummary guard={guard({ result: "NO_CONFLICT", other_matters: [], choices: ["PROCEED", "CANCEL"] })} action={action} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Approved to proceed");
  });
});

describe("status never relies on colour alone", () => {
  it("renders status and priority as text", () => {
    render(<><StatusBadge bucket="pending" label="Received" /><PriorityIndicator priority="critical" /></>);
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });
  it("lists matching evidence strongest first, with signs", () => {
    render(<EvidenceList reasons={[
      { code: "text", label: "Text similarity 0.21", weight: -1 },
      { code: "pid", label: "Same Permanent ID", weight: 4 },
      { code: "corroborated", label: "hidden", weight: 9 },
    ]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Same Permanent ID");
    expect(items[0]).toHaveTextContent("+4.0");
    expect(items[1]).toHaveTextContent("−");
  });
});
