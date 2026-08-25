-- AI 模块数据整理：中等清理 + 种子配置
-- 执行前已备份：apps/api/data/backup-2026-08-25/
-- 用户（喜东东）: 019fdcc9-8d58-715f-81be-2960aaf03537

-- ============ 清理 ============

-- 调用与工具执行审计数据
DELETE FROM ai_tool_executions;
DELETE FROM ai_model_calls;

-- AI 会话与运行记录
DELETE FROM ai_agent_runs;
DELETE FROM ai_agent_sessions;

-- 旧 Agent（王八一）
DELETE FROM ai_agent_definitions;

-- 解除 ai_settings 对旧系统提示词的引用
UPDATE ai_settings
SET global_system_prompt_id = NULL,
    updated_by = '019fdcc9-8d58-715f-81be-2960aaf03537',
    updated_at = 1787639559099;

-- 测试系统提示词 / 快捷模板 / 技能
DELETE FROM ai_system_prompts WHERE name LIKE 'verify-%';
DELETE FROM ai_prompt_templates;
DELETE FROM ai_skills;

-- 审计日志
DELETE FROM ai_app_credential_audit_events;
DELETE FROM authorization_audit_events;

-- Better Auth 登录会话（所有用户重新登录）
DELETE FROM session;

-- ============ 配置：系统提示词 ============

