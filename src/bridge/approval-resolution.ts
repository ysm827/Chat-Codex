import type { ApprovalManager } from "../approvals/approval-manager.js";
import type { ApprovalDecision, PendingApproval } from "../approvals/types.js";
import { normalizeApprovalDecision, unsupportedApprovalDecisionText } from "../approvals/approval-policy.js";
import type { CodexAdapter } from "../codex/types.js";
import { formatApprovalDecision } from "./formatters.js";

export interface ApprovalResolutionOptions {
  approvals: ApprovalManager;
  codex: CodexAdapter;
}

export type ApprovalResolutionResult =
  | {
    ok: true;
    text: string;
    pending: PendingApproval;
    decision: ApprovalDecision;
  }
  | {
    ok: false;
    text: string;
  };

export async function resolveApproval(
  options: ApprovalResolutionOptions,
  input: {
    approvalKey: string;
    routeKey: string;
    decision: ApprovalDecision;
  },
): Promise<ApprovalResolutionResult> {
  try {
    const current = options.approvals.get(input.approvalKey);
    if (!current) throw new Error(`未找到审批请求: ${input.approvalKey}`);
    if (current.routeKey !== input.routeKey) throw new Error(`审批请求 ${input.approvalKey} 不属于当前会话`);
    const decision = normalizeApprovalDecision(current, input.decision);
    if (!decision) throw new Error(unsupportedApprovalDecisionText(current, input.decision));
    const pending = options.approvals.decide(input.approvalKey, input.routeKey, decision);
    await options.codex.resolveApproval?.(pending.adapterApprovalId ?? pending.approvalKey, decision);
    return {
      ok: true,
      text: approvalResolutionText(pending, decision),
      pending,
      decision,
    };
  } catch (error) {
    return {
      ok: false,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}

function approvalResolutionText(pending: PendingApproval, decision: ApprovalDecision): string {
  if (pending.kind === "terminal_input" && decision === "cancel") {
    return "审批已处理: 已取消本次终端输入，Codex 将中止当前任务。";
  }
  return `审批已处理: ${formatApprovalDecision(decision)}`;
}
