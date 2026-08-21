# Web Chat 作为 AI 产品接入验证

## Goal

在 `apps/web` 做一个最小 Chat 产品，用真实产品页面验证 Web 是否能通过公开 AI Agent Run API 接入和展示运行结果。Web 是验证用小产品，不复用 Admin 页面，也不承担 AI 管理控制面。

## Dependencies

- 前置任务：`08-21-ai-api-foundation-boundary`。
- 推荐在 `08-21-admin-ai-control-plane-only` 完成后再开始，以确认 Agent Sessions 已不再被误认为产品 UI；两个任务技术上都只依赖 API 协议。

## Requirements

- 在现有 `apps/web/app/(site)/` 下增加一个明确的 Chat 页面和进入入口。
- 使用 Web 自己的 API 领域函数和 `apps/web/lib/rpc.ts`/HTTP 边界，不导入 Admin API、Admin 组件或 Admin Harness reducer。
- 支持创建或复用一个 Agent Session，提交文本启动 Agent Run，并展示 assistant 文本增量。
- 对 HarnessEvent 做产品侧最小归并：至少处理开始、文本增量、完成、失败和取消；Tool/Thinking 可以先显示为状态或安全摘要，不渲染 Admin 时间线。
- 处理流中断、Run 轮询或 Transcript 恢复，不能把断流直接当成 Run 失败。
- 使用现有 Web 登录和 API 访问方式；未登录时显示明确的登录入口或错误状态。
- 不实现 React Flow、DAG、工作流编辑器、通用 Chat SDK 或产品业务 Tool。

## Acceptance Criteria

- [ ] Web 有独立 Chat 页面，页面入口和空状态可用。
- [ ] 登录用户可以提交消息并看到 Agent Run 的流式 assistant 输出和终态。
- [ ] API 流断开后页面可以查询 Run 状态或 Transcript，不能丢失已产生的结果。
- [ ] Web 没有导入 `apps/admin` 的源码、组件、API 函数或 Harness reducer。
- [ ] 页面使用公开 contracts/API 协议，不依赖 Admin 的时间线结构。
- [ ] Web 类型检查、Lint、Format 和构建通过。

## Evidence

- `apps/web/app/(site)/layout.tsx`
- `apps/web/app/(site)/_components/home/session-home.tsx`
- `apps/web/lib/rpc.ts`
- `apps/web/lib/http.ts`
- `apps/web/lib/auth-client.ts`
- `apps/web/package.json`
