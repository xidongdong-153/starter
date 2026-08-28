# PRD: 给 web 引入 shadcn/ui 并美化模板

## 目标

给 `apps/web` 引入 shadcn/ui 源码化组件体系，替换现有手写 class 的按钮、输入框、卡片等重复样式，并让公开站点作为模板整体更美观、更精致。

## 背景与已确认事实

参考文章：`/Users/wuwanzhu/Code/learning/Learn-AI-Companion/01-ai-companion/articles/10-项目实战/工程基础/154-引入-shadcn-ui.md`。
文章场景是另一个 monorepo（`packages/ui` 双子站共享），本仓库 admin 已用 Ant Design，不共享 Tailwind 组件，因此组件落在 web 应用内。

仓库现状：

- web：Next.js 16.2 + React 19 + Tailwind v4（PostCSS 插件），端口 4399
- 主题：`@starter/theme` Rose Pine token + `@theme inline` 语义映射（`packages/theme/styles/web.css`），`data-theme` 属性切换（默认暗色 rosepine / moon / dawn），已有 `--color-background/foreground/surface/primary/border/ring/muted-foreground` 等映射
- 路径别名：`@web/*`
- 现有 UI 全部手写 Tailwind class：`site-nav`、`auth-form`（GitHub/Google 按钮两段重复 class）、`empty-state`、chat 四件套（649 行）、各页面
- catalog 已有：`clsx`、`lucide-react`；缺：`class-variance-authority`、`tailwind-merge`、Radix primitives、`tw-animate-css`
- 现有视觉：直角/小圆角（rounded-sm）、细边框、朴素；可访问性处理已比较到位（focus-visible、aria）

## 需求

1. 引入 shadcn/ui 接入链路：`cn` 工具、`cva` 变体、Radix primitives、`components.json`
2. 首批基础组件（Button / Card / Input / Label / Separator 等），样式基于现有 Rose Pine 语义 token，跟随现有主题切换
3. 存量页面改用组件替换重复手写样式，并整体提升视觉精致度（美观属于本任务核心诉求，不是附属）
4. 依赖版本统一进 `pnpm-workspace.yaml` catalog

## 范围决策（已定）

- 美化深度：门面页（首页/导航/登录注册/空状态页）精致化升级；chat 四件套只做样式统一，不重构交互；版式、路由、文案不动
- 组件位置：`apps/web/components/ui/`（web 私有，不建共享包——admin 已用 Ant Design 无第二消费者）

## 验收标准

- `pnpm --filter @starter/web check`（类型/lint/format）通过
- `pnpm build` 通过
- 浏览器人工核验：首页、导航、登录/注册、chat、writing、projects、profiles、search 页面组件渲染正常，主题切换（亮/暗）下组件颜色正确
- 无重复内联按钮/输入样式残留（被组件替换）

## 不在范围内

- admin 端任何改动
- 新增业务功能、新页面
- 重写主题包 token 体系（沿用 Rose Pine）
- chat 事件流、状态、hooks 重构
- Radix 重组件（Dialog/Popover/Select 等）
