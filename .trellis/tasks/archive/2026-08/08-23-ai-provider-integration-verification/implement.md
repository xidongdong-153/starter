# 跨层验证计划

1. [x] 读取父任务 PRD/design/implement、四个子任务 PRD 和 AI cross-layer thinking guide。
2. [x] 建立 contracts -> OpenAPI -> RPC -> Admin query/page 的字段核对表。
3. [x] 使用 fake upstream 验证三协议模型测试 SSE、Agent Run native stream 和 usage audit。
4. [x] 验证 Provider 状态机、config revision、CAS、重启恢复和热加载。
5. [x] 验证模型白名单、全局默认、Agent model resolve 和删除引用。
6. [x] 验证权限、secret filtering、URL guard、redirect、timeout、abort 和非法模型。
7. [x] 运行 API/Admin targeted tests，修复问题时回派对应子任务。
8. [x] 执行仓库级 type-check、lint、format、test、build、db check。
9. [x] 输出集成验证报告，记录通过项、残余风险和不能在本地验证的真实上游项。

风险点：跨层测试不能只断言页面显示或 fake provider 返回；必须验证同一 `providerId + modelId` 穿过数据库、runtime、Gateway、Agent executor 和审计记录。
