# RPC 构建边界研究

## 研究范围

目标是验证 Web/Admin 以 `import type { AppType } from '@starter/api/rpc'` 消费 Hono RPC 类型时，源码条件导出、声明产物、Turbo package graph、Next 和 Vite 是否会把 API 的 Node-only 实现带入调用端。

验证环境：

- 仓库：`/Users/wuwanzhu/Code/xdd/starter`
- Node.js：`v26.7.0`
- pnpm：`11.9.0`
- TypeScript：`5.9.3`
- Turborepo：`2.10.8`
- Next.js：`16.2.4`
- Vite：`8.2.0`
- API 使用的 Hono：`4.13.0`

本研究没有修改产品代码。临时探针位于 `/tmp/starter-rpc-boundary-probe/`，不属于仓库交付物。

## 当前边界

关键文件：

- `apps/api/package.json:6-15`：`@starter/api` 的 `.` 和 `./rpc` 都把 `development` 放在 `types`、`import` 之前。
- `apps/api/tsconfig.json:6-11`：API 自己启用 `customConditions: ["development"]`，并定义 `@api/* -> ./src/*`。
- `apps/web/tsconfig.json:12-18`：Web 也启用 `customConditions: ["development"]`，但只定义 `@web/*`，没有 API 的 `@api/*`。
- `apps/admin/tsconfig.app.json:12-18`：Admin 同样启用 `customConditions: ["development"]`，但只定义 `@admin/*`。
- `apps/api/src/rpc.ts:1`：只导出 `ApiRpcType` 的类型别名。
- `apps/api/src/routes/index.ts:1-26`：`ApiRpcType` 的实际类型来自 `ReturnType<typeof createRoutes>`；文件中既有 `import type`，也有真实的 `OpenAPIHono` 和各模块 route 导入。
- `apps/web/next.config.ts:4-6`：当前 `transpilePackages` 只有 `@starter/contracts`、`@starter/theme`，没有 `@starter/api`。
- `turbo.json:6-24`：`build` 和 `check-types` 都使用 `dependsOn: ["^..."]`。

`routes/index.ts` 的类型边界不是一个独立、浏览器无关的 DTO 文件。它需要 API 内部的 `@api/*` alias，并把路由实例类型关联到 API 的 `AppRuntime`、`HonoEnv`、OpenAPI/Hono 泛型和若干基础设施类型。

## 探针结果

### 1. `customConditions` 会强制选中 API 源码

临时探针使用一个仅含如下代码的入口：

```ts
import type { AppType } from '@starter/api/rpc'
```

使用 `moduleResolution: "Bundler"` 和 `customConditions: ["development"]` 运行：

```bash
pnpm exec tsc -p /tmp/starter-rpc-boundary-probe/tsconfig.development.json --pretty false
```

结果：失败，退出码 `2`。`/tmp/starter-rpc-development.trace` 显示：

```text
Matched 'exports' condition 'development'.
Using 'exports' subpath './rpc' with target './src/rpc.ts'.
.../apps/api/src/rpc.ts
```

随后 TypeScript 继续解析 `apps/api/src/routes/index.ts`，但调用端没有继承 API 的 paths 配置，以下模块全部报 `TS2307`：

```text
@api/bootstrap/app.types.js
@api/bootstrap/create-runtime.js
@api/shared/hono-env.js
@api/modules/auth/index.js
@api/modules/authorization/index.js
@api/modules/files/index.js
@api/modules/profile/index.js
@api/modules/system/index.js
@api/modules/users/index.js
```

这证明 `import type` 只消除运行时 JavaScript import，不会阻止 TypeScript 遍历被引用的 API 源码类型图，也不会自动携带 API 的 `baseUrl`、`paths` 或其他 compiler options。

若在 Web/Admin 复制 `@api/*` paths，解析错误可以被消除，但代价是调用端的类型检查会进入 API 全部路由和服务依赖，且会暴露 Node-only 类型图。这不是独立部署下稳定的公共边界。

