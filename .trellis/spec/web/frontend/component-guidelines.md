# Web 组件规范

## Server 和 Client 边界

页面和布局默认是 Server Component。`SiteNav`、`SessionHome`、`AuthForm`、`ThemeToggle` 等需要状态、事件或浏览器 API 的组件才声明 `'use client'`。

```tsx
// apps/web/app/(site)/page.tsx
import Link from "next/link";

export default function HomePage() {
  return <Link href="/profiles">查看公开资料</Link>;
}
```

客户端组件通过 props 接收已准备好的展示数据，或调用明确的 `lib/api` 函数；不要为了使用一个 click handler 把整个 layout 变成 Client Component。

## 路由和交互

内部页面使用 `next/link`，外部 Admin 使用带 `target="_blank"` 和 `rel="noopener noreferrer"` 的普通链接。导航使用 `usePathname` 判断 active 状态，移动菜单在路由变化后关闭，并通过 Escape 和遮罩关闭。

按钮必须有 `type`，图标用 `lucide-react` 并设置 `aria-hidden`；图标按钮提供 `aria-label`。`SiteNav` 和 `AuthForm` 是键盘焦点、active 状态和错误 role 的现有例子。

## 内容边界

首页的 sections 只展示已存在的入口和明确的空状态。文稿、项目和搜索接口尚未接入时，页面使用 `empty-state.tsx`，不要编造文章、项目或搜索结果。

## 样式

优先使用 `packages/theme/styles/web.css` 提供的语义 Tailwind token，如 `bg-background`、`text-muted-foreground`、`border-border`、`text-primary`。

基础控件用 `components/ui/` 里的 shadcn 源码组件（Button、Card、Input、Textarea、Label、Separator、Badge、Skeleton），`cn` 在 `lib/utils.ts`。新页面先找现成组件，不够时在 `components/ui/` 新增，不往页面里手写重复的按钮、输入框 class。

全站直角风：不写任何 `rounded-*` 类，包括 `rounded-sm`。层永和精致度用 shadow（`shadow-sm` 悬停时 `shadow-md`）、毛玻璃和颜色 token 表达。交互按钮保持 `min-h-11` 尺寸和 focus-visible ring。
