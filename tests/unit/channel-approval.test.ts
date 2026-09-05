import test from "node:test";
import assert from "node:assert/strict";
import { channelApprovalRequestFromPending } from "../../src/approvals/channel-approval.js";
import type { PendingApproval } from "../../src/approvals/types.js";

test("terminal-input channel approvals expose only approve and cancel while preserving core display fields", () => {
  const request = channelApprovalRequestFromPending(pending({
    kind: "terminal_input",
    command: "write_stdin --session-id 42 'confirm\n\t\u0000'",
    environmentId: "remote",
    terminalId: "42",
    terminalInput: "confirm\n\t\u0000",
    availableDecisions: ["approve", "cancel"],
  }));

  assert.deepEqual(request.availableDecisions, ["approve", "cancel"]);
  assert.equal(request.command, "write_stdin --session-id 42 'confirm\\n\\t\\x00'");
  assert.equal(request.environmentId, "remote");
  assert.equal(request.terminalId, "42");
  assert.equal(request.terminalInput, "confirm\n\t\u0000");
});

test("ordinary channel approvals retain the legacy three decisions even when internal cancel exists", () => {
  const request = channelApprovalRequestFromPending(pending({
    availableDecisions: ["approve", "approve-session", "deny", "cancel"],
  }));

  assert.deepEqual(request.availableDecisions, ["approve", "approve-session", "deny"]);
});

test("ordinary channel approvals keep the legacy three-decision fallback for old servers", () => {
  const request = channelApprovalRequestFromPending(pending({ availableDecisions: undefined }));

  assert.deepEqual(request.availableDecisions, ["approve", "approve-session", "deny"]);
});

function pending(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    approvalKey: "a001",
    routeKey: "feishu:work:direct:oc_user",
    requestedBy: "ou_user",
    kind: "command",
    sessionId: "session-1",
    turnId: "turn-1",
    itemId: "item-1",
    command: "npm test",
    requestedAt: "2026-09-05T00:00:00.000Z",
    status: "pending",
    ...overrides,
  };
}
