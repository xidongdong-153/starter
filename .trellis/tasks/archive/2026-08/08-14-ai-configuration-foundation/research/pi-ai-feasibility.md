# `@earendil-works/pi-ai` 可行性记录

## 结论

`@earendil-works/pi-ai` 可以作为 `apps/api` 内部的模型调用适配依赖。项目仍需自己管理 Provider 配置、密钥保护、模型白名单、用户偏好和权限。第一版不持久化用量、账单或额度。

不让 Admin、Web、contracts 或数据库结构直接依赖该包的类型。API 内增加项目自己的稳定接口，负责把业务配置转换为 `pi-ai` 的 `Models`、Provider 和调用参数。

## 已核对信息

- 核对版本：`0.84.1`，npm `gitHead` 为 `53fa77ccd8a279eb87e92294ef3687b03ff80112`。
- `providers/all` 的 `builtinModels()` 注册 40 个文本 Provider；图片生成使用独立 `ImagesModels`，不在本任务中注册。
- License：MIT。
- 模块格式：ESM。
- Node 要求：`>=22.19.0`。
- 当前仓库只声明 `Node >=22`，正式接入时需要把运行环境要求收紧到 `>=22.19.0`。
- 推荐的新接口是 `createModels()` 或 `builtinModels()` 创建 `Models` collection，再调用 `models.getModel()`、`models.stream()` 和 `models.complete()`。
- 新代码不应使用 `@earendil-works/pi-ai/compat`；README 说明该兼容入口未来会移除。
- 包支持 OpenAI、Anthropic、Google、DeepSeek、OpenRouter、Azure OpenAI、Amazon Bedrock 和任意 OpenAI-compatible API。
- 包支持工具调用、Reasoning、图像输入、流事件、用量和成本结果。
- 包只收录支持 tool calling 的模型。
- `CredentialStore` 和 `ModelsStore` 可以由应用注入，默认实现只保存在内存。
- 自定义 Provider 可以配置 `baseUrl`、模型元数据、动态模型列表和 OpenAI compatibility 参数。
- 调用失败通常通过 `error` 流事件及 `stopReason: "error"` 或 `"aborted"` 返回，调用方不能只依赖 `try/catch`。

## 接入建议

- 用户已确认第一版覆盖固定版本的全部内置文本 Provider，因此使用 `providers/all` 的 `builtinModels()`；接受 API 依赖和构建体积增加，不注册 `ImagesModels`。
- 添加契约测试，断言项目 registry 的 Provider ID 与 `builtinModels().getProviders()` 完全一致。
- 锁定精确依赖版本；升级前重新核对 Provider ID、Store 接口和 stream event，并运行 adapter 契约测试。
- 用项目自己的 `AiGateway` 统一超时、取消、错误码、日志脱敏和安全 usage 摘要。
- 数据库中的密钥必须加密保存，解密主密钥来自 API 环境变量，不能写入同一数据库。
- 管理员只从内置或动态刷新 catalog 选择模型并维护白名单；任意模型录入不放入 MVP。真实 Provider 冒烟测试在本地凭据可用时执行，缺少外部凭据不阻塞 fake Provider 自动验证。

## 来源

- npm：https://www.npmjs.com/package/@earendil-works/pi-ai
- GitHub README：https://github.com/earendil-works/pi/tree/main/packages/ai
- npm Registry 命令：`npm view @earendil-works/pi-ai ...`
