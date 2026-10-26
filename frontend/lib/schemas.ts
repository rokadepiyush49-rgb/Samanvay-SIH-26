/** Form validation shared by the UI and the unit tests. Rules mirror the API's own checks (case/service.py,
 * coordination/service.py, guard.py) so the form never invents stricter business rules; the API validates again. */
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your official e-mail address.").email("Enter a valid e-mail address, e.g. name@aicte-india.org."),
  password: z.string().min(1, "Enter your password."),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const transferSchema = z.object({
  to_unit: z.string().min(1, "Choose the receiving unit."),
  reason: z.string().trim().min(3, "Give the receiving unit a reason.").max(2000),
});
export type TransferForm = z.infer<typeof transferSchema>;

export const returnTransferSchema = z.object({
  remarks: z.string().trim().min(1, "A reason is required when returning a transfer.").max(2000),
});
export type ReturnTransferForm = z.infer<typeof returnTransferSchema>;

export const actionSchema = (requiresRemarks: boolean) =>
  z.object({
    remarks: requiresRemarks ? z.string().trim().min(1, "Remarks are required for this action.").max(4000) : z.string().max(4000),
    next_action: z.string().max(300),
    next_action_due: z.string(),
  });
export type ActionForm = z.infer<ReturnType<typeof actionSchema>>;

export const noteSchema = z.object({
  kind: z.enum(["NOTE", "INTERIM_REPLY_SENT", "NEXT_ACTION"]),
  remarks: z.string().trim().min(1, "Write the note or reply summary.").max(4000),
  next_action: z.string().max(300),
  next_action_due: z.string(),
});
export type NoteForm = z.infer<typeof noteSchema>;

/** Coordination decision. "Related" and "duplicate" need a lead unit; "not related" needs a reason. */
export const decisionSchema = z
  .object({
    decision: z.enum(["DUPLICATE", "RELATED", "NOT_RELATED"]),
    lead_unit: z.string(),
    joint_next_action: z.string().max(300),
    joint_due: z.string(),
    remarks: z.string().max(2000),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "NOT_RELATED" && !v.lead_unit) ctx.addIssue({ code: "custom", path: ["lead_unit"], message: "Choose which unit leads." });
    if (v.decision === "NOT_RELATED" && !v.remarks.trim())
      ctx.addIssue({ code: "custom", path: ["remarks"], message: "Give a reason when the cases are not related." });
  });
export type DecisionForm = z.infer<typeof decisionSchema>;

export const guardReasonSchema = z.string().trim().min(10, "Record why this cannot wait for coordination (at least 10 characters).");
