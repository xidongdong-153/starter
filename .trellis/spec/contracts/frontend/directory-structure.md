# Contracts 的前端目录边界

前端消费统一从 `@starter/contracts` 根入口导入：

```ts
import type { PublicProfile } from "@starter/contracts";
```

契约代码只放 `packages/contracts/src/index.ts`。具体请求函数仍位于 `apps/admin/src/api/` 或 `apps/web/lib/api/`，组件和页面不能把 API URL、fetch 或浏览器状态移进 contracts。

如果未来拆分契约模块，根入口必须继续重导出现有公共类型，避免应用直接依赖内部文件路径。
