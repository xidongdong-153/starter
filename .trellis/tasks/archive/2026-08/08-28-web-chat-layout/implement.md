# Web Chat 左右布局改造实施计划

## 实施清单与执行步骤

- [x] **步骤 1：重构页面容器与外层尺寸适配**
  - 修改 `apps/web/app/(site)/chat/page.tsx`，将原有简单居中卡片调整为全视口高度自适应的左右分栏外壳（`h-[calc(100dvh-8rem)]`）。

- [x] **步骤 2：创建左侧会话侧边栏组件 (`chat-session-sidebar.tsx`)**
  - 实现侧边栏结构：顶部「新建对话」按钮、会话数量状态提示、独立垂直滚动列表。
  - 实现会话列表项：当前激活会话高亮、标题截断与时间显示、悬停操作栏（改名、归档）。
  - 内联重命名表单与归档二次确认逻辑。
  - 支持移动端折叠/展开浮层交互。

- [x] **步骤 3：创建右侧顶部导航栏组件 (`chat-header.tsx`)**
  - 显示当前会话标题、移动端侧边栏展开开关、Agent 下拉切换选择器、运行状态指示。

- [x] **步骤 4：优化消息时间线与自动滚动 (`chat-timeline.tsx`)**
  - 为消息容器配置 `flex-1 overflow-y-auto`。
  - 接入 `useRef` 与自动触底逻辑（在新消息、流式接收中平滑滚动到底部）。
  - 美化用户消息气泡、助手消息卡片、思考过程（Thinking）折叠与工具执行状态（Tool Activity）。
  - 设计精致的空状态引导卡片（Empty State）。

- [x] **步骤 5：升级底部固定输入区 (`chat-composer.tsx`)**
  - 将输入区固定在右侧对话区底部（`shrink-0 border-t border-border`）。
  - 优化多行自适应输入框，支持 Enter 发送与 Shift+Enter 换行。
  - 增强发送与停止按钮交互体验与视觉效果。

- [x] **步骤 6：组装 ChatPanel 主控制器 (`chat-panel.tsx`)**
  - 统一协调 `useChatRun`、左侧侧边栏、右侧主对话区（Header、Timeline、Composer、Notice）。
  - 处理登录状态判断、初始化加载骨架屏与全局错误提示。

- [x] **步骤 7：质量门禁与验证**
  - 运行 `pnpm --filter @starter/web check-types` 确保零类型错误。
  - 运行 `pnpm --filter @starter/web lint` 确保零 lint 错误。
  - 运行 `pnpm format:check` 确保代码格式符合规范。

## 验证命令

```bash
# 类型检查
pnpm --filter @starter/web check-types

# 代码规范
pnpm --filter @starter/web lint

# 格式校验
pnpm format:check
```
