import type { Metadata } from 'next'

import { ChatPanel } from '../_components/chat/chat-panel'

export const metadata: Metadata = {
  title: '对话',
  description: '在公开站点里和 API 提供的 Agent 对话。',
}

export default function ChatPage() {
  return (
    <main className="page-enter mx-auto flex h-[calc(100dvh-7rem)] w-full max-w-[120rem] flex-col px-4 pb-4 md:px-6 lg:px-8">
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatPanel className="flex-1" />
      </div>
    </main>
  )
}
