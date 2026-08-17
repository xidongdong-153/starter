# Admin AI 模块验证报告

## 环境

- 启动命令：`pnpm run dev`
- Admin：`http://localhost:2333`
- API：`http://localhost:7788`
- 健康检查：`GET /health` 返回 `200`，响应包含 `ok: true`、`data` 和 `meta`。
- 浏览器：ego-browser task spaces `5`、`6`，已使用现有登录态访问；`6` 用于复核快捷模板按 Enter 的输入状态。
- 当前账号具备 Admin AI 管理权限。

## 自动化基线

| 命令 | 结果 |
| --- | --- |
| `pnpm check-types` | 通过，6 个 workspace 检查成功 |
| `pnpm lint` | 通过，6 个 workspace 检查成功 |
| `pnpm format:check` | 通过，6 个 workspace 检查成功 |
| `pnpm test` | 通过，Admin 15 个测试文件、96 个测试；API 25 个测试文件、214 个测试 |

测试输出包含已有的 Ant Design 弃用提示、jsdom 能力提示和 Node `localStorage` 实验性提示，没有失败用例。收尾阶段再次运行 `pnpm check` 和 `pnpm test`，结果仍然通过。

## 页面验证

7 个页面都能打开，页面加载请求返回成功，未发现 Runtime exception 或浏览器 error log：

| 页面 | 结果 | 主要请求 |
| --- | --- | --- |
| `/ai/chat` | 通过 | 会话、模型、偏好、快捷模板、会话详情 |
| `/ai/system-prompts` | 通过，发现问题 F-5 | 系统提示词、全局默认 |
| `/ai/prompt-templates` | 通过 | Prompt 模板 |
| `/ai/skills` | 通过，发现问题 F-1、F-2、F-5 | Skills 列表和技能详情 |
| `/ai/settings` | 通过 | 用户模型、偏好、模型测试 SSE |
| `/ai/providers` | 通过读取和筛选 | Provider、管理员模型目录 |
| `/ai/usage` | 通过 | 用量列表、调用详情 |

中文和英文页面的可见文案均能切换，静态扫描 Admin AI 页面得到的 220 个文案 key 只有 `ai.skills.descriptionRequired` 缺失，见 F-2。切换到英文后 `document.documentElement.lang` 仍为 `zh-CN`，见 F-4。

窄视口 `390 x 844` 下，7 个页面的文档宽度都等于视口宽度，没有检测到页面级横向溢出。AI 会话移动端抽屉可以打开和关闭。

## 操作验证

- 系统提示词：新建、空表单校验、编辑、启停、设置全局默认、取消删除和确认删除均已验证。测试记录已删除，原有全局默认已恢复。
- Prompt 模板：新建、空表单校验、编辑入口、启停、排序字段、删除确认和对话页快捷模板填充均已验证。测试记录已删除。
- Skills：新建、详情加载、编辑、内容更新、对话中调用 `read_skill`、删除确认和删除均已验证。测试记录已删除。
- AI 会话：新建、快捷模板填充、点击发送、Enter 发送、流式文本、工具活动、重试、停止、超时错误、搜索、移动抽屉和删除均已验证。临时会话已删除。
- 模型测试：发送和重试均返回流式回答；响应为 `200` SSE。个人默认模型曾清除后恢复为原值。
- 用量审计：Provider 筛选、清除筛选、分页、详情抽屉和含工具执行记录的详情均已验证。列表和详情没有显示 Prompt 正文、模型回答或凭据。
- Provider 和模型目录：Provider 搜索、配置抽屉、模型 Tab、模型搜索、能力筛选、全选当前筛选和清空选择均已验证。没有保存凭据、启停 Provider、刷新目录或提交白名单，避免改变现有配置或触发未授权的外部 Provider 请求。

## API 验证

### 成功响应

以下已登录请求返回 `200`，均包含 `{ ok: true, data, meta }`：

- `/api/ai/models`
- `/api/ai/preferences`
- `/api/ai/conversations?page=1&pageSize=50`
- `/api/ai/system-prompts`
- `/api/ai/settings/system-prompt`
- `/api/ai/prompt-templates`
- `/api/ai/skills`
- `/api/ai/admin/providers`
- `/api/ai/admin/models`
- `/api/ai/usage/calls?page=1&pageSize=20`

Provider 目录返回 40 项，管理员模型目录返回 1220 项，用户可用模型返回 1 项。Skills 列表不含 `content` 字段。

### 请求方法和刷新行为

