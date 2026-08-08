# Web 质量规范

## 检查命令

修改 Web 后依次运行：

```bash
pnpm --filter @starter/web check-types
pnpm --filter @starter/web lint
pnpm --filter @starter/web format:check
pnpm --filter @starter/web build
```

## 页面状态

- 路由加载用 `app/loading.tsx` 提供 `aria-live="polite"` 的状态。
- 未捕获错误用 `app/error.tsx` 提供 reset 和回首页操作。
- 未找到页面用 `app/not-found.tsx` 说明链接或公开资料不存在，并给出回首页链接。
- API 请求失败显示具体的可读错误，不渲染未经过校验的 response。

## 可访问性与响应式

导航使用 `aria-current` 表示当前页面，菜单使用 `aria-expanded`、按钮 label 和焦点恢复。交互按钮保持 `min-h-11`，移动菜单要锁定 body 滚动并支持 Escape。图片必须有合适的 `alt`，装饰性图标设置 `aria-hidden`。

## 变更检查

新增动态页面时验证合法 ID、404、API 失败、窄屏和深色主题；新增客户端组件时确认 `'use client'` 没有向上扩散到不需要浏览器 API 的布局或页面。
