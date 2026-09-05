import type { PendingApproval } from "./types.js";
import { availableApprovalDecisions, formatApprovalCommandForDisplay } from "./approval-policy.js";
import type { ChannelApprovalDecision, ChannelApprovalRequest } from "../protocol/channel.js";

const LEGACY_CHANNEL_APPROVAL_DECISIONS: ChannelApprovalDecision[] = [
  "approve",
  "approve-session",
  "deny",
];
const TERMINAL_INPUT_CHANNEL_APPROVAL_DECISIONS: ChannelApprovalDecision[] = ["approve", "cancel"];

export function channelApprovalRequestFromPending(pending: PendingApproval): ChannelApprovalRequest {
  const allowed = new Set(availableApprovalDecisions(pending));
  const supported = pending.kind === "terminal_input"
    ? TERMINAL_INPUT_CHANNEL_APPROVAL_DECISIONS
    : LEGACY_CHANNEL_APPROVAL_DECISIONS;
  const availableDecisions = supported.filter((decision) => allowed.has(decision));
  return {
    approvalKey: pending.approvalKey,
    routeKey: pending.routeKey,
    requestedBy: pending.requestedBy,
    kind: pending.kind,
    sessionId: pending.sessionId,
    turnId: pending.turnId,
    itemId: pending.itemId,
    command: formatApprovalCommandForDisplay(pending),
    environmentId: pending.environmentId,
    cwd: pending.cwd,
    reason: pending.reason,
    terminalId: pending.terminalId,
    terminalInput: pending.terminalInput,
    risk: pending.risk,
    availableDecisions,
  };
}
