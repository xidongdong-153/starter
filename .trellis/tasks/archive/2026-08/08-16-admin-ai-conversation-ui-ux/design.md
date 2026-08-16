# 优化AI会话admin页面UI交互与显示设计 - 技术设计

## 1. 整体架构与组件拆分

AI 会话页面拆分为轻量、职责明确的子模块，保证组件可维护性与渲染性能。

```mermaid
flowchart TD
  subgraph AiConversationsPage["AiConversations 主页面"]
    Header["页面头部 (AdminPageHeader)"]
    subgraph MainContent["主体区域 (Flex 分栏)"]
      Sidebar["会话侧边栏 (ConversationSidebar)"]
      ChatView["会话主视图 (ChatArea)"]
    end
  end

  subgraph SidebarComponents["侧边栏子模块"]
    SearchInput["会话搜索框 (SearchInput)"]
    ConvList["会话列表 (Virtual/Mapped List)"]
    NewConvBtn["新建会话按钮"]
  end

  subgraph ChatViewComponents["会话主视图子模块"]
    ChatHeader["会话顶栏 (模型/状态/移动端抽屉开关)"]
    MessageList["消息流视口 (MessageList + AutoScroll)"]
    Composer["输入工作台 (Composer)"]
    ScrollBottomBtn["回到底部悬浮按钮"]
  end

  subgraph MessageRenderComponents["消息渲染组件"]
    UserBubble["用户消息气泡"]
    AssistantBubble["AI 消息气泡"]
    MarkdownRenderer["Markdown 原生轻量渲染器"]
    CodeBlock["代码块 (语法高亮/一键复制/语言标签)"]
    ToolBlock["工具执行状态卡片 (折叠/展开/耗时/状态)"]
    MessageActionBar["消息操作栏 (一键复制/重试)"]
  end

  Sidebar --> SearchInput & ConvList & NewConvBtn
  ChatView --> ChatHeader & MessageList & Composer & ScrollBottomBtn
  MessageList --> UserBubble & AssistantBubble
  AssistantBubble --> MarkdownRenderer & ToolBlock & MessageActionBar
  MarkdownRenderer --> CodeBlock
```

## 2. 数据流与流式响应生命周期

```mermaid
sequenceDiagram
  participant User as 用户
  participant UI as 会话界面 (AiConversations)
  participant Hook as TanStack Query / Mutations
  participant Stream as SSE Stream Reader
  participant API as 后端 API (/api/ai/conversations)

  User->>UI: 输入文本并按下 Enter 发送
  UI->>UI: 清空输入框，设置 pendingUserText 与 streaming 状态
  UI->>Stream: 发起 streamAiConversation
  Stream->>API: POST /messages (SSE)
  
  loop 接收流式事件
    API-->>Stream: text_delta / tool_activity
    Stream-->>UI: 实时追加 streamText / toolSummaries
    UI->>UI: 触发流式 Markdown 增量渲染与自动贴底滚动
  end

  API-->>Stream: completed 事件
  Stream-->>UI: 标记完成
  UI->>Hook: 刷新会话详情与列表 (refetch)
  Hook-->>UI: 同步最新持久化消息
  UI->>UI: 重置流式临时状态
```

## 3. 轻量 Markdown 与代码高亮设计

为了避免引入重型外部依赖并保证在 React 19 / Vite 环境下 100% 稳定可靠，实现一个专注于 AI 常见输出格式的 Markdown 结构化解析组件：
- **Block 级别**：
  - Code Block（` ```lang ... ``` `）：分离代码语言和代码内容，顶部带语言徽标和一键复制按钮。
  - Heading（`#`, `##`, `###`, `####`）：自适应字号与字重。
  - Blockquote（`> `）：左侧引用条与浅色底色。
  - Unordered / Ordered List（`- `, `* `, `1. `）：结构化列表项。
  - Table（`| ... |`）：带表头和自适应横向滚动的表格。
  - Paragraph & Linebreak：保留自然换行。
- **Inline 级别**：
  - Inline Code（`` `code` ``）：专属灰色/主题背景标签。
  - Bold（`**text**`）、Italic（`*text*`）、Strikethrough（`~~text~~`）。
  - Link（`[text](url)`）：受保护链接（`target="_blank" rel="noopener noreferrer"`）。

## 4. 交互细节与状态机

```mermaid
stateDiagram-v2
  [*] --> Idle: 会话加载就绪
  Idle --> Composing: 输入内容
  Composing --> Idle: 清空输入
  Composing --> Streaming: 按 Enter 发送
  Streaming --> Streaming: 接收文本/工具调用增量
  Streaming --> Stopped: 点击停止按钮
  Streaming --> Completed: 接收 completed 事件
  Streaming --> Failed: 网络异常 / 接收 error 事件
  Stopped --> Idle: 状态刷新
  Completed --> Idle: 状态刷新
  Failed --> Retrying: 点击重试
  Retrying --> Streaming: 重新发起流式连接
```
