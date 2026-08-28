# 实施计划：给 web 引入 shadcn/ui 并美化模板

## 执行清单（按序）

### 阶段 1：接入链路

- [x] 1.1 `pnpm-workspace.yaml` catalog 增补 `class-variance-authority`、`tailwind-merge`、`@radix-ui/react-slot`、`@radix-ui/react-label`、`@radix-ui/react-separator`；`apps/web/package.json` dependencies 以 `catalog:` 引入；`pnpm install`
- [x] 1.2 `packages/theme/styles/web.css` 的 `@theme inline` 补齐 `card/popover/secondary/accent/destructive/input/muted` 语义映射（见 design.md 表格）
- [x] 1.3 新建 `apps/web/lib/utils.ts`（`cn` = twMerge + clsx）
- [x] 1.4 新建 `apps/web/components.json`（aliases 指向 `@web/*`）

### 阶段 2：组件生成

- [x] 2.1 `components/ui/`：button、card、input、textarea、label、separator、badge、skeleton（shadcn new-york 源码，样式替换为语义 token，视觉按 design.md 精致化方向）

### 阶段 3：页面改造

- [x] 3.1 门面：首页 `page.tsx`、`site-nav.tsx`、`site-footer.tsx`、`session-home.tsx`
- [x] 3.2 认证：`auth-form.tsx`、`(auth)/layout.tsx`
- [x] 3.3 通用件：`empty-state.tsx`、`not-found.tsx`、`error.tsx`、`loading.tsx`、`theme-toggle.tsx`
- [x] 3.4 内页：writing（列表 + [slug]）、projects、profiles（列表 + [userId]）、search
- [x] 3.5 chat 四件套只换 class：composer、session-bar、timeline、panel；事件流与状态不动

### 阶段 4：验证

- [ ] 4.1 `pnpm --filter @starter/theme check`（theme 包改动回归）
- [x] 4.2 `pnpm --filter @starter/web check`（类型 + lint + format）
- [x] 4.3 `pnpm --filter @starter/web test && pnpm --filter @starter/web build`
- [ ] 4.4 admin 回归：`pnpm --filter @starter/admin check-types`（确认 web.css 改动无泄漏）
- [x] 4.5 浏览器人工核验（dev 起服，亮/暗两主题过一遍：首页、导航、登录、writing、projects、profiles、search、chat）

## 风险文件与回滚点

- `packages/theme/styles/web.css`：唯一跨包改动，改坏会影响 web 全站颜色 —— 映射只加不改现有行
- chat 四件套：只允许 class 字符串和 JSX 外层包装变化，任何 hooks/事件/状态改动视为越界
- 回滚：单 commit 交付，`git revert` 整体回收

## 完成定义

- 全部验证命令绿
- 无重复内联按钮/输入样式残留（`grep -rn "inline-flex min-h-11" apps/web/app apps/web/components` 无结果或仅剩组件库内部）
- 浏览器核验通过：两主题下所有页面正常、主题切换即变、focus/aria 行为不回退
