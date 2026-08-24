'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useChatRun } from '@web/hooks/use-chat-run'
import { authClient } from '@web/lib/auth-client'

import { ChatComposer } from './chat-composer'
import { ChatSessionBar } from './chat-session-bar'
import { ChatTimeline } from './chat-timeline'

const linkStyle =
  'inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const buttonStyle =
  'mt-3 inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

/**
 * Chat 页面的客户端容器：登录判断、状态提示和输入区。
 * Session、Run 和事件折叠都在 `useChatRun` 里。
 */
export function ChatPanel() {
  const { data: session, isPending } = authClient.useSession()
  const [text, setText] = useState('')
  const chat = useChatRun(session?.user.id ?? null)

  useEffect(() => {
    // API 连不上时 getSession 会 reject，这里只是触发一次同步，失败交给 useSession 的状态展示。
    void authClient.getSession().catch(() => {})
  }, [])

  if (isPending) {
    return (
      <p aria-live="polite" className="text-sm text-muted-foreground">
        正在读取登录状态…
      </p>
    )
  }

  if (!session?.user) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">对话需要登录后使用，Agent 运行记录属于当前账户。</p>
        <Link className={`${linkStyle} mt-4`} href="/login">
          去登录
        </Link>
      </div>
    )
  }

  if (chat.boot === 'loading') {
    return (
      <p aria-live="polite" className="text-sm text-muted-foreground">
        正在加载 Agent 和对话历史…
      </p>
    )
  }

  const { notice } = chat
  const empty = chat.history.length === 0 && chat.pendingUserText === null && chat.runState === null

  function handleSend(value: string) {
    setText('')
    void chat.send(value)
  }

  return (
    <div>
      {notice ? (
        <div className="mb-6 rounded-sm border border-border bg-surface-muted px-4 py-3 text-sm">
          <p role="status">{notice.message}</p>
          {notice.kind === 'auth' ? (
            <Link className={linkStyle} href="/login">
              重新登录
            </Link>
          ) : null}
          {notice.retryText === undefined ? null : (
            <button className={buttonStyle} onClick={() => handleSend(notice.retryText ?? '')} type="button">
              重试
            </button>
          )}
          {chat.boot === 'failed' ? (
            <button className={buttonStyle} onClick={chat.reload} type="button">
              重新加载
            </button>
          ) : null}
        </div>
      ) : null}

      {chat.boot === 'failed' ? null : (
        <>
          <ChatSessionBar
            canMutateSessions={chat.canMutateSessions}
            onArchive={() => void chat.archiveSession()}
            onNew={chat.startNewSession}
            onRename={(title) => chat.renameSession(title)}
            onSelect={(id) => void chat.selectSession(id)}
            sessionBusy={chat.sessionBusy}
            sessionId={chat.sessionId}
            sessions={chat.sessions}
            sessionTotal={chat.sessionTotal}
          />
          <div aria-live="polite" className="min-h-32">
            {empty ? (
              <p className="text-sm text-muted-foreground">还没有对话内容。选择一个 Agent，输入内容后发送。</p>
            ) : (
              <ChatTimeline
                history={chat.history}
                pendingUserText={chat.pendingUserText}
                timeline={chat.runState?.timeline ?? []}
              />
            )}
          </div>

          <ChatComposer
            agentId={chat.agentId}
            agents={chat.agents}
            canStop={chat.canStop}
            onAgentChange={chat.selectAgent}
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
  )
}
