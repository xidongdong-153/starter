# 执行计划：docs/ai/ 文档

按顺序执行，每步做完就勾。写作过程中发现事实与 `design.md` 大纲冲突，先回 `prd.md` / `design.md` 改，再继续写。

## 阶段 0：核对基线

- [ ] 用 `grep` 汇总 AI 端点清单（路径 + 方法 + tag），确认总数仍是 53：
      `grep -h -A2 '^  method:' apps/api/src/modules/ai/*/*.openapi.ts`
- [ ] 从 `packages/contracts/src/ai.ts` 抄出 Runtime 请求/响应字段名和 HarnessEvent 类型清单，落成草稿备查
- [ ] 从 `packages/contracts/src/common.ts` 抄出错误码原文
- [ ] 确认 `mmdc` 能出图：`mmdc -i /tmp/probe.mmd -o /tmp/probe.png -w 2048`；失败就切 Kroki 校验路径

## 阶段 1：index.md

- [ ] 写术语表（13 条），每条一句定义 + 一句「不是什么」
- [ ] 写读者分流图（沿用 `design.md` 第 2 节那张，按最终文件名调整）
- [ ] 写三个 OpenAPI 面的用途与调用方
- [ ] 写代码与规范位置索引

## 阶段 2：integration.md

- [ ] 接入前提与凭据只返回一次的说明
- [ ] 鉴权分叉与 scope 隔离图 + subject 头规则表
- [ ] quickstart 六步，每步 curl + TypeScript 两组示例
- [ ] 接入时序图（含断流轮询分支）
- [ ] Runtime 接口详表（agents 2 个、sessions 6 个、runs 5 个）
- [ ] HarnessEvent 消费：envelope 字段、类型清单、SSE 帧解析规则、`sequence` 去重、折叠要点
- [ ] 错误码表（错误码 / HTTP 状态 / 触发条件 / 客户端动作）
- [ ] 限制与规避做法七条
- [ ] Control 面与 Compatibility 面概览表格 + 「第三方不要接」的说明
- [ ] 自查：全文不出现仓库内部源码路径

## 阶段 3：design.md

- [ ] 系统承诺（两类调用的区别）
- [ ] 模块分层总览图 + 三条边界
- [ ] 九个子域的职责段落（含代码目录）
- [ ] 一次 Run 的时序图 + 五个阶段说明
- [ ] 三种产物的关系 + 双库写入与审计去向图
- [ ] Run 状态机图 + 终态写入顺序 + 启动恢复扫描
- [ ] 鉴权与 scope 模型（两种 Principal、`RuntimeAccessContext`、`accessWhere` 过滤维度）
- [ ] 设计约束清单
- [ ] 深读入口：五份 spec 各自覆盖什么

## 阶段 4：maintenance.md

- [ ] 改动前先确认的三件事
- [ ] 六个扩展点的改动路径
- [ ] 跨层改动顺序 + 反向改动会漏什么
- [ ] 15 张 AI 表的用途与禁止落库字段
- [ ] 审计口径（`scenario` 取值、begin/finalize 约束）
- [ ] 验收命令 + 必须起 dev 才能验的那类改动
- [ ] 运维动作五项
- [ ] 故障排查表六行

## 阶段 5：收口

- [ ] `README.md` 目录一节加 `docs/ai` 链接
- [ ] 六个 mermaid 块逐个抽到临时 `.mmd` 用 `mmdc` 渲染，看图确认标签没截断、方向合理，验证完删临时文件
- [ ] 按 `xdd-plain-docs` 硬边界通读：八股词、翻译腔、客服腔、emoji
- [ ] 每篇行数落在 200-400（`wc -l docs/ai/*.md`）
- [ ] 文档里的路径、字段、header、错误码、命令抽样回搜源码，确认能搜到原文

## 验证命令

```bash
pnpm format:check
pnpm check-types
pnpm lint
pnpm test
wc -l docs/ai/*.md
git status --short
```

`format:check` 会检查 md 文件格式，报错就跑 `pnpm format` 再复查。`check-types`、`lint`、`test` 只用于确认没有误改代码，结果应与改动前一致。

## 审查点

- 阶段 2 写完先请用户看 `integration.md`：这篇是给外部读者的，用词和示例最需要确认。
- 阶段 5 收口前请用户确认 `README.md` 那行链接要不要加。

## 回滚

改动只有 `docs/ai/` 四个新文件和 `README.md` 一行。要回滚就删 `docs/ai/` 目录、`git checkout -- README.md`，不涉及数据库和运行代码。
