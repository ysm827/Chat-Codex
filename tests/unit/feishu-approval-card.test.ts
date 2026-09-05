import test from "node:test";
import assert from "node:assert/strict";
import {
  FEISHU_APPROVAL_CARD_ACTION,
  buildFeishuApprovalCard,
  feishuApprovalCardCallback,
  parseFeishuApprovalCardAction,
} from "../../src/channels/feishu/feishu-approval-card.js";
import type { ChannelApprovalRequest } from "../../src/protocol/channel.js";
import { sampleFeishuCardActionEvent } from "../helpers/feishu-fakes.js";

function approvalRequest(): ChannelApprovalRequest {
  return {
    approvalKey: "a001",
    routeKey: "feishu:work:direct:oc_user",
    requestedBy: "ou_user",
    kind: "command",
    sessionId: "session-1234567890",
    turnId: "turn-1234567890",
    itemId: "item-1",
    command: "npm test",
    environmentId: "remote",
    cwd: "/workspace/project",
    reason: "运行测试",
    risk: "low",
    availableDecisions: ["approve", "approve-session", "deny"],
  };
}

test("Feishu approval card presents only supported decisions with stable action values", () => {
  const card = buildFeishuApprovalCard(approvalRequest()) as {
    elements: Array<Record<string, unknown>>;
  };
  const actionElement = card.elements.find((element) => element.tag === "action") as {
    actions: Array<{ text: { content: string }; value: Record<string, unknown> }>;
  };

  assert.deepEqual(actionElement.actions.map((action) => action.text.content), ["通过一次", "本会话通过", "拒绝"]);
  assert.deepEqual(actionElement.actions.map((action) => action.value), [
    { action: FEISHU_APPROVAL_CARD_ACTION, approvalKey: "a001", decision: "approve" },
    { action: FEISHU_APPROVAL_CARD_ACTION, approvalKey: "a001", decision: "approve-session" },
    { action: FEISHU_APPROVAL_CARD_ACTION, approvalKey: "a001", decision: "deny" },
  ]);
});

test("Feishu terminal-input approval card presents allow and cancel without session approval", () => {
  const card = buildFeishuApprovalCard(terminalInputApprovalRequest()) as {
    header: { title: { content: string } };
    elements: Array<{
      tag?: string;
      text?: { content?: string };
      elements?: Array<{ content?: string }>;
      actions?: Array<{ text: { content: string }; value: Record<string, unknown> }>;
    }>;
  };
  const details = card.elements.find((element) => element.tag === "div")?.text?.content;
  const actionElement = card.elements.find((element) => element.tag === "action");
  const note = card.elements.find((element) => element.tag === "note")?.elements?.[0]?.content;

  assert.equal(card.header.title.content, "Codex 请求终端输入审批");
  assert.match(details ?? "", /类型：终端输入（不会启动新命令）/);
  assert.match(details ?? "", /执行环境：remote/);
  assert.match(details ?? "", /目标终端：42/);
  assert.match(details ?? "", /输入："confirm\\n"/);
  assert.doesNotMatch(details ?? "", /write_stdin/);
  assert.deepEqual(actionElement?.actions?.map((action) => action.text.content), ["本次允许", "取消并中止任务"]);
  assert.deepEqual(actionElement?.actions?.map((action) => action.value), [
    { action: FEISHU_APPROVAL_CARD_ACTION, approvalKey: "a001", decision: "approve" },
    { action: FEISHU_APPROVAL_CARD_ACTION, approvalKey: "a001", decision: "cancel" },
  ]);
  assert.equal(note, "也可直接发送 /OK 或 /NO。");
  assert.doesNotMatch(JSON.stringify(card), /\/P/);
});

test("Feishu approval card renders approval metadata as plain text", () => {
  const card = buildFeishuApprovalCard(approvalRequest()) as {
    elements: Array<{
      tag?: string;
      text?: { tag?: string; content?: string };
    }>;
  };
  const details = card.elements.find((element) => element.tag === "div")?.text;

  assert.deepEqual(details, {
    tag: "plain_text",
    content: [
      "类型：command",
      "执行环境：remote",
      "原因：运行测试",
      "将执行的命令：npm test",
      "CWD：/workspace/project",
      "会话：session-1234",
      "Turn：turn-1234567",
      "风险：low",
    ].join("\n"),
  });
});

test("Feishu approval action parser accepts context ids and user_id fallback", () => {
  const action = parseFeishuApprovalCardAction(sampleFeishuCardActionEvent({
    operator: { open_id: undefined, user_id: "user_123", name: "测试用户" },
    action: {
      value: JSON.stringify({
        action: FEISHU_APPROVAL_CARD_ACTION,
        approvalKey: "a002",
        decision: "approve-session",
      }),
    },
  }), "cli_1234567890abcdef");

  assert.deepEqual(action, {
    messageId: "om_reply",
    chatId: "oc_direct",
    operatorId: "user_123",
    operatorName: "测试用户",
    approvalKey: "a002",
    decision: "approve-session",
  });
});

test("Feishu approval action parser accepts terminal-input cancel", () => {
  const action = parseFeishuApprovalCardAction(sampleFeishuCardActionEvent({
    action: {
      value: {
        action: FEISHU_APPROVAL_CARD_ACTION,
        approvalKey: "a001",
        decision: "cancel",
      },
    },
  }));

  assert.equal(action?.decision, "cancel");
});

test("Feishu approval action parser rejects foreign apps and malformed decisions", () => {
  assert.equal(parseFeishuApprovalCardAction(sampleFeishuCardActionEvent({
    app_id: "cli_other",
  }), "cli_1234567890abcdef"), undefined);
  assert.equal(parseFeishuApprovalCardAction(sampleFeishuCardActionEvent({
    action: {
      value: {
        action: FEISHU_APPROVAL_CARD_ACTION,
        approvalKey: "a001",
        decision: "not-a-decision",
      },
    },
  })), undefined);
});

test("Feishu approval callback replaces a resolved card and keeps rejected cards actionable", () => {
  const resolved = feishuApprovalCardCallback(approvalRequest(), {
    status: "resolved",
    text: "审批已处理: 已通过",
    decision: "approve",
  });
  const rejected = feishuApprovalCardCallback(approvalRequest(), {
    status: "rejected",
    text: "该审批已处理或不可用。",
  });

  assert.equal(resolved.toast.type, "success");
  assert.equal(resolved.card?.type, "raw");
  assert.equal(rejected.toast.type, "warning");
  assert.equal(rejected.card, undefined);
});

test("Feishu terminal-input cancel callback renders a cancelled result card", () => {
  const callback = feishuApprovalCardCallback(terminalInputApprovalRequest(), {
    status: "resolved",
    text: "审批已处理: 已取消本次终端输入，Codex 将中止当前任务。",
    decision: "cancel",
  });
  const card = callback.card?.data as {
    header?: { title?: { content?: string }; template?: string };
  } | undefined;

  assert.equal(callback.toast.type, "success");
  assert.equal(card?.header?.title?.content, "Codex 终端输入已取消");
  assert.equal(card?.header?.template, "red");
});

function terminalInputApprovalRequest(): ChannelApprovalRequest {
  return {
    ...approvalRequest(),
    kind: "terminal_input",
    command: "write_stdin --session-id 42 'confirm\n'",
    terminalId: "42",
    terminalInput: "confirm\n",
    availableDecisions: ["approve", "cancel"],
  };
}
