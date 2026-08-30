# AI 基础服务支持图片附件输入

## Goal

API 的 `ai` 模块作为基础服务，支持在模型对话里传入图片附件。调用方先把图片上传到附件接口拿到 `attachmentId`，再在启动/追加请求里引用该 ID；模型收到的是带 image block 的多模态消息。参考 Pi 的实现：模型支持图片理解，附件独立于业务消息传输。

## 背景

当前整条输入链路是纯文本：

- `packages/contracts/src/ai.ts`：`startAgentRunSchema` / `steerAgentRunSchema` / `followUpAgentRunSchema` / `aiCompletionRequestSchema` 的输入都是 `z.string()`
- `apps/api/src/infra/ai/ai-gateway.types.ts`：`AiModelUserMessage.content` 只允许 text block
- `apps/api/src/infra/agent/agent-executor.ts`：`userMessage(text)` 构造纯字符串 content
- 模型目录已有 `supportsImageInput` 能力标记（`ai-runtime.ts` 从 provider catalog 推导），但没有任何输入路径消费它
- 底层依赖已就绪：pi-ai 的 `ImageContent = { type: "image", data: base64, mimeType }`，pi-agent-core 的 `prompt(input, images?)` 与 `steer/followUp(AgentMessage)` 都接受图片块

## Requirements

### R1 附件上传接口（新）

- 新增 AI 附件上传端点，multipart 表单上传单张图片
- 返回 `attachmentId`（UUID）及元信息（mimeType、size、宽高可选）
- MIME 白名单：`image/jpeg`、`image/png`、`image/webp`、`image/gif`
- 单张上限 5MB，超限或白名单外 MIME 返回 4xx
- 调用方：starter_user（会话登录）和 product_app（应用凭证）两种 principal 都能上传
- 附件归属上传者对应的 principal + session 范围，越权引用返回 4xx

### R2 附件存储（新）

- `ai_attachments` 表 + 独立存储目录（不放进现有 `files` 模块的 `FILES_DIR` 布局，不与通用文件混用）
- 归属模型：附件挂上传者 principal（starter_user 或 product_app）；上传时可选携带 `sessionId`，携带了的附件行对 session 外键级联
- completion 无 session 也可引用附件（只校验 principal 归属）
- 表记录：id、principal 归属字段、可选 sessionId（外键级联）、mimeType、size、存储相对路径、createdAt

### R3 四个业务接口支持附件引用

- `startRun`：请求新增可选 `attachmentIds`，与 `input` 文本一起构成首条 user message
- `followUp`：同上，追问时可带新图
- `steer`：同上，中途插入可带图
- `completion`：请求新增可选 `attachmentIds`，无状态引用
- 未传 `attachmentIds` 时协议与现状完全一致（纯文本路径零变化）
- `attachmentIds` 数量上限：单请求最多 4 张

### R4 模型能力硬校验

- 请求带附件且目标模型 `supportsImageInput === false` 时，启动即报错（新错误码 `AI_IMAGE_NOT_SUPPORTED`，4xx），不静默丢图、不降级
- 校验发生在 Run 启动 / steer / followUp / completion 入口，失败请求不产生任何副作用（不建 Run、不消费幂等键）
- 附件不存在、不属于当前 principal/session、MIME 超范围：同样入口报错

### R5 历史回放投影图片

- transcript 投影不再丢弃 user message 里的 image 块
- 会话历史接口对带图 user message 返回结构化块：text 块 + image 块（image 块含 `attachmentId`、可下载的 URL 引用，不含 base64 数据）
- 新增附件内容下载端点：按 `attachmentId` 返回图片字节流，校验 principal 归属

### R6 Web Chat 上传交互

- chat composer 增加图片上传入口（文件选择 + 粘贴 + 拖拽）
- 前端做类型/大小预校验，超限即时提示，不发请求
- 发送时携带已上传的 `attachmentId` 列表；消息气泡渲染缩略图，点击可放大查看
- 运行中（running）禁用上传发送

### R7 测试

- `apps/api/src/test/` 新增附件相关 smoke tests：上传白名单/大小校验、startRun 带图（mock provider 断言 image block 到达网关）、能力硬校验报错、越权引用报错、session 级联删除、历史回放投影
- 测试使用临时 SQLite 和临时附件目录，不读写开发数据库和真实附件目录

## 非目标（本次不做）

- PDF / 文本文件等非图片附件类型
- 图片服务端压缩、缩略图生成
- assistant 侧图片输出（模型生图）
- 附件跨 session 复用、附件管理后台页面
- 图片引用 URL 的 CDN/签名机制（当前同进程直读磁盘）

## Acceptance Criteria

- [ ] `POST` 附件上传接口：白名单内图片上传成功返回 attachmentId；5MB 以上或白名单外 MIME 返回 4xx；starter_user 与 product_app 两种 principal 均可用
- [ ] `startRun` / `followUp` / `steer` / `completion` 带 `attachmentIds` 时，网关收到的 user message 包含对应 image block（base64 + mimeType）
- [ ] 目标模型不支持图片输入时，四个接口均返回 `AI_IMAGE_NOT_SUPPORTED`，且不创建 Run、不消费幂等键
- [ ] 不带 `attachmentIds` 的请求行为与改造前一致（现有测试全部通过）
- [ ] 附件行带 principal 归属；携带 `sessionId` 上传的附件行有外键级联约束；越权引用（其他 principal 的附件）返回 4xx
- [ ] 会话历史接口返回带图 user message 的结构化块；附件下载端点按归属校验后返回图片字节
- [ ] Web chat 可选择/粘贴/拖拽图片，超限前端提示，发送后消息气泡显示缩略图
- [ ] `pnpm check`（类型、lint、format）与 `pnpm test` 全部通过

## 约束

- 附件数据不进 `snapshot_json` / event payload：事件和快照只存 `attachmentId` 引用，避免 JSON 膨胀
- 不改现有 `files` 模块
- 请求体大小：上传走 multipart，正文接口仍为 JSON（只传 ID 列表）
