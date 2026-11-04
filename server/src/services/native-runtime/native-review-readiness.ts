import type { NativeEvidenceAssessment } from "./evidence-classifier.js";

type ReviewAssessment = Pick<NativeEvidenceAssessment,
  "reportedDisposition" | "contractRevisionMatches" | "objectiveClaimSatisfied" |
  "hasBlockingRemainingWork" | "hasFailedVerification" | "attentionRequests"> & {
    criterionAssessments: ReadonlyArray<{ claimStatus: unknown }>;
  };

/** This existing review path can close its issue; input decisions use native interactions. */
export function nativeReviewReportProblem(assessment: ReviewAssessment): { code: string; message: string } | null {
  const requests = assessment.attentionRequests;
  if (!Array.isArray(requests) || requests.length === 0 || requests.some(request => request.kind !== "review")) {
    return { code: "native_attention_requires_native_workflow", message: "Use request_human_input for a concrete input or reserved human decision, the existing approval path for governed actions, and native delegation for another agent's work. These are not task-completion approvals. Keep the task with its worker and wait on the saved request or dependency." };
  }
  if (Array.isArray(assessment.criterionAssessments) && assessment.criterionAssessments.some(criterion => criterion.claimStatus === "unknown")) {
    return { code: "native_review_outcome_unknown", message: "The submitted outcome is unknown. Preserve the source worker, history, and any existing hold. Reconcile the saved outcome before deciding whether work can resume; do not replay a tool action or ask a reviewer to approve completion as a substitute for reconciliation." };
  }
  if (assessment.reportedDisposition !== "needs_review" || assessment.contractRevisionMatches !== true ||
      assessment.objectiveClaimSatisfied !== true || assessment.hasFailedVerification !== false ||
      !Array.isArray(assessment.criterionAssessments) || assessment.criterionAssessments.length === 0 ||
      assessment.criterionAssessments.some(criterion => criterion.claimStatus !== "satisfied")) {
    return { code: "native_review_delivery_unfinished", message: "The submitted delivery is unfinished or unknown. Complete its work and checks, or report the concrete blocker. For a completed bounded delivery within ongoing work, use the existing child-task review and keep the parent unfinished. For a proposal or input decision, use request_human_input; acceptance of input must not close unfinished work." };
  }
  if (assessment.hasBlockingRemainingWork) {
    return { code: "native_review_delivery_unfinished", message: "Completion review includes unfinished work. Continue it or report its blocker. Submit a genuinely complete bounded child for review while its parent remains owned, or use request_human_input for a real proposal or reserved decision. Do not relabel unfinished work as satisfied or ask for whole-task completion acceptance." };
  }
  if (requests.some(request => request.ownerClass === "agent" && !request.targetAgentId) ||
      requests.some(request => !["human", "agent"].includes(request.ownerClass))) {
    return { code: "native_review_receiver_required", message: "Identify the actual receiver from the accepted task context. Use ownerClass agent and the named agent's exact targetAgentId for a native manager or specialist. Do not infer identity from a title, substitute the responsible human user, or substitute a native agent for an external receiving owner." };
  }
  return null;
}