- 页面读取请求使用 `GET`，包含 `credentials: include`；普通 JSON 成功响应都带 `ok`、`data`、`meta`。
- 系统提示词使用 `POST /api/ai/system-prompts`、`PUT /api/ai/system-prompts/:id`、`DELETE /api/ai/system-prompts/:id`，设置全局默认使用 `PUT /api/ai/settings/system-prompt`；操作成功后列表或全局默认查询重新请求并显示新数据。
- Prompt 模板使用 `POST /api/ai/prompt-templates`、`PUT /api/ai/prompt-templates/:id`、`DELETE /api/ai/prompt-templates/:id`；操作成功后列表重新请求并显示新数据。
- Skills 使用 `POST /api/ai/skills`、`PUT /api/ai/skills/:id`、`DELETE /api/ai/skills/:id`，编辑前使用 `GET /api/ai/skills/:id`；操作成功后列表重新请求并显示新数据。
- 个人默认模型使用 `PUT /api/ai/preferences`；清除后生效模型变为无默认，恢复后回到原个人默认。
- 会话创建和删除使用 `POST /api/ai/conversations`、`DELETE /api/ai/conversations/:id`；发送、重试和停止分别使用 `POST /api/ai/conversations/:id/messages`、`POST /api/ai/conversations/:id/retry`、`POST /api/ai/conversations/:id/generations/:generationId/stop`，流结束后重新请求会话列表和详情。
- Provider 和管理员模型目录使用 `GET`；本次没有提交凭据、Provider 状态、模型目录或白名单变更。
- 用量筛选的 Provider、结果、时间范围和 request ID 参数通过直接 API 请求验证，均返回 `200`；页面实际点击验证了 Provider 筛选和清除筛选。

### 权限和错误响应

- 未带登录态访问 Provider、系统提示词和 Skills 列表：均返回 `401 AUTH.UNAUTHENTICATED`。
- 空模型测试请求：返回 `400 COMMON.INVALID_REQUEST`。
- 合法格式但不存在的用量记录和会话：均返回 `404 COMMON.NOT_FOUND`。
- 现有 API smoke tests 已覆盖无权限 `403`；本次浏览器使用 Admin 账号，没有另建普通账号做页面级 403 手测。
- `pnpm test` 已通过 API 失败响应、内部错误和权限分支；本次浏览器没有注入 5xx 响应。

### 流式请求

直接读取 SSE 帧名得到以下结果，未把响应正文写入报告：

- `/api/ai/test`：`POST 200`，事件顺序为 `start → text_delta → done`。
- `/api/ai/conversations/:id/messages`：`POST 200`，事件顺序为 `start → text_delta → completed`。
- 工具超时会话：`POST 200`，事件顺序为 `start → text_delta → tool_activity → error`。
- `/api/ai/conversations/:id/retry`：`POST 200`，页面显示重试生成。
- `/api/ai/conversations/:id/generations/:generationId/stop`：返回 `202`，页面显示已停止和 `AI.REQUEST_ABORTED`。

## 发现的问题

### F-1 Skills 的描述字段把页面说明当成了字段标题

- 严重程度：中
- 页面：`/ai/skills`
- 复现：打开技能列表或新建技能表单。
- 实际结果：表格“描述”列和表单描述字段的标题显示整段页面说明，而不是简短的“描述”；窄视口下标题被截断。
- 预期结果：页面说明和字段标题使用两个独立文案，字段标题显示“描述”或 `Description`。
- 代码位置：`apps/admin/src/features/ai/pages/Skills.tsx` 中表格列和 `Form.Item` 都使用 `t('ai.skills.description')`；该 key 在 `apps/admin/src/i18n/locales/zh.ts`、`en.ts` 中是页面说明。

### F-2 Skills 描述必填校验显示原始 i18n key

- 严重程度：中
- 页面：`/ai/skills`
- 复现：点击“新建技能”，不填写任何字段，点击“保存”。
- 实际结果：描述字段下显示 `ai.skills.descriptionRequired`，中文和英文都没有翻译。
- 预期结果：显示对应语言的必填提示。
- 代码位置：`apps/admin/src/features/ai/pages/Skills.tsx` 使用了 `t('ai.skills.descriptionRequired')`，但两个语言文件都没有这个 key。

### F-3 快捷模板选择后按 Enter 发送会在输入框留下内容

