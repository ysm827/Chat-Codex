# Codex `writeStdin` 审批的渠道适配设计

状态：中间件、微信文字链路和飞书私聊终端输入专用卡片均已实现，并有本地自动化覆盖；真实微信/飞书
账号验证仍待补测。

更新：2026-09-05

## 1. 这份文档回答什么

新版 Codex app-server 会以
`item/commandExecution/requestApproval { kind: "writeStdin" }` 请求向**已经运行的终端**输入内容。
中间件已经把它映射为本地 `terminal_input`，并固定其聊天语义：

- `/OK`：本次允许，回传 app-server `accept`；
- `/NO`：取消输入并中止当前任务，回传 app-server `cancel`；
- `/P`：不支持，不能冒充“本会话允许”。

本文件只说明这套已完成的中间件语义如何投递、展示和回调到微信、飞书；不讨论其它新版协议项、模型、
Scheduled tasks 或新的聊天产品功能。

先给结论：

| 渠道 | 当前是否可正确使用 | 本轮实现状态 | 原因 |
| --- | --- | --- | --- |
| 微信私聊 | **是，文字交互可用** | 无需新增渠道代码；本地 adapter/Bridge fake API 回归已完成 | 微信 adapter 只有文本收发，没有卡片动作接口；已有 `/OK`、`/NO` 文本命令可完成审批 |
| 飞书私聊 | **是，点击卡片与文字兜底均可用** | 两按钮卡片已实现并完成 fake transport 回归 | `terminal_input` 仅显示 `approve` / `cancel`，不会误用普通三按钮卡片 |
| 飞书群聊 | **是，文字兜底可用** | 本轮不做卡片 | 当前审批卡明确只支持私聊，群聊仍受既有群审批权限校验 |

这里的“可用”指中间件会显示内容并能正确回传决定；不等于已完成真实微信或真实飞书帐号的人工测试。

## 2. 已完成的共同中间件边界

当前实现位于：

- `src/codex/app-server/approval-handler.ts`：识别 `params.kind === "writeStdin"`；
- `src/approvals/approval-policy.ts`：保存实际允许的 decision，且把文字 `/NO` 的本地 `deny`
  规范化为 stdin 所需的 `cancel`；
- `src/approvals/approval-manager.ts`：生成“终端输入（不会启动新命令）”提示；
- `src/bridge/approval-resolution.ts`：统一校验、回传和结果文字；
- `src/protocol/channel.ts` 与 `src/approvals/channel-approval.ts`：通用卡片动作增加 `cancel`，但普通审批
  仍只映射既有的 `approve`、`approve-session`、`deny`；
- `src/bridge/delivery.ts`：由 adapter 的 `sendApprovalRequest()` capability 决定是否发送卡片；无卡片能力或
  卡片发送失败时仍回退到共享文字提示。

文字提示和飞书卡片不再把 `write_stdin --session-id …` 当作一条“要执行的命令”来展示。中间件按官方当前
`shlex::try_join` 的四参数表示恢复**目标终端**和**精确输入**：例如
`write_stdin --session-id 42 'confirm\n'` 会显示为“目标终端：42”“输入：`"confirm\n"`”。这与官方
Codex TUI 的 terminal id + `Input` 核心语义一致，且不会调用通用 `truncateForChannel()`。

输入采用带引号的 JSON 风格可见表示，换行、制表符、NUL 和其它控制字符不会在渠道中变成不可见内容或额外
聊天指令。若未来 app-server 的字符串不能安全恢复为这两个字段，渠道会展示完整、已转义的“原始终端输入
请求”；只有连 `command` 都缺失时才会自动 `cancel`，不会创建让用户盲批的 pending approval。

如果 app-server 没有给出可安全展示的 `command`，中间件会立即回传 `cancel`，不会创建让用户盲批的
pending approval。

当前中间件测试报告已留存：
[`reports/tests/2026-09-05-codex-writestdin-middleware-adaptation.md`](../reports/tests/2026-09-05-codex-writestdin-middleware-adaptation.md)。
其中记录了 fake app-server、Bridge/mock channel、文字投递回退和全量 `npm test` 的结果：
**517 passed / 0 failed**。

本轮渠道卡片的实现与测试记录见
[`reports/tests/2026-09-05-feishu-terminal-input-approval-card.md`](../reports/tests/2026-09-05-feishu-terminal-input-approval-card.md)。
该报告已追加本轮“核心审批内容展示”回归：定向 **258 passed / 0 failed**，全量
**533 passed / 0 failed**。

## 3. 微信：已有文字链路，不应强行做卡片

### 3.1 当前实际链路

```text
Codex writeStdin server request
  -> BridgeDelivery.formatForChannel()
  -> ChannelRegistry.sendText()
  -> WeixinAdapter.sendText()
  -> Weixin sendmessage 的 TEXT item

用户发送 /OK 或 /NO
  -> Weixin getupdates
  -> weixinMessageToChannelMessage()
  -> CommandRouter
  -> ApprovalManager / AppServerCodexAdapter
  -> accept 或 cancel JSON-RPC response
```