### 2. 不启用 `development` 时会选中 API 声明产物

使用不带 `customConditions` 的 Bundler 配置：

```bash
pnpm exec tsc -p /tmp/starter-rpc-boundary-probe/tsconfig.default.json --pretty false
pnpm exec tsc -p /tmp/starter-rpc-boundary-probe/tsconfig.no-development.json --pretty false
```

两次均通过，`/tmp/starter-rpc-default.trace` 显示：

```text
Saw non-matching condition 'development'.
Matched 'exports' condition 'types'.
Using 'exports' subpath './rpc' with target './dist/rpc.d.ts'.
.../apps/api/dist/rpc.d.ts
```

因此当前 exports 顺序在“调用端没有 development 条件”时能落到声明产物；但 Web/Admin 当前 tsconfig 都声明了 `customConditions: ["development"]`，实际迁移不能依赖这一默认路径。

### 3. API build 生成空 runtime RPC 入口，但声明图仍然很深

执行：

```bash
pnpm --filter @starter/api build
```

结果：通过。产物核心信息：

```text
ESM dist/rpc.js            0 B
DTS dist/rpc.d.ts          239 B
DTS dist/rpc-BEF89cjH.d.ts 9.94 KB
```

`apps/api/dist/rpc.d.ts` 只有 `AppType` 的重导，但它继续引用 `rpc-BEF89cjH.d.ts`。后者的声明 import 包含：

```text
hono/utils/types
hono/types
@hono/zod-openapi
pino
better-sqlite3
drizzle-orm/better-sqlite3
better-auth
zod
```

结论：

- API 的 runtime RPC entry 是空的，单纯的 `import type` 不会把 API JavaScript 实现打入浏览器 bundle。
- `AppType` 的声明图仍会让 TypeScript 解析 Hono、Pino、SQLite、Drizzle 和 Better Auth 的类型依赖。`skipLibCheck` 只降低声明文件内部检查，不改变这些模块被解析、索引和参与类型实例化的事实。
- 如果 RPC 路由类型继续以 `ReturnType<typeof createRoutes>` 生成，API 全部 route 模块仍是声明生成阶段的输入；这符合 R2，但不能把它当作轻量 DTO package。

### 4. Node 的条件解析受条件开关和 exports 键顺序共同影响

临时探针通过：

```bash
cd /tmp/starter-rpc-boundary-probe
node --conditions=development resolve.mjs
node --conditions=production resolve.mjs
```

观察结果：

```text
--conditions=development -> apps/api/src/rpc.ts
--conditions=production  -> apps/api/dist/rpc.js
```

未传 `--conditions=development` 的 Node 解析也会落到 `dist/rpc.js`。`import.meta.resolve()` 的 `conditions` 参数本身不能替代 Node 的默认条件集合，它只改变用户条件；最终是否命中 `development` 仍取决于进程是否启用该条件。

外部依据：