- 严重程度：中
- 页面：`/ai/chat`
- 复现：在空会话中点击一个快捷模板，随后按 Enter；消息可以发送。
- 实际结果：浏览器复现后，`textarea` 仍保留模板内容，并在内容前出现换行；字数统计仍显示非零值。点击“发送”按钮发送同类内容后，`textarea` 会清空。重新打开页面后直接手动输入文本再按 Enter，输入框可以清空，因此当前问题集中在快捷模板选择后的键盘发送路径。
- 预期结果：快捷模板填充后按 Enter 与点击“发送”行为一致，发送成功后清空输入框，不追加换行。
- 代码位置：`apps/admin/src/features/ai/pages/AiConversations.tsx` 的 `handlePromptSelect`、`handleInputKeyDown` 和 `sendMessage`。

### F-4 切换到英文后 HTML `lang` 属性仍是 `zh-CN`

- 严重程度：低
- 页面：所有 Admin 页面
- 复现：点击顶部“切换语言”切到英文，检查 `document.documentElement.lang`。
- 实际结果：页面可见文案已切换为英文，但 `lang` 仍为 `zh-CN`。
- 预期结果：英文界面同步设置 `lang="en"` 或项目约定的英文区域值，切回中文时恢复中文值。
- 影响：辅助技术和浏览器语言判断可能使用错误语言。

### F-5 系统提示词和 Skills 的删除图标按钮没有可访问名称

- 严重程度：低
- 页面：`/ai/system-prompts`、`/ai/skills`
- 复现：查看两个列表的操作列并使用无障碍树观察删除按钮。
- 实际结果：删除按钮只有垃圾桶图标，没有 `aria-label` 或 Tooltip；语义树中显示为无名称按钮。
- 预期结果：按钮有明确的 `aria-label`，并在桌面端提供 Tooltip。
- 代码位置：`apps/admin/src/features/ai/pages/SystemPrompts.tsx`、`apps/admin/src/features/ai/pages/Skills.tsx`。

### F-6 用量审计表格行只能用鼠标点击打开详情

- 严重程度：低
- 页面：`/ai/usage`
- 复现：查看用量表格的行交互；当前实现通过 `onRow` 添加 `onClick`，没有键盘事件、`tabIndex` 或可聚焦的详情按钮。
- 实际结果：键盘用户无法把焦点移到数据行并打开详情抽屉。
- 预期结果：提供可聚焦的详情操作，或为行补充符合无障碍要求的键盘交互和语义。
- 代码位置：`apps/admin/src/features/ai/pages/AiUsageAudit.tsx` 的 `Table` `onRow` 配置。

## 响应式和错误分支边界

- `390 x 844` 下 7 个页面均未产生页面级横向溢出；已实际打开 AI 会话移动抽屉、桌面 Provider 配置抽屉和用量详情抽屉。
- 表格内容通过组件内部滚动或截断保持页面宽度；没有单独验证每个表格操作列在所有横向滚动位置的键盘操作。
- 页面级 403、5xx 注入、保存失败后保留表单内容、详情请求失败和剪贴板成功提示没有在本次浏览器会话中完成。

## 未完成或受环境限制的项目

- Provider 凭据保存、认证检查、启停、刷新目录和白名单提交没有执行，原因是这些操作会改变现有本地配置或触发外部 Provider 请求。
- 没有可用的第二个普通账号做浏览器级 403 页面验证；API smoke tests 已覆盖 403，Admin 当前账号的受保护页面读取和管理入口已验证。
- 复制到系统剪贴板的成功提示没有在 ego-browser 中确认，浏览器 task space 的剪贴板权限未授权；复制按钮仍可点击，未将其判定为产品缺陷。
- 测试期间保留的原有记录（例如既有系统提示词、Prompt 模板、Skill 和历史会话）没有删除；本任务新建的临时记录和会话已清理。

## 证据位置

- 自动化基线：本文件“自动化基线”表和本任务执行记录。
- 页面与请求：本文件“页面验证”“API 验证”“流式请求”部分；浏览器 task spaces `5`、`6`，页面路径见各节。
- 缺陷定位：F-1 至 F-6 的页面路径、复现步骤和代码位置。
- 运行校验：`python3 ./.trellis/scripts/task.py validate 08-17-verify-admin-ai-module`。

## 工作区注意事项

`apps/web/next-env.d.ts` 在本任务开始前后存在一处与本任务无关的已有修改，内容是 Next.js 路由类型引用从 `./.next/types/routes.d.ts` 变为 `./.next/dev/types/routes.d.ts`。未修改或回滚该文件。

工作区还存在未跟踪的 `.trellis/tasks/08-17-refactor-api-ai-module-structure/`，与本任务无关，未读取、修改或清理。
