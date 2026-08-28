import type { Metadata } from 'next'

import { ChatPanel } from '../_components/chat/chat-panel'

export const metadata: Metadata = {
  title: '对话',
  description: '在公开站点里和 API 提供的 Agent 对话。',
}

export default function ChatPage() {
  return (
    <main className="page-enter site-container flex h-[calc(100dvh-8rem)] min-h-[600px] flex-col pb-6">
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatPanel className="flex-1" />
      </div>
    </main>
  )
}
