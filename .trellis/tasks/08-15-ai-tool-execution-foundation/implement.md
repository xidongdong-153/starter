# AI Tool calling 与执行循环执行计划

## 1. 基础类型与注册表

- [x] 定义内部 Tool definition/call/result、持久化 `AiToolActivity`、临时 `AiToolActivityEvent`、6 个封闭 `AiToolErrorCode`、封闭 `AiToolExecutionStatus`（running、succeeded、not_found、invalid_arguments、forbidden、failed、timed_out、cancelled、interrupted）和 3 个 generation budget code。
- [x] 创建 `ai-tool-registry.ts`，实现重复名称、schema、permission 和 timeout 校验。
- [x] 在 runtime 中装配空生产 registry，并允许测试依赖注入。

## 2. 执行循环

- [x] 创建 orchestrator，按 generation deadline 控制 `AiInvocationRunner` 多轮调用，并把每轮 nullable modelCallId 传给 tool audit。
- [x] 只在成功 completed/tool_use 后查 registry、Zod 校验和权限；每个未超量 call 在判断前先 best-effort begin 审计。
- [x] 并行执行同轮合法工具，保持结果顺序。
- [x] 实现未知工具、参数错误、权限拒绝和普通失败的安全 tool result。
- [x] 实现单工具 timeout、父请求取消、兄弟取消、进程 interrupted 恢复、总时限、每轮数量和轮数终态错误。
- [x] 在每次 Provider 请求前检查 50 条消息/100000 字符总预算，并分别限制 arguments/model-facing result 为 16000 字符、safeSummary 为 1000 字符。

- [x] 把脱敏 tool activity 和各轮 assistant 文本写入会话，把执行元数据写入审计；完整 arguments/result 只留在当前 generation 内存。

## 3. 测试

- [x] faux Provider 覆盖工具成功后第二轮文本完成。
- [x] handler 未执行断言覆盖 unknown、invalid、forbidden 和超量 call。
- [x] timeout/cancel 后 AbortSignal 已触发且不再调用下一轮模型。
- [x] 并行反向完成时结果仍按 call 顺序。
- [x] secret marker 不进入会话表中的 tool activity、公开 tool SSE event、日志和审计表；模型最终 assistant 文本可能复述 model-facing result，不以此作为脱敏断言。
- [x] tool begin/finalize 四类写失败不改变模型、handler、SSE 或 generation 结果，日志只含白名单字段。
- [x] 默认 `createRuntime()` 的工具 registry 为空。

## 4. 检查与回滚

运行全仓类型、Lint、Format、测试和构建。工具任务不注册生产工具；出现问题时可以让会话 orchestrator 传空 tools，文本聊天仍可工作。

验证记录：

- `apps/api/src/test/ai-tools.test.ts` 13 个用例：空 registry、成功回填第二轮、unknown/invalid/forbidden 不执行 handler、toolcall 后 Provider 失败不执行、并行顺序、timeout+兄弟取消、动态 Context 超限、9 个调用超量、4 轮上限、stop 取消、审计写失败隔离、总时限、超大 arguments sentinel、handler 普通失败。
- API 全量 21 files / 192 tests 通过；Admin 95 tests 通过（单文件并行模式；全量并发下 `authorization-audit` loading 测试偶发超时为既有 flaky）。
- `pnpm lint`、`pnpm format:check`、`pnpm check-types`、`pnpm build`、`db:check`、`git diff --check` 全部通过。