`WeixinAdapter` 实现了通用 `sendText()` 和文本入站映射，但没有实现
`sendApprovalRequest()` 或 `onApprovalAction()`；这不是缺失，而是当前微信渠道没有被设计为卡片审批
渠道。`sendText()` 会把审批提示原样写入 `TEXT` item，入站文字又会以稳定的 `routeKey` 回到 Bridge。

因此，微信不需要在 `Bridge` 中加 `if channel === "weixin"` 特例，也不需要新增按钮 API：

1. 用户看见“目标终端”和“输入”的完整可读内容；
2. 用户回复 `/OK`，中间件发送 `accept`；
3. 用户回复 `/NO`，命令路由先产生本地 `deny`，中间件再仅对 `terminal_input` 规范化为 `cancel`；
4. 用户回复 `/P`，审批保持 pending，并收到“不支持本会话通过”的说明。

微信当前能力声明 `group: false`。即使底层消息映射能识别 `group_id`，`ChannelRegistry` 也会按 capability
拒绝该会话形态；本项只承诺已支持的微信私聊。

### 3.2 微信本地链路已补测，真实验证仍待用户登录

| 层级 | 要验证的内容 |
| --- | --- |
| 本地 adapter + Bridge 集成 | **已覆盖**：用微信原始消息映射、Bridge 和 fake `sendmessage` API 验证完整已转义输入、`/P` 被拒绝且审批保持 pending、`/NO` 回传 `cancel` |
| 真实微信私聊 | **待补测**：用户登录后检查消息可见、`/OK` 可继续、`/NO` 可中止、`/P` 不会被错误批准；结果另写中文测试报告 |

当前 `WeixinAdapter.sendText()` 是一次发送完整文本，代码没有截断或自动分段。真实渠道测试还要确认平台对很长
stdin 内容的限制；若平台拒绝超长消息，后续应在**微信 adapter 自身**增加有序分段发送，绝不能静默省略
输入内容或在 Bridge Core 写微信专用分支。

## 4. 飞书：私聊两按钮卡片已实现，文字兜底仍保留

### 4.1 当前实际链路

飞书已有私聊卡片基础设施：

```text
普通审批
  -> ChannelRegistry.sendApprovalRequest()
  -> FeishuApprovalCardController.send()
  -> interactive card

用户点击
  -> card.action.trigger WebSocket event
  -> FeishuApprovalCardController.handle()
  -> ChannelRegistry.onApprovalAction()
  -> Bridge.handleChannelApprovalAction()
  -> Codex resolve + toast / 已处理卡片
```

通用 `ChannelApprovalDecision` 现已包含：

```ts
"approve" | "approve-session" | "deny" | "cancel"
```

`channelApprovalRequestFromPending()` 会按审批类型收敛可见按钮：`terminal_input` 只会得到
`approve` / `cancel`，普通审批仍只会得到原来的 `approve` / `approve-session` / `deny`。因此新增 union
不会给旧审批增加“取消”按钮。

`BridgeDelivery.sendApprovalUntilDelivered()` 不再按 `terminal_input` 绕过卡片；只要 adapter 声明
`sendApprovalRequest()`，就把已收敛的通用 request 交给它。飞书私聊 renderer 因而显示两按钮卡片；微信
没有这项 capability，飞书群聊也不支持私聊卡片，二者自然使用共享文字兜底。这不是以 `channelId` 写死的
特例。

飞书卡片还只支持私聊；controller 会校验 `open_message_id`、`open_chat_id`、操作者 `open_id`、
卡片记录、route、发起人和去重键。后续扩展不能跳过这些校验。

### 4.2 已完成的飞书卡片改造

改造应停留在通用审批协议和飞书 renderer 边界，不让 Codex 或 Bridge Core 依赖飞书 SDK：

| 位置 | 已完成的改动 | 保留约束 |
| --- | --- | --- |
| `src/protocol/channel.ts` | 将 `cancel` 加入 `ChannelApprovalDecision`，同步 action/result 类型和判定函数 | 这是通用“渠道可点击审批决定”，不是飞书专属类型 |
| `src/approvals/channel-approval.ts` | 对 `terminal_input` 只映射 `approve`、`cancel`；普通审批继续只映射既有 `approve`、`approve-session`、`deny` | 不能因扩展 union 让普通审批莫名多出取消按钮 |
| `src/codex/app-server/terminal-input-approval.ts` | 只解码官方当前 `write_stdin --session-id <id> <input>` 四参数表示，输出 terminal id 和精确输入 | 不能把无法确认的未来表示伪造成已解析输入；必须回退原始请求 |
| `src/approvals/channel-approval.ts` | 把执行环境、terminal id 和原始输入传给通用渠道请求；原 protocol command 只作为解析失败回退 | 不可截断或丢失输入内容 |
| `src/bridge/delivery.ts` | 在通用 card request 已支持 stdin 后，移除仅针对 `terminal_input` 的卡片跳过；保留卡片失败后的文字回退 | 不按 `channelId` 判断，仍由 adapter 是否实现 card capability 决定 |
| `src/channels/feishu/feishu-approval-card.ts` | 为 `terminal_input` 显示“终端输入（不会启动新命令）”、执行环境、目标终端和带引号的输入；按钮为“本次允许”“取消并中止任务” | 不出现 `/P` 或“本会话通过” |
| 同一 renderer | `cancel` 成功后的 toast/结果卡片应写“已取消本次终端输入，Codex 将中止当前任务” | 不能错误写成普通“已拒绝” |
| controller / Bridge action | 允许并原样传递 card action 的 `cancel`，再由既有 `resolveApproval()` 回传 app-server `cancel` | 不把 card 的 `cancel` 改写为 `deny` |