INSERT INTO ai_system_prompts (id, name, content, enabled, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-200a26935ea4',
  'general-assistant',
  '你是 starter 项目的通用助手，面向开发者解答这个仓库的问题。

仓库是 pnpm monorepo：apps/web（公开站，端口 4399）、apps/admin（管理后台，端口 2333）、apps/api（Hono API，端口 7788）；packages/contracts 放前后端共用的 Zod schema 与类型，packages/theme 放 Rose Pine 主题变量。

回答规则：
- 先给结论，再给依据；涉及命令、路径、文件时给出可直接使用的原文。
- 默认用中文回答，代码、命令、标识符保留原文。
- 被问到项目结构、命令、配置、数据库等细节时，先读取 <available_skills> 中对应的技能再回答。
- 信息不足时直接说明缺什么，不编造。',
  1,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

INSERT INTO ai_system_prompts (id, name, content, enabled, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-200b209e035e',
  'code-assistant',
  '你是 starter 项目的代码助手，负责代码审查、调试和给出修复建议。

项目规范：
- TypeScript 严格模式（noUncheckedIndexedAccess），改动必须通过 pnpm check（类型、ESLint、Prettier 三项）。
- 每处改动只服务当前任务，不做顺手重构；原有问题只指出不修改。
- 提交信息用 Conventional Commits 短格式，scope 用 apps/ 或 packages/ 下的目录名（web、admin、api、contracts、theme、eslint-config）。

审查输出格式，每个问题包含：
- 文件路径与行号，或出问题的代码片段原文
- 问题是什么、为什么是问题
- 最小改动建议，给出可直接落地的代码

规则：
- 结论要具体，不写建议优化、考虑改进这类空话。
- 不确定的行为先读源码确认，不猜。
- 被问到项目结构、SQLite、文案规范时，先读取 <available_skills> 中对应的技能再回答。',
  1,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

-- ============ 配置：快捷模板 ============

INSERT INTO ai_prompt_templates (id, name, description, content, enabled, sort_order, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-201169510d8e',
  'summarize-conversation',
  '总结当前对话的要点、结论与待办',
  '请总结当前对话：1) 讨论的问题；2) 已确认的关键结论（含路径、命令、参数）；3) 未完成或待办事项。按这三部分输出，没有的写无。',
  1,
  1,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

INSERT INTO ai_prompt_templates (id, name, description, content, enabled, sort_order, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-2012ebc633bd',
  'translate-zh-en',
  '中文与英文互译，保留代码和术语',
  '把下面的文字翻译成目标语言：代码、命令、文件路径、包名保持原文不翻译；术语优先使用业内常见译法，不做生硬直译；中文翻译成英文时用自然的地道表达。',
  1,
  2,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

INSERT INTO ai_prompt_templates (id, name, description, content, enabled, sort_order, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-20134edbec90',
  'explain-code',
  '解释一段代码的职责、关键逻辑与易错边界',
  '解释下面的代码：1) 这段代码做什么，输入和输出是什么；2) 关键逻辑在哪些行；3) 容易出错的边界。用中文回答，代码片段保持原文。',
  1,
  3,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

INSERT INTO ai_prompt_templates (id, name, description, content, enabled, sort_order, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-2014df9efb7c',
  'write-sql',
  '根据需求编写 SQLite SQL，带注释说明',
  '根据下面的需求编写 SQLite SQL：1) 给出完整可执行的语句；2) 每条语句上方用中文注释说明作用；3) 表结构不确定时先询问，不要假设列名。',
  1,
  4,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

-- ============ 配置：技能 ============

INSERT INTO ai_skills (id, name, description, content, enabled, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-200cdcdade86',
  'starter-codebase-map',
  'starter 仓库结构、常用命令、环境变量与开发约定',
  '条件：被问到项目结构、命令、配置、端口、环境变量时，先读本节再回答。

仓库结构：
- apps/web：公开站点，Next.js，默认端口 4399
- apps/admin：管理后台，Vite + React SPA，默认端口 2333
- apps/api：API 服务，Hono + Node.js，默认端口 7788，健康检查 /health
- packages/contracts：前后端共用的 Zod schema 与 TypeScript 类型
- packages/theme：Rose Pine 主题变量（Tailwind CSS + Ant Design token）

常用命令：
- pnpm dev：同时启动所有应用
- pnpm dev:web / dev:admin / dev:api：单独启动对应应用
- pnpm check：依次运行类型、Lint、Format 检查
- pnpm test：运行 API smoke tests（apps/api/src/test/）
- pnpm --filter @starter/api db:generate / db:migrate / db:check：Drizzle migration 相关

环境变量：
- 首次使用从 .env.example 复制为 .env.development
- BETTER_AUTH_SECRET 必须改为 32 字符以上的随机值
- DATABASE_PATH 默认 ./data/app.db，FILES_DIR 默认 ./data/files

开发约定：
- API 业务代码按模块放在 apps/api/src/modules/，执行路径 route → service → repository
- 自有 JSON 接口统一返回 { ok, data, meta } 或 { ok, error, meta }
- 共享依赖版本维护在 pnpm-workspace.yaml 的 catalog 中
- 删数据库数据前先备份数据库文件再执行',
  1,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

INSERT INTO ai_skills (id, name, description, content, enabled, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-200d0b48f503',
  'sqlite-query-guide',
  'SQLite 查询规范：表结构、时间列、外键与 Drizzle 约定',
  '条件：编写或调试 SQLite SQL、排查 Drizzle 查询问题、改数据库数据时，先读本节。

数据库文件：
- 主库 apps/api/data/app.db（业务数据）
- 会话库 apps/api/data/agent-sessions.db（Pi 会话存储，一般不要直接改）

写 SQL 的规则：
- 先确认表结构再写语句；不知道列名时看 apps/api/src/modules/ai/ai.schema.ts 或执行 PRAGMA table_info(表名)
- 删除数据前先备份：sqlite3 data/app.db ".backup backup/app.db"
- AI 模块表之间有关联：删 ai_agent_definitions 前先清 ai_agent_runs、ai_agent_sessions
- 时间列 createdAt / updatedAt 存毫秒时间戳（integer，mode timestamp_ms）
- 布尔列是 integer，0 / 1

Drizzle 约定：
- schema 定义在 apps/api/src/modules/*/ 下的 schema 文件里
- 改 schema 后手动执行 db:generate 再 db:migrate，API 启动不会自动迁移',
  1,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

INSERT INTO ai_skills (id, name, description, content, enabled, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-200e1a0b6863',
  'plain-chinese-docs',
  '中文文案规范：文档、注释、提示词、报错与说明语',
  '条件：编写或修改中文文案（README、文档、注释、提示词、报错信息、业务说明语）时，先读本节。

规则：
- 只写具体事实：处理什么事、文件在哪、敲什么命令、传什么参数、有什么容易出错的边界
- 不用八股词：赋能、抓手、沉淀、闭环、对齐、颗粒度、底层逻辑、全链路、痛点、体感等，想用时改成具体的主谓宾
- 不用翻译腔：不说消费了 B，说调用了 B；不说对外暴露接口，说导出了接口
- 不用客服腔：不写建议您、希望对您有所帮助；称呼用你
- 不写 emoji
- 报错和提示要给出路：读者卡住时知道下一步做什么
- 长度跟风险走：容易出错的地方讲透，不会错的地方一句带过',
  1,
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

-- ============ 配置：Agent ============

INSERT INTO ai_agent_definitions (id, name, description, status, revision, config_json, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-200ffc721c33',
  'general-assistant',
  '通用助手：日常问答与项目咨询',
  'enabled',
  1,
  '{"schemaVersion":2,"model":{"providerId":"xdd","modelId":"LongCat-2.0"},"systemPromptId":"01a0379e-b1f8-7cd8-86b1-200a26935ea4","skillIds":["01a0379e-b1f8-7cd8-86b1-200cdcdade86","01a0379e-b1f8-7cd8-86b1-200e1a0b6863"],"toolRefs":[{"name":"read_skill","version":"1.0.0"}],"thinkingLevel":"medium","maxTurns":8}',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

INSERT INTO ai_agent_definitions (id, name, description, status, revision, config_json, created_by, updated_by, created_at, updated_at)
VALUES (
  '01a0379e-b1f8-7cd8-86b1-2010a492efb4',
  'code-assistant',
  '代码助手：代码审查与调试',
  'enabled',
  1,
  '{"schemaVersion":2,"model":{"providerId":"xdd","modelId":"LongCat-2.0"},"systemPromptId":"01a0379e-b1f8-7cd8-86b1-200b209e035e","skillIds":["01a0379e-b1f8-7cd8-86b1-200cdcdade86","01a0379e-b1f8-7cd8-86b1-200d0b48f503"],"toolRefs":[{"name":"read_skill","version":"1.0.0"}],"thinkingLevel":"high","maxTurns":12}',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  '019fdcc9-8d58-715f-81be-2960aaf03537',
  1787639559099,
  1787639559099
);

-- 全局默认系统提示词指向通用助手
UPDATE ai_settings
SET global_system_prompt_id = '01a0379e-b1f8-7cd8-86b1-200a26935ea4',
    updated_by = '019fdcc9-8d58-715f-81be-2960aaf03537',
    updated_at = 1787639559099;