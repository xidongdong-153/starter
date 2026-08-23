import type { Metadata } from 'next'

import { ChatPanel } from '../_components/chat/chat-panel'

export const metadata: Metadata = {
  title: '对话',
  description: '在公开站点里和 API 提供的 Agent 对话。',
}

export default function ChatPage() {
  return (
    <main className="page-enter site-container py-12 md:py-20">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-primary">CHAT / 04</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">对话</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">
          页面调用 API 的 Agent Run 接口，展示流式输出和运行结果。Agent、模型和工具在 Admin 里配置。
        </p>
        <div className="mt-12 border-t border-border pt-8">
          <ChatPanel />
        </div>
      </div>
    </main>
  )
}
