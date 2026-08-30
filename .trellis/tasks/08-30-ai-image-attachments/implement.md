# 执行计划：AI 基础服务支持图片附件输入

按阶段推进，每个阶段结束跑一次对应验证。阶段间有依赖，顺序执行。

## 阶段 1：contracts 协议扩展

- [ ] `packages/contracts/src/ai.ts`：
  - 新增 `aiAttachmentSchema`（id / mimeType / size / sessionId / createdAt）
  - `startAgentRunSchema`、`steerAgentRunSchema`、`followUpAgentRunSchema`、completion 请求 schema 各加 `attachmentIds: z.array(uuidSchema).max(4).optional()`
  - `agentTranscriptUserMessageSchema` 加可选 `images` 数组（attachmentId / mimeType / url）
  - `ApiErrorCodes` 新增：`AI_ATTACHMENT_TOO_LARGE`、`AI_ATTACHMENT_TYPE_NOT_ALLOWED`、`AI_ATTACHMENT_NOT_FOUND`、`AI_IMAGE_NOT_SUPPORTED`、`AI_ATTACHMENT_COUNT_EXCEEDED`（错误码清单位置对齐现有 AI.* 命名）
- 验证：`pnpm --filter @starter/contracts check-types`（无独立 test 则跑根 `pnpm check-types`）

## 阶段 2：附件存储与上传接口

- [ ] `apps/api/src/modules/ai/ai.schema.ts`：新增 `ai_attachments` 表（见 design.md 第 4 节，含 principal 成对 CHECK 与 MIME CHECK）
- [ ] 生成 migration：`pnpm --filter @starter/api db:generate`，然后 `pnpm --filter @starter/api db:migrate`
- [ ] 环境变量：`AI_ATTACHMENTS_DIR`（`apps/api/.env.example` 补示例，`create-runtime.ts` 初始化独立 `LocalStorage` 实例；`createRuntime` 测试注入临时目录）
- [ ] 新建 `apps/api/src/modules/ai/attachment/`：`attachment.repository.ts`（增/查/删）、`attachment.service.ts`（MIME 白名单、5MB 上限、归属写入）、`attachment.route.ts`（`POST /ai/attachments` multipart + `GET /ai/attachments/{id}/content`）、`attachment.openapi.ts`
- [ ] 鉴权：复用 ai 模块现有 principal 解析（starter_user 会话与 product_app 凭证两条路径都接），对齐 `principal.ts` 的 `RuntimeAccessContext`
- [ ] 路由挂载：`ai.route.ts` 注册新路由
- [ ] 日志事件：`ai.attachment.upload.succeeded/failed`、`ai.attachment.download.denied`
- 验证：`pnpm test`（现有全过）+ 手动 curl 上传一张图、下载校验 Content-Type

## 阶段 3：输入管道（四接口接线）

- [ ] `apps/api/src/infra/ai/ai-gateway.types.ts`：新增 `AiModelImageBlock`，`AiModelUserMessage.content` 扩展
- [ ] `apps/api/src/infra/ai/ai-gateway.ts`：`toSdkMessage` 的 user 分支支持 image 块透传
- [ ] `apps/api/src/modules/ai/attachment/attachment-resolver.ts`：批量解析 + 归属校验 + 读字节
- [ ] `run.service.ts` `startRun`：幂等预检查之前做附件解析与 `supportsImageInput` 硬校验（查 `runtime.listModels(providerId)`）；user message 改为 text + image 块，顶层写 `attachmentIds`
- [ ] `agent-executor.ts`：`steer` / `followUp` 签名改为 `{ text, images }`，pending 队列存结构化消息，`agent.steer/followUp` 传完整 `AgentMessage`
- [ ] `run.service.ts` `steer` / `followUp` 入口同样走 resolver + 能力校验
- [ ] `completion.service.ts`：`toGatewayInput` 附加 image 块；`requireAllowedModel` 后做能力校验
- 验证：`pnpm test` + 新增 smoke test（见阶段 6）

## 阶段 4：投影与回放

- [ ] `session.presenter.ts`：user message 投影输出 `images` 数组（attachmentId + mimeType + url），base64 不出边界；`userContentToString` 行为不变
- [ ] transcript 接口契约对齐 contracts 的 `images` 字段
- 验证：transcript smoke test 断言带图消息的投影结构

## 阶段 5：Web Chat 前端

- [ ] `apps/web/lib/api/` 新增附件上传/下载 API 封装
- [ ] `chat-composer.tsx`：上传按钮 + `onPaste` + 拖拽；前端预校验（白名单 + 5MB + 最多 4 张）；待发送缩略图可删除
- [ ] 发送链路：`startRun` / `followUp` 请求带 `attachmentIds`；running 时禁用
- [ ] 消息气泡渲染 `images` 缩略图，点击放大
- 验证：`pnpm --filter @starter/web check-types` + 手动走一遍上传-发送-回放

## 阶段 6：测试

- [ ] `apps/api/src/test/` 新增 `ai-attachments.smoke.test.ts`：
  - 上传白名单内图片成功；5MB 超限与白名单外 MIME 报错
  - startRun 带 attachmentIds：mock 网关断言 user message 含 image 块（base64 + mimeType）
  - 模型不支持图片：`AI_IMAGE_NOT_SUPPORTED`，断言 Run 未创建、幂等键未消费
  - 越权引用（其他 principal 的附件）：`AI_ATTACHMENT_NOT_FOUND`
  - transcript 投影含 `images`，不含 base64
  - 独立临时 SQLite + 临时附件目录（对齐现有测试注入模式）
- [ ] 检查 multipart 请求体上限配置与 5MB 匹配，不足则调整
- 验证：`pnpm test`

## 收尾（对齐 .trellis/workflow.md Phase 3）

- [ ] 全量检查：`pnpm check`（类型、lint、format 三项全过）
- [ ] `pnpm test` 全过
- [ ] 更新 `apps/api/.env.example` 与相关 docs（如 AGENTS.md 的环境变量段落需要提 `AI_ATTACHMENTS_DIR`）
- [ ] `trellis-update-spec`：把附件归属模型、image 块管道约定写进 `.trellis/spec/` 对应包文档
- [ ] 向用户展示改动摘要，确认后提交（Conventional Commits，预计拆 `feat(contracts)` / `feat(api)` / `feat(web)` 或按用户偏好合并）

## 回滚点

- 阶段 1-2：附件表独立，`db:generate` 产物可单独回滚；contracts 字段全 optional，不破坏现有调用方
- 阶段 3：网关 image 分支只在块类型为 image 时命中，纯文本路径回归靠现有测试
- 阶段 5：前端不上传即不触发新链路

## 审查门

- 阶段 3 完成后（管道打通、测试过）向用户展示一次关键改动再进前端
- 提交前按惯例展示改动摘要获确认
