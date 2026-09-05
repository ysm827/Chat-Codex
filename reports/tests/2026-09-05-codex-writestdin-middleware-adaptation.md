# 测试报告：Codex `writeStdin` 审批中间件适配

## 测试目标

验证新版 Codex app-server 的
`item/commandExecution/requestApproval { kind: "writeStdin" }` 能在 Chat-Codex 中间件内被正确识别为
“向已运行终端输入”，而不是新的命令执行审批；并验证安全展示、审批决定映射和渠道文字兜底。

## 测试环境

- 日期：2026-09-05
- 分支/提交：`main` / `dafa189`（工作区含本次未提交改动）
- Node.js 版本：`v24.14.0`
- 操作系统：`Darwin 25.6.0 arm64`
- Codex 参考源码：`references/openai-codex` / `ddf04ad26789d040f9ef6a96736f76602e35a6cc`
- 渠道：mock channel；app-server 使用项目内 fake process

## 执行命令

```bash
npm run build && node --test --test-name-pattern='protocol inventory' dist/tests/unit/app-server-mappers.test.js
npm run build && node --test --test-reporter=dot dist/tests/unit/*.test.js dist/tests/integration/*.test.js && git diff --check
npm test
```

## 测试步骤

1. 用 app-server mapper 单测发送 `kind: "writeStdin"`、独立的 `approvalId`、JSON-RPC request id 和
   `availableDecisions: ["accept", "cancel"]`，验证本地类型、回传键和决定集。
2. 用 fake app-server 触发 stdin 审批，验证 `/NO` 最终回传协议决定 `cancel`；验证缺少可展示 `command`
   时中间件自动取消，而不创建可盲批的 pending approval。
3. 用 Bridge + mock channel 验证提示明确写“终端输入（不会启动新命令）”，控制字符可见转义，只有 `/OK`、`/NO`；
   `/P` 被拒绝且不消耗 pending approval。
4. 用具备旧审批卡能力的 mock channel 验证 `terminal_input` 不会误走旧三按钮卡，改为共享文字提示。
5. 运行最新本地 Codex schema 的 protocol inventory，确认新增 9 个 ClientRequest 和 11 个 notification
   均已被分类；分类不等同于这些后续功能已经实现。
6. 运行完整 `npm test` 和差异格式检查，确认不回归现有 Bridge、微信、飞书、TUI 和 app-server 测试。

## 实际结果

- TypeScript build 通过。
- `writeStdin` 相关 mapper、ApprovalManager、Bridge delivery、Bridge mock 和 app-server fake-process 覆盖通过。
- protocol inventory 通过；仅登记新增方法的安全分类，未提前实现其它协议项。
- 全量测试结果：`517 passed / 0 failed`。
- `git diff --check` 通过。

关键验证结论：

- `params.kind === "writeStdin"` 映射为本地 `terminal_input`；普通 command 的原有 `/OK /P /NO` 行为保持不变。
- app-server JSON-RPC request id 仍是回传关联键；不把不透明的 `approvalId` 当成回传 id。
- 当前 Codex 源码实际允许的 stdin 决定仅为 `accept` / `cancel`：`/OK` 回传 `accept`，`/NO` 回传 `cancel`，`/P` 不可用。
- 显示文本说明不会启动新命令，并对换行、制表符和其它控制字符做可见转义。
- 缺失可安全展示输入内容时，中间件主动回传 `cancel`，避免用户盲批。
- 飞书私聊暂时绕过旧三按钮审批卡，微信、飞书私聊和飞书群聊均使用正确的共享文字兜底。

## 结论

通过。协议项 1 的中间件语义、文本交互与 mock 自动化覆盖已完成；没有把原 command item 提前标记为结束，后续仍以 app-server 的真实 item/turn 生命周期事件为准。

## 遗留问题

- 尚未改造飞书私聊专用卡片；下一轮如决定实现，应只提供“本次允许”和“取消并中止任务”两个按钮。
- 本次没有真实微信/飞书发送测试。按项目规范，待用户登录微信或提供可用飞书测试环境后补测真实渠道；这不影响已完成的中间件 mock 验证。
- `isBlocking`、分页历史、async Agent 消息、`thread/reverted` 和媒体生成失败等其它协议项未在本轮实现。