实际卡片内容如下：

```text
Codex 请求终端输入审批
类型：终端输入（不会启动新命令）
执行环境：remote
目标终端：42
输入："confirm\\n"
原因：程序正在等待确认

[本次允许] [取消并中止任务]
也可直接发送 /OK 或 /NO。
```

`approvalId` 不是卡片 action value，也不能拿来回传 JSON-RPC。卡片只携带本地 `approvalKey` 和实际可用的
`decision`；server request id 的关联仍由已完成的 app-server adapter 保存。

### 4.3 保留的回退与边界

- interactive 卡片发送失败时，沿用 `BridgeDelivery` 的文字提示回退；不丢失审批。
- 飞书群聊继续走文字提示，不新增群聊按钮；现有群审批权限和发起人校验保持不变。
- 卡片点击发生在进程重启后、卡片记录不存在或身份校验失败时，返回 toast；用户仍可发送 `/OK`、`/NO`。
- 卡片正文必须展示完整的已转义输入。当前没有卡片正文自动分段策略；真实飞书测试需要确认很长文本的
  平台限制，若有必要在飞书 renderer / adapter 层做有序分段或安全降级，不能在 Core 中省略内容。

## 5. 自动化与真实测试

本轮已覆盖普通飞书私聊卡片、身份/route 校验、重复点击、卡片发送失败回退，以及
`writeStdin` 的终端输入专用卡片：

| 测试层 | 场景 |
| --- | --- |
| card 纯函数 | **已覆盖**：`terminal_input` 只有“本次允许 / 取消并中止任务”；无 `/P`；完整输入控制字符正确转义；普通 command 卡继续保持三按钮 |
| callback 解析 | **已覆盖**：`cancel` 可解析；被注入到普通卡片的 `cancel` 会被 Bridge 拒绝 |
| controller / adapter | **已覆盖**：私聊发卡、操作者/聊天室/approvalKey 校验、重复点击、未知卡片、interactive 发送失败文字回退；终端输入重试提示只列 `/OK`、`/NO` |
| Bridge 集成 | **已覆盖**：fake Feishu transport 依次点击 `approve`、`cancel`，验证共享 Bridge 收到对应决定与专用结果卡；app-server 的 request-id → `accept` / `cancel` 映射由既有 fake app-server 测试覆盖 |
| 微信文字回归 | **已覆盖**：Weixin message mapping + Bridge + fake `sendmessage` API 验证 `/P`、`/NO` 语义和实际 TEXT item 内容 |
| 真实飞书私聊 | **待补测**：已订阅 `card.action.trigger` 的应用上验证两个按钮、toast、结果卡，以及文本兜底 |

渠道代码落地后，按 `docs/development-and-test.zh-CN.md` 新建一份中文测试报告，例如：
`reports/tests/YYYY-MM-DD-feishu-terminal-input-approval-card.md`。真实微信或真实飞书测试完成时，也要在
对应报告中追加环境、账号会话形态和结果，不能用 mock 结果冒充真实渠道验证。

## 6. 推荐推进顺序

1. 使用现有微信、飞书登录态分别做一次真实私聊验证，并把结果追加到对应中文测试报告。
2. 若真实渠道发现超长文本上限，再分别在各 adapter / renderer 层设计分段投递，不提前在 Core 截断。
3. 渠道项完成后，回到协议项 2：`isBlocking` 用户输入；模型适配仍在全部协议项讨论后单独进行。

## 7. 与现有文档的关系

- 协议语义、当前完成进度：
  [`2026-09-05-codex-ddf04ad26789-app-server-protocol-compatibility.zh-CN.md`](2026-09-05-codex-ddf04ad26789-app-server-protocol-compatibility.zh-CN.md)。
- 已实现的普通飞书私聊卡片与安全校验：
  [`feishu-direct-approval-card-design.zh-CN.md`](feishu-direct-approval-card-design.zh-CN.md)。
- 本项中间件测试记录：
  [`reports/tests/2026-09-05-codex-writestdin-middleware-adaptation.md`](../reports/tests/2026-09-05-codex-writestdin-middleware-adaptation.md)。
- 本项飞书卡片与微信文字链路测试记录：
  [`reports/tests/2026-09-05-feishu-terminal-input-approval-card.md`](../reports/tests/2026-09-05-feishu-terminal-input-approval-card.md)。