- Node.js Packages 文档：conditional exports 对象键顺序有意义，较早键优先；`default` 应放最后；`types` 条件应放在类型条件分支最前。来源：[Node.js Packages, Conditional exports](https://nodejs.org/api/packages.html#conditional-exports)。
- TypeScript 文档：`customConditions` 会把额外条件加入 exports/imports 解析。来源：[TypeScript tsconfig customConditions](https://www.typescriptlang.org/tsconfig/customConditions.html)。

### 5. Vite 客户端 bundle 与类型图是两件事

临时 Vite 配置分别构建：

1. `import type { AppType } from '@starter/api/rpc'`
2. `import '@starter/api/rpc'` 的 runtime side-effect import

命令：

```bash
/Users/wuwanzhu/Code/xdd/starter/apps/admin/node_modules/.bin/vite build --mode development --config vite.type-only.config.mjs
/Users/wuwanzhu/Code/xdd/starter/apps/admin/node_modules/.bin/vite build --mode development --config vite.runtime.config.mjs
```

两者均通过；产物均约 `0.02 kB`。type-only 入口只保留自身输出，runtime 探针因为 `dist/rpc.js` 是空文件，也只保留探针日志，没有出现 `better-sqlite3`、`node:`、`better-auth`、`drizzle`、`pino` 或 `hono` 标记。

这只证明当前已构建的 `dist/rpc.js` 没有 runtime 内容，不证明源码入口可安全运行。将 Vite 的 `resolve.conditions` 或 package exports 配置到 `development -> src/rpc.ts` 后，runtime import 会使 Rollup 解析 API 源码及其 Node-only import，应该在迁移测试中明确禁止。

Vite 官方文档说明：

- 客户端默认条件包括 `module`、`browser`、`development|production`，并且 `import`、`require`、`default` 在满足条件时始终参与解析。
- `resolve.conditions` 的顺序和 package exports 的条件顺序都需要从具体到通用设计。
- `resolve.tsconfigPaths` 只对匹配到对应 tsconfig 的文件生效，不能把 API package 的 tsconfig paths 自动扩散给 Web/Admin。

来源：[Vite Shared Options, resolve.conditions](https://vite.dev/config/shared-options.html#resolve-conditions)。

### 6. Next `transpilePackages` 不会替代类型边界

当前 Next 配置未列出 `@starter/api`。Next 官方文档说明，`transpilePackages` 的语义是把指定 package 编译并作为依赖打包；workspace package 在部分 Next 构建路径会自动处理，列入该配置主要用于 raw TypeScript/JSX 或特定 Pages Router 场景。

因此：

- 不能通过把 `@starter/api` 加入 `transpilePackages` 来解决 `@api/*` 类型解析问题；这是 bundler 配置，不是 TypeScript paths 继承机制。
- 对 Web 只使用 `import type` 的 RPC 类型入口，不需要把 `@starter/api` 加入 `transpilePackages`。
- 若误用 runtime import，加入 `transpilePackages` 反而会扩大 Next 对 API 源码的编译/打包范围，增加 Node-only 模块进入 Server Component 或 client graph 的风险。
- 迁移验收应检查 Web client chunks 和 Next server/client 输出中没有 API route 实现；不能只看 Next build 命令成功。

来源：[Next.js next.config.js, transpilePackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)。

### 7. Turbo 只看 package manifest 的依赖图

当前 `pnpm turbo run build --dry=json` 结果显示：

- `@starter/web#build` 依赖 `@starter/contracts#build`、`@starter/theme#build`。
- `@starter/admin#build` 依赖 `@starter/contracts#build`、`@starter/theme#build`。
- `@starter/api#build` 依赖 `@starter/contracts#build`。
- Web/Admin 当前没有 `@starter/api` 依赖，因此 Turbo 不会在它们构建前运行 `@starter/api#build`。

当前 `pnpm turbo run check-types --dry=json` 也只沿同一 package graph 传播 `^check-types`，不会因为源码中出现 type-only import 自动建立 API package 任务依赖。

外部依据：

- Turbo 文档说明 `^build` / `^check-types` 只对 direct package dependencies 的同名任务建立前置关系。
- Turbo 文档还明确指出，type checker 若不依赖依赖包的检查任务，可能错误命中缓存；若类型检查依赖已生成声明产物，则必须显式建模该产物的生成前置关系。

来源：[Turborepo, Configuring Tasks](https://turborepo.com/docs/crafting-your-repository/configuring-tasks)。

### 8. 当前 API 与两端的类型检查基线

在当前代码、不消费 `@starter/api/rpc` 的状态下执行：

```bash
/usr/bin/time -p pnpm --filter @starter/api check-types
/usr/bin/time -p pnpm --filter @starter/api build
/usr/bin/time -p pnpm --filter @starter/web check-types
/usr/bin/time -p pnpm --filter @starter/admin check-types
```

本次冷启动记录：

| 命令 | 结果 | real | 备注 |
| --- | --- | ---: | --- |
| `@starter/api check-types` | 通过 | 5.44s | `tsc --noEmit` |
| `@starter/api build` | 通过 | 7.93s | DTS 生成约占主要时间，RPC JS 为 0 B |
| `@starter/web check-types` | 通过 | 2.61s | 包含 `next typegen`；会改写 `next-env.d.ts`，验证后已恢复 |
| `@starter/admin check-types` | 通过 | 4.51s | app/node 两个 tsconfig |

这些数值只作本机基线，不作为硬性性能阈值。迁移前后应在同一 Node、pnpm、依赖 lockfile 和缓存状态下重复记录。

## 构建边界结论

### 结论 A：不要让 Web/Admin 的 `development` 条件指向 API route 源码

当前 `development -> src/rpc.ts` 只适合 API 自己的开发上下文，不适合跨应用公共类型消费。Web/Admin 已启用同名 `customConditions`，所以直接添加 `@starter/api` 依赖后会遇到 `@api/*` paths 断裂；修补 paths 会把 Node 服务端类型图扩散到两个调用端。

推荐的 `@starter/api` RPC exports 形状是“类型声明优先、运行时构建产物兜底”，例如：

```json
"./rpc": {
  "types": "./dist/rpc.d.ts",
  "import": "./dist/rpc.js",
  "default": "./dist/rpc.js"
}
```

研究阶段不修改该配置。实现阶段需要明确决定是否删除 `./rpc` 的 `development` 分支；若保留，Web/Admin 的 tsconfig/Vite/Next 解析条件必须经过专门探针确认不能选中它。更稳妥的选择是：API 的 `development` 源码入口只供 API package 内部相对路径或 API 的开发工具使用，不作为 Web/Admin 的公共 package export。

### 结论 B：type-only 引用不形成 runtime bundle，但仍形成完整的声明类型图

应同时约束两件事：

- 编译期：Web/Admin 可以 `import type { AppType } from '@starter/api/rpc'`，类型来源是 API build 产生的 `dist/rpc.d.ts`。
- 运行时：adapter 从 `hono/client` 导入 `hc`，领域 API 文件使用 app 内 adapter；任何文件禁止从 `@starter/api/rpc` 做 value import。

`AppType` 的声明仍会解析 Hono 等服务器侧类型，这是 Hono RPC 类型的自然代价。不能把 `@starter/api` 当作浏览器运行时依赖，也不能声称它是零成本类型依赖。

### 结论 C：`@starter/api` 必须在 Web/Admin 的 package manifest 中声明

即使 import 是 type-only，也要在 Web/Admin 的 `devDependencies` 或项目约定的类型构建依赖中声明 `@starter/api: workspace:*`，以便：

- Node/pnpm 安装时依赖关系明确；
- Turbo package graph 能发现 API；
- API build 产物变更能使 Web/Admin 的相关任务失效；
- 不依赖根目录 hoisting 或 phantom dependency。

如果 adapter 使用 `hc`，两端还需要显式声明 `hono`，因为 `hono/client` 是 adapter 的实际 runtime 依赖。这个依赖不是 `@starter/api` 的 runtime 依赖。

### 结论 D：API declaration 产物必须有明确前置生成策略

仅添加 package manifest 依赖并不能让 `pnpm check-types` 自动产生 `apps/api/dist/*.d.ts`，因为当前 root `check-types` 只执行 `^check-types`，没有 `^build`。实现方案应二选一并写入 implement.md：

1. 让 Web/Admin 的类型检查显式依赖 `@starter/api#build`，确保 clean checkout 先生成 RPC declarations；或者
2. 增加一个只负责 RPC 声明生成的 API task，并让 Web/Admin 的 `check-types` 显式依赖该 task。

当前任务要求保持构建独立、减少通用 package；优先方案是复用现有 API build 产物，使用 Turbo package-specific task dependency 或单独的 API declaration task 明确建模，而不是在 Web/Admin tsconfig 复制 `@api/*` paths。

发布构建顺序应为：

```text
contracts#build
    |
api#build  -> 生成 dist/rpc.d.ts 和 dist/rpc.js
    |
web#check-types/build     admin#check-types/build
```

Web 与 Admin 在 API build 完成后可以并行。迁移阶段 API 和两个调用端仍可分别发布：旧客户端继续使用旧 fetch，新的 RPC adapter 只在对应 app 完成类型和行为验证后启用；API HTTP 路径、method、状态码和 envelope 不变。

### 结论 E：不要把 `@starter/api` 加入 Web 的 `transpilePackages`

只消费声明的 RPC 类型时，`transpilePackages` 没有必要；它也不能解决 API `@api/*` alias 的 TS 解析。误把 API 加入该配置会增加 raw API source 被 Next 编译/打包的可能。应保留当前 `transpilePackages` 范围，除非后续有明确的 API runtime server import 场景并单独验证 Node-only 依赖处理。

## 推荐验收探针

实现 RPC 边界后，在临时目录或仓库内受控 test 中保留以下检查：

1. **Exports 解析**

```bash
# TypeScript：必须命中 dist/rpc.d.ts，不得出现 apps/api/src
pnpm exec tsc -p <consumer-probe-tsconfig> --traceResolution --pretty false
rg -n "apps/api/src|@api/" <trace-file>

# 预期：无匹配
```

2. **运行时导入约束**

```bash
rg -n "from ['\"]@starter/api/rpc['\"]|import\(['\"]@starter/api/rpc" apps/web apps/admin
```

预期只允许 `import type`，不允许 value import 或 side-effect import。

3. **Web/Admin 客户端 bundle**

```bash
pnpm --filter @starter/admin build
pnpm --filter @starter/web build
rg -n "better-sqlite3|node:|better-auth|drizzle-orm|pino|apps/api/src|@starter/api" apps/admin/dist apps/web/.next
```

需要区分允许的 Web/Admin 自身 Better Auth 客户端依赖和不允许的 API server route/infra bundle；验收不能只用一个宽泛的 `better-auth` 字符串断言。

4. **Node 运行时条件**

```bash
node --conditions=development <resolve-probe>
node --conditions=production <resolve-probe>
```

公共 `@starter/api/rpc` 消费路径应在 consumer 配置中稳定落到声明和构建产物；若 API 内部需要 development source，使用 API 自己的相对路径，不让 Web/Admin 共享该条件。

5. **Turbo 图**

```bash
pnpm turbo run build --dry=json > /tmp/build-graph.json
pnpm turbo run check-types --dry=json > /tmp/check-types-graph.json
```

断言 Web/Admin 任务的 `dependencies` 中存在 `@starter/api#build` 或明确的 RPC declaration task，并且 API 在前。

## TypeScript 性能基线方案

迁移前后使用同一环境，分别记录冷缓存和 warm cache：

```bash
/usr/bin/time -p pnpm --filter @starter/api exec tsc --noEmit --extendedDiagnostics
/usr/bin/time -p pnpm --filter @starter/web exec tsc --noEmit --extendedDiagnostics
/usr/bin/time -p pnpm --filter @starter/admin exec tsc -p tsconfig.app.json --noEmit --extendedDiagnostics
/usr/bin/time -p pnpm --filter @starter/admin exec tsc -p tsconfig.node.json --noEmit --extendedDiagnostics

pnpm --filter @starter/api exec tsc --noEmit --listFilesOnly > /tmp/api-files.txt
pnpm --filter @starter/web exec tsc --noEmit --listFilesOnly > /tmp/web-files.txt
pnpm --filter @starter/admin exec tsc -p tsconfig.app.json --noEmit --listFilesOnly > /tmp/admin-files.txt
wc -l /tmp/api-files.txt /tmp/web-files.txt /tmp/admin-files.txt
```

重点保存 `extendedDiagnostics` 中的：

- `Files`
- `Lines of Library`
- `Lines of Definitions`
- `Types`
- `Instantiations`
- `Memory used`
- `Parse time`
- `Bind time`
- `Check time`
- `I/O read time`
- `Total time`

若出现明显回归，再执行：

```bash
pnpm --filter @starter/web exec tsc --noEmit --generateTrace /tmp/web-rpc-trace
pnpm --filter @starter/admin exec tsc -p tsconfig.app.json --noEmit --generateTrace /tmp/admin-rpc-trace
```

性能比较建议：

- 同一命令运行 3 次，报告中位数，不比较单次偶然值。
- 分别比较“未导入 AppType”“导入 AppType 声明产物”“错误命中 API source”三种探针，确认 source 命中确实是异常路径。
- 记录声明图文件数、类型实例化数和内存峰值；尤其关注 `better-auth`、`drizzle-orm/better-sqlite3` 和 Hono 泛型进入 Web/Admin 后的增量。
- Turbo 层面使用 `pnpm turbo run check-types build --dry=json` 和实际构建日志，确认新增 API declaration 前置任务没有造成重复 API build。
- 性能回归阈值在设计评审时确认；研究阶段建议把 `Total time`、`Check time`、`Memory used` 相对迁移前中位数增长超过 20% 作为需要调查的信号，而不是立即判定失败。

## 风险与回滚

主要风险：

- API exports 的 `development` 条件继续被 Web/Admin TypeScript 或 Vite 命中，导致 `@api/*` 解析失败或消费端类型图膨胀。
- API `dist` 未先生成，导致 clean checkout 的 Web/Admin `check-types` 找不到 `dist/rpc.d.ts`。
- 误把 API value import 或 `transpilePackages` 引入调用端，使 Node-only 模块进入 Next/Vite 构建图。
- `AppType` 声明随 Hono/OpenAPI/API 基础设施类型增长，导致 Web/Admin TypeScript `Check time`、`Types`、`Instantiations` 或内存明显增加。
- Turbo 只在 manifest 依赖建立后感知 API；只改 import 不改 package.json 会出现缓存和构建顺序错误。

回滚点：

1. RPC adapter 尚未接入页面前：移除两端 `@starter/api` 类型依赖和 adapter 文件，旧 fetch 客户端继续工作。
2. API exports 修改后：恢复 `apps/api/package.json` 的 `./rpc` exports，API 仍可独立 build，调用端继续旧客户端。
3. 任何一端出现构建或类型图回归：只回滚该端的 RPC adapter 和 package manifest 依赖，不回滚 API HTTP route、OpenAPI 或 contracts schema。
4. 保留 API 的现有 `dist` build 和 `/doc`、`/reference` 行为，避免用客户端回滚影响服务端部署。

## 研究中执行的验证命令

```bash
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/get_context.py
pnpm --filter @starter/api build
pnpm --filter @starter/api check-types
pnpm --filter @starter/web check-types
pnpm --filter @starter/admin check-types
pnpm turbo run build --dry=json
pnpm turbo run check-types --dry=json
node --conditions=development /tmp/starter-rpc-boundary-probe/resolve.mjs
node --conditions=production /tmp/starter-rpc-boundary-probe/resolve.mjs
pnpm exec tsc -p /tmp/starter-rpc-boundary-probe/tsconfig.development.json --pretty false
pnpm exec tsc -p /tmp/starter-rpc-boundary-probe/tsconfig.default.json --pretty false
/Users/wuwanzhu/Code/xdd/starter/apps/admin/node_modules/.bin/vite build --mode development --config /tmp/starter-rpc-boundary-probe/vite.type-only.config.mjs
/Users/wuwanzhu/Code/xdd/starter/apps/admin/node_modules/.bin/vite build --mode development --config /tmp/starter-rpc-boundary-probe/vite.runtime.config.mjs
```

结果：API build/check-types、Web/Admin check-types、无 development 条件的声明探针、Vite 两种 bundle 探针均通过；启用 `customConditions: ["development"]` 的源码探针按预期失败并证明 `@api/*` alias 不会跨 package 继承。Web typegen 曾更新 `apps/web/next-env.d.ts`，已恢复该验证副作用，当前研究交付只新增本文件。
