# PRD: AI Tool / Prompt / Skills 设计与验证

## Goal

为 starter 的 AI 模块补齐三个能力层，并各做完整可验证功能（后端 + 前端）：

1. **测试用 Tool**：注册一批仅用于测试/验证的 AI 工具，验证已有的 tool 注册、编排、权限、审计全链路。
2. **Prompt 配置**：两层——系统提示词管理（全局默认 + 会话级覆盖）和用户 prompt 模板库（前端展开填充）。
3. **Skills**：数据库存储 + 渐进式披露（name+description 注入 system prompt，`read_skill` 工具按需加载完整内容）。

## 背景（已确认事实）

### starter 现状

- AI 模块已有完整 tool 基础设施：`ai-tool-registry.ts`（defineAiTool + createAiToolRegistry，Zod schema、Permission、timeout、名称/描述校验）、`ai-tool-orchestrator.ts`（多轮循环，最多 4 轮、单轮 8 调用、总时长 120s、上下文限制、权限检查、审计）、`ai-tool-schema.ts`（Zod → SDK Tool）、`ai-gateway.ts`（tool_use 处理、systemPrompt 透传参数）。
- **生产装配是空注册表**：`apps/api/src/bootstrap/create-runtime.ts` 中 `deps.aiTools ?? createAiToolRegistry([])`，没有任何业务工具注册，`defineAiTool` 只出现在 registry 本身和测试文件。
- 测试通过 `createTestApp` helper 注入 `deps.aiTools`（`apps/api/src/test/helpers.ts`）。
- **无 skills 机制**：全代码库无 skill 相关实现。
- **无 prompt 管理**：`AiGatewayInput.systemPrompt` 是可选透传参数，但 conversation 服务与 orchestrator 均未传 systemPrompt；无 prompt 存储、API、UI；模型测试接口 `/api/ai/test` 只收 prompt。
- 权限系统已有 `ai:config:manage` / `ai:config:read`，可复用于 prompt/skills 管理，不新增权限。
- 安全约定：prompt、response、工具参数/结果不入库、不进审计、不进日志（见 `.trellis/spec/api/backend/ai-integration-guidelines.md`）。
- admin 前端已有 AI 对话页 `AiConversations.tsx`（含硬编码 QuickStarters 快捷提示词）和设置页 `AiSettings.tsx`。

### pi 设计参考（已读 README 与源码）

- **Tool**：`packages/agent/src/harness/tools/` 每工具一个文件，工厂返回 `{ name, label, description, parameters(TypeBox), execute(toolCallId, input, signal, onUpdate, context) }`；支持 beforeToolCall/afterToolCall 钩子、sequential/parallel 执行模式。
- **Skills**：实现 Agent Skills 标准（agentskills.io/specification）。SKILL.md 目录 + frontmatter（name/description 必填）；系统提示只注入 name+description+location 的 XML 列表（渐进式披露），模型匹配后用 read 按需加载完整内容；发现位置：全局 `~/.pi/agent/skills`、项目 `.pi/skills`、`.agents/skills`；校验：name 1-64 小写+数字+连字符、description ≤1024，缺 description 不加载。
- **Prompt**：prompt templates 是用户侧 `/name` 展开的 Markdown 模板（frontmatter: description、argument-hint；支持 $1、$@、${1:-default} 参数）；pi 的 system prompt 本身编译在源码里，不用户可配置。

## 子任务映射

| 子任务 | 交付物 | 验证方式 |
|---|---|---|
| `08-16-ai-test-tools` | 测试工具集（env 开关注册）+ 全链路测试 | 单测 + dev 对话触发工具 |
| `08-16-ai-prompt-config` | system prompt 管理（API+表+会话注入）+ prompt 模板库（API+表+前端 QuickStarters 替换） | 单测 + API + admin 页面 |
| `08-16-ai-skills` | skills 表 + CRUD API + read_skill 工具 + system prompt 注入 + admin 管理页 | 单测 + API + admin 页面 + 对话验证 |

执行顺序：ai-test-tools → ai-prompt-config → ai-skills（无强依赖，按依赖深度排序；read_skill 工具在 ai-skills 子任务内实现）。

## 关键决策（已定）

- D-1: 测试 Tool 用 env 开关启用：`AI_TEST_TOOLS_ENABLED` 为 true 时注册测试工具，dev 默认开，生产不配置即关（仅测试装配和动态开关方案已否决）。
- D-2: Prompt 配置两个层面都做：系统提示词管理（全局默认 + 会话级覆盖，对话时注入）+ 用户 prompt 模板库（管理模板，前端展开填充）。
- D-3: Skills 数据库存储 + 渐进式披露：system prompt 注入 name+description，`read_skill` 工具按需加载完整内容（read_skill 是基础工具，随 ai-skills 子任务实现，不依赖测试开关）。
- D-4: 前端做完整：三个管理页面（测试工具状态页可选、system prompt 管理页、模板库管理页、skills 管理页）+ 对话页集成（模板库替换 QuickStarters）。

## 跨子任务验收标准（parent 级）

- P-1: 三个能力层都有自动化测试覆盖，`pnpm check`（types/lint/format）与 `pnpm test` 全绿。
- P-2: 测试 Tool 能在 dev 环境真实对话中触发并返回结果，`ai_tool_executions` 表可见工具执行记录（含失败/超时状态）。
- P-3: 系统提示词配置生效：配置后对话模型行为变化可观察；模板库在对话页可选择填充。
- P-4: Skills 描述注入生效，模型能感知技能列表；`read_skill` 能返回完整内容。
- P-5: 无违反现有安全约定：secret/prompt/工具参数不泄漏到日志、审计、客户端响应。
- P-6: 前端三个管理页可 CRUD，对话页模板集成可用。

## Out of Scope

- 生产级业务工具（本次只做测试工具）
- 多 Agent / 子 Agent 编排
- 工具市场 / 技能商店
- Skill 文件系统发现（不做 SKILL.md 目录扫描）
- 权限新增（复用 ai:config:manage / ai:config:read）

## 风险与边界

- read_skill 作为"基础工具"与"测试工具"的区分：read_skill 始终注册（有启用中的技能时），测试工具受 env 开关控制。
- system prompt 注入顺序：skills 描述列表拼在 systemPrompt 之前/之后需在设计中定（参考 pi：skills XML 块独立注入）。
- 模板库与 system prompt 的关系：模板是用户输入侧展开，不影响 system prompt 注入链路。
