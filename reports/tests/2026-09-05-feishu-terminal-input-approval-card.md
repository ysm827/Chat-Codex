# 测试报告：飞书终端输入审批卡与微信文字链路适配

## 测试目标

验证新版 Codex `writeStdin` 映射出的 `terminal_input` 审批，能在不改变普通审批行为的前提下：

- 像官方 Codex 核心审批交互一样展示“目标终端 + 精确输入”，而不是仅展示 protocol 原始
  `write_stdin --session-id …` 字符串；
- 在飞书私聊显示“本次允许 / 取消并中止任务”两个可点击按钮；
- 点击后经共享 Bridge 回传 `approve` 或 `cancel`；
- 在微信继续以完整、安全转义的文字提示交互，`/NO` 回传 `cancel`，`/P` 不会消耗审批；
- 保持普通飞书审批原有的“通过一次 / 本会话通过 / 拒绝”三按钮语义。

## 测试环境

- 日期：2026-09-05
- 分支/提交：`main` / `6316791`（工作区含本次未提交改动）
- Node.js 版本：`v24.14.0`
- 操作系统：`Darwin 25.6.0 arm64`
- Codex 参考源码：`references/openai-codex` / `ddf04ad26789d040f9ef6a96736f76602e35a6cc`
- 渠道：fake Feishu transport、fake Weixin HTTP API；未使用真实帐号或真实网络渠道

## 执行命令

```bash
npm run build && node --test dist/tests/unit/terminal-input-approval.test.js dist/tests/unit/app-server-mappers.test.js dist/tests/unit/approval-manager.test.js dist/tests/unit/channel-approval.test.js dist/tests/unit/bridge-delivery.test.js dist/tests/unit/bridge-formatters.test.js dist/tests/unit/feishu-approval-card.test.js dist/tests/unit/feishu-adapter.test.js dist/tests/unit/app-server-codex-adapter.test.js dist/tests/integration/bridge-mock.test.js dist/tests/integration/weixin-adapter-api.test.js dist/tests/integration/feishu-bridge.test.js && git diff --check
npm test
```

## 测试步骤

1. 用官方当前 Codex 源码中的 `write_stdin --session-id <id> <input>` 规范表示，验证中间件恢复 terminal id 和
   精确 input；解析失败时保留完整、已转义的原始请求作为展示回退，不伪造输入。
2. 用 `channelApprovalRequestFromPending()` 验证终端输入只映射 `approve`、`cancel`，并将执行环境、terminal id 和
   原始输入传给渠道；同时验证普通审批即使内部可 `cancel`，渠道卡仍只保留旧三按钮。
3. 用 `BridgeDelivery` 验证支持卡片动作的渠道会收到终端输入 card request；模拟卡片发送失败，验证仍回退为仅含
   `/OK`、`/NO` 的文字提示。
4. 用飞书卡片纯函数、adapter 和 fake transport 验证两按钮标题、正文中的执行环境/目标终端/带引号输入、
   `cancel` callback、取消后的
   红色结果卡与 toast；再验证把 `cancel` 注入普通审批卡会被拒绝。
5. 用 Bridge + FeishuAdapter + fake transport，分别点击 `approve`、`cancel`，验证共享审批流接收到相应决定，
   并渲染“已允许”或“已取消”的专用结果卡。
6. 用微信原始消息映射 + Bridge + fake `sendmessage` API，验证实际发送的 TEXT item 包含执行环境、目标终端和
   精确输入；`/P`
   被拒绝且审批仍 pending，随后 `/NO` 使 Codex adapter 收到 `cancel`。
7. 验证 `/status` 的待处理审批摘要使用同一组“终端 + 输入”语义，而不是重新显示成命令。
8. 运行全量 `npm test`，覆盖现有 app-server、Bridge、微信、飞书、状态、TUI 等回归，并检查 `git diff --check`。

## 实际结果

- TypeScript build 通过。
- 定向测试（含中间件、微信、飞书、卡片回退与 `/status`）：`258 passed / 0 failed`；`git diff --check` 通过。
- 全量测试：`533 passed / 0 failed`；`git diff --check` 通过。

关键验证结论：

- `ChannelApprovalDecision` 现可表达通用 `cancel`，但普通审批卡的 decision 映射仍严格为
  `approve`、`approve-session`、`deny`，没有行为扩张。
- `terminal_input` 飞书私聊卡只显示“本次允许 / 取消并中止任务”，不显示 `/P` 或“本会话通过”；完整终端输入
  内容按官方核心语义显示为“目标终端：42”“输入：`"confirm\\n"`”，并采用可见控制字符转义；普通命令
  审批则显示执行环境、原因、将执行的完整命令和工作目录。
- `environmentId` 不再在 app-server → 中间件转换时丢失；微信文字、飞书卡片、卡片失败文字回退和 `/status`
  待审批摘要都复用同一组审批语义字段。
- 飞书点击 `cancel` 经既有审批状态机原样送入 Codex adapter；结果卡和 toast 使用“取消终端输入”而非普通“拒绝”。
- 没有卡片能力的微信不会新增平台特例，继续通过共享文字提示、`/OK`、`/NO` 完成同一审批；本地 fake API 已验证
  真实 `sendmessage` TEXT payload 和入站消息映射后的 Bridge 行为。
- 飞书卡片发送失败、飞书群聊或其它未实现卡片能力的渠道仍会使用文字兜底，不丢失审批。

## 结论

通过。`writeStdin` 的中间件语义、官方核心等价的审批内容展示、微信文字渠道和飞书私聊两按钮卡片已完成本地
自动化实现；本次没有提交或推送代码。

## 遗留问题

- 尚未用真实微信私聊验证消息长度、`/OK`、`/NO`、`/P` 与登录态。
- 尚未用真实飞书私聊验证已订阅的 `card.action.trigger`、按钮 toast、结果卡和长 stdin 文本的平台限制。
- 若真实平台存在长文本限制，后续应在各自 adapter / renderer 层设计有序分段或安全降级，不能在 Bridge Core 静默省略输入。
- 下一项协议讨论仍是 `item/tool/requestUserInput.isBlocking`；模型适配按既定顺序在协议项讨论后单独进行。
