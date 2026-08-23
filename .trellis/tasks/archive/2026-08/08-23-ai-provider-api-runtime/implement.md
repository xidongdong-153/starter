# API Runtime 与控制面实现计划

1. [x] 读取 Child 1 contracts/schema/repository 和 API AI integration/system design spec。
2. [x] 盘点 `createAiRuntime`、`AiGateway`、`PiNativeStream`、configuration service/route 的调用关系。
3. [x] 实现固定 protocol -> lazy `pi-ai` API 的工厂和 model 转换。
4. [x] 将 runtime 改为 mutable Models；实现启动加载、坏配置隔离、热加载和卸载。
5. [x] 实现 URL outbound guard，覆盖 scheme、DNS/IP、redirect、timeout、body size 和 abort。
6. [x] 扩展 unified Provider DTO，增加 custom/built-in 区分和可编辑摘要。
7. [x] 实现 custom Provider route/service/OpenAPI、credential、check、state、models 和 delete 引用校验。
8. [x] 接入现有 model test、Agent executor、审计和模型可用性解析。
9. [x] 添加三协议 fake upstream、runtime restart、CAS、secret filter、SSRF 和 route 权限测试。
10. [x] 依次运行 API type-check、lint、format、targeted tests、db check。

风险点：`ai-runtime.ts` 是所有模型调用的共享入口；不得为 custom Provider 复制 Gateway/Agent stream。协议映射必须穷举，不能让数据库控制 import。
