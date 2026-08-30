'use client'

import { AlertCircle, LogIn, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Button } from '@web/components/ui/button'
import { useChatRun } from '@web/hooks/use-chat-run'
import { authClient } from '@web/lib/auth-client'
import { cn } from '@web/lib/utils'

import { ChatComposer } from './chat-composer'
import { ChatHeader } from './chat-header'
import { ChatSessionSidebar } from './chat-session-sidebar'
import { ChatTimeline } from './chat-timeline'

/**
 * Chat 主面板：
 * 协调左侧会话侧边栏与右侧对话主区（Header、Timeline、Composer、Notice），
 * 管理移动端侧边栏展开状态，连接 useChatRun 数据流。
 */
export function ChatPanel({ className }: { className?: string }) {
  const { data: session, isPending } = authClient.useSession()
  const [text, setText] = useState('')
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false)
  const chat = useChatRun(session?.user.id ?? null)

  useEffect(() => {
    // API 连不上时 getSession 会 reject，这里只是触发一次同步，失败交给 useSession 的状态展示。
    void authClient.getSession().catch(() => {})
  }, [])

  if (isPending) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center border border-border bg-surface p-8">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          正在读取登录状态…
        </p>
      </div>
    )
  }

  if (!session?.user) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center border border-border bg-surface p-8 text-center">
        <div className="grid size-12 place-items-center border border-border bg-surface-muted text-primary shadow-sm">
          <LogIn aria-hidden="true" size={22} />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">需要登录使用</h2>
        <p className="mt-2 max-w-sm text-xs text-muted-foreground">
          对话需要登录后使用，Agent 运行记录将保存在当前账户下。
        </p>
        <Button asChild className="mt-5" variant="default">
          <Link href="/login">前往登录</Link>
        </Button>
      </div>
    )
  }

  if (chat.boot === 'loading') {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center border border-border bg-surface p-8">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          正在加载 Agent 和对话历史…
        </p>
      </div>
    )
  }

  const { notice } = chat
  const currentSession = chat.sessions.find((item) => item.id === chat.sessionId)
  const sessionTitle = chat.sessionId === null ? '未保存的新对话' : (currentSession?.title ?? '对话')

  function handleSend(value: string) {
    setText('')
    void chat.send(value)
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-full overflow-hidden border border-border bg-card/60 shadow-sm backdrop-blur-sm',
        className,
      )}
    >
      {/* 桌面端左侧边栏 */}
      {!isDesktopSidebarCollapsed ? (
        <ChatSessionSidebar
          canMutateSessions={chat.canMutateSessions}
          className="hidden md:flex"
          onArchive={() => void chat.archiveSession()}
          onNew={chat.startNewSession}
          onRename={(title) => chat.renameSession(title)}
          onSelect={(id) => void chat.selectSession(id)}
          onToggleCollapseDesktop={() => setIsDesktopSidebarCollapsed(true)}
          sessionBusy={chat.sessionBusy}
          sessionId={chat.sessionId}
          sessions={chat.sessions}
          sessionTotal={chat.sessionTotal}
        />
      ) : null}

      {/* 移动端抽屉遮罩与浮动侧边栏 */}
      {isMobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            aria-label="关闭遮罩"
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <div className="relative z-10 flex h-full w-4/5 max-w-xs flex-col bg-surface shadow-xl">
            <ChatSessionSidebar
              canMutateSessions={chat.canMutateSessions}
              className="w-full border-r-0"
              onArchive={() => void chat.archiveSession()}
              onCloseMobile={() => setIsMobileSidebarOpen(false)}
              onNew={chat.startNewSession}
              onRename={(title) => chat.renameSession(title)}
              onSelect={(id) => void chat.selectSession(id)}
              sessionBusy={chat.sessionBusy}
              sessionId={chat.sessionId}
              sessions={chat.sessions}
              sessionTotal={chat.sessionTotal}
            />
          </div>
        </div>
      ) : null}

      {/* 右侧主对话区 */}
      <div className="flex min-w-0 flex-1 flex-col bg-surface/40">
        {chat.boot === 'failed' ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="grid size-12 place-items-center border border-danger/30 bg-danger/10 text-danger shadow-sm">
              <AlertCircle aria-hidden="true" size={22} />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-foreground">加载失败</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {notice?.message ?? '无法加载对话历史或 Agent 列表。'}
            </p>
            <Button className="mt-4 gap-1.5" onClick={chat.reload} size="sm" type="button" variant="outline">
              <RefreshCw aria-hidden="true" size={14} />
              重新加载
            </Button>
          </div>
        ) : (
          <>
            <ChatHeader
              agentId={chat.agentId}
              agents={chat.agents}
              isSidebarCollapsed={isDesktopSidebarCollapsed}
              onAgentChange={chat.selectAgent}
              onToggleSidebarDesktop={() => setIsDesktopSidebarCollapsed((open) => !open)}
              onToggleSidebarMobile={() => setIsMobileSidebarOpen(true)}
              running={chat.running}
              sessionTitle={sessionTitle}
              stopping={chat.stopping}
            />

            {/* 错误 / 提示横幅 */}
            {notice ? (
              <div className="flex items-center justify-between border-b border-border bg-surface-muted/90 px-4 py-2.5 text-xs">
                <p className="text-foreground" role="status">
                  {notice.message}
                </p>
                <div className="flex items-center gap-2">
                  {notice.kind === 'auth' ? (
                    <Button asChild size="sm" variant="link">
                      <Link href="/login">重新登录</Link>
                    </Button>
                  ) : null}
                  {notice.retryText !== undefined ? (
                    <Button
                      onClick={() => handleSend(notice.retryText ?? '')}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      重试
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* 消息时间线（内部滚动） */}
            <ChatTimeline
              history={chat.history}
              onSelectStarterPrompt={(prompt) => setText(prompt)}
              pendingUserText={chat.pendingUserText}
              timeline={chat.runState?.timeline ?? []}
            />

            {/* 底部固定输入区 */}
            <ChatComposer
              agentId={chat.agentId}
              agents={chat.agents}
              canStop={chat.canStop}
              onSend={() => handleSend(text.trim())}
              onStop={() => void chat.stop()}
              onTextChange={setText}
              running={chat.running}
              stopping={chat.stopping}
              text={text}
            />
          </>
        )}
      </div>
    </div>
  )
}
