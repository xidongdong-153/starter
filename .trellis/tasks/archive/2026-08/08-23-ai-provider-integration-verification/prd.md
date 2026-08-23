# 跨层集成验证

## Goal

验证自定义 Provider 从 contracts、数据库、API runtime、Admin 控制面到模型测试、Agent Run 和审计的完整数据流，并发现跨子任务契约不一致。

## Scope

- 跨层 smoke/integration tests 和静态边界检查。
- 三类协议成功/失败路径。
- Provider 生命周期、模型白名单、默认模型、Agent 引用、删除和权限。
- Secret/SSRF/redirect/超时/模型 schema 安全验证。
- 不在本任务新增临时业务实现；问题回派对应子任务。

## Acceptance Criteria

- [x] 三类协议各自完成模型测试 SSE 成功路径。
- [x] 三类协议各自完成 Agent Run 成功路径并写入 `ai_model_calls`。
- [x] auth、timeout、abort、upstream、invalid model 错误均使用稳定项目错误码。
- [x] Provider create -> check -> enable -> model allowlist -> default -> test/run -> disable -> delete 全流程可验证。
- [x] 删除被 Agent 引用时失败；解除引用后清理白名单和默认模型。
- [x] API 重启后定义、凭据状态和模型目录可恢复。
- [x] 普通用户不可见 disabled Provider/模型，Admin 权限边界正确。
- [x] secret 不出现在响应、日志、snapshot、transcript、SSE 和测试输出。
- [x] SSRF、危险 scheme、重定向到危险地址和超大响应均被拒绝。
- [x] 全仓库 quality gate 和 build 通过。

## Dependencies

- 必须等待 Child 1、Child 2、Child 3 完成。
- 发现 contracts/API/UI 字段不一致时，先回派对应子任务再继续验证。

## Verification

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```
