'use client'

import type { AgentSession } from '@starter/contracts'
import { Archive, Check, MessageSquare, MessageSquarePlus, Pencil, X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'

import { Button } from '@web/components/ui/button'
import { Input } from '@web/components/ui/input'
import { cn } from '@web/lib/utils'

/** 和 contracts 的 agentSessionTitleSchema 一致：trim 后 1-120 字符。 */
const TITLE_MAX_LENGTH = 120

export interface ChatSessionSidebarProps {
  canMutateSessions: boolean
  onArchive: () => void
  onNew: () => void
  onRename: (title: string) => Promise<void>
  onSelect: (sessionId: string) => void
  sessionBusy: boolean
  sessionId: string | null
  sessions: AgentSession[]
  sessionTotal: number
  className?: string
  onCloseMobile?: () => void
}

/**
 * 左侧会话列表侧边栏：
 * 包含新建对话操作、会话垂直独立滚动列表、选中高亮、内联改名表单与归档二次确认。
 */
export function ChatSessionSidebar({
  canMutateSessions,
  onArchive,
  onNew,
  onRename,
  onSelect,
  sessionBusy,
  sessionId,
  sessions,
  sessionTotal,
  className,
  onCloseMobile,
}: ChatSessionSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [confirmingArchiveId, setConfirmingArchiveId] = useState<string | null>(null)

  function handleStartNew() {
    setRenamingId(null)
    setConfirmingArchiveId(null)
    onNew()
    onCloseMobile?.()
  }

  function handleSelectSession(id: string) {
    setRenamingId(null)
    setConfirmingArchiveId(null)
    onSelect(id)
    onCloseMobile?.()
  }

  function handleStartRename(session: AgentSession) {
    setRenamingId(session.id)
    setDraftTitle(session.title)
    setRenameError(null)
    setConfirmingArchiveId(null)
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = draftTitle.trim()
    if (title.length === 0) {
      setRenameError('标题不能为空。')
      return
    }
    if (title.length > TITLE_MAX_LENGTH) {
      setRenameError(`标题不能超过 ${TITLE_MAX_LENGTH} 个字符。`)
      return
    }
    setRenameError(null)
    try {
      await onRename(title)
      setRenamingId(null)
    } catch {
      setRenamingId(null)
    }
  }

  function handleCancelRename() {
    setRenamingId(null)
    setRenameError(null)
  }

  function handleStartArchive(id: string) {
    setConfirmingArchiveId(id)
    setRenamingId(null)
  }

  function handleConfirmArchive() {
    setConfirmingArchiveId(null)
    onArchive()
  }

  return (
    <aside
      aria-label="会话侧边栏"
      className={cn(
        'flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface-muted/40 backdrop-blur-sm lg:w-80',
        className,
      )}
    >
      {/* 侧边栏头部：新建对话与关闭按钮（移动端） */}
      <div className="flex items-center justify-between gap-2 border-b border-border p-4">
        <Button
          className="flex-1 justify-start gap-2 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          disabled={!canMutateSessions}
          onClick={handleStartNew}
          type="button"
        >
          <MessageSquarePlus aria-hidden="true" size={16} />
          新建对话
        </Button>
        {onCloseMobile ? (
          <Button
            aria-label="关闭侧边栏"
            className="md:hidden"
            onClick={onCloseMobile}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" size={18} />
          </Button>
        ) : null}
      </div>

      {/* 会话统计与加载状态 */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2 text-xs text-muted-foreground">
        <span>
          会话历史 ({sessions.length}
          {sessionTotal > sessions.length ? ` / ${sessionTotal}` : ''})
        </span>
        {sessionBusy ? <span aria-live="polite">同步中…</span> : null}
      </div>

      {/* 会话列表：垂直独立滚动 */}
      <nav aria-label="历史会话" className="flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">暂无历史会话，点击上方按钮发起新对话。</div>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => {
              const isSelected = session.id === sessionId
              const isRenaming = renamingId === session.id
              const isConfirming = confirmingArchiveId === session.id

              if (isRenaming) {
                return (
                  <li className="border border-border bg-surface p-2 shadow-sm" key={session.id}>
                    <form className="space-y-2" onSubmit={handleRenameSubmit}>
                      <Input
                        autoFocus
                        className="h-9 text-xs"
                        disabled={!canMutateSessions}
                        onChange={(event) => {
                          setDraftTitle(event.target.value)
                          setRenameError(null)
                        }}
                        value={draftTitle}
                      />
                      {renameError ? (
                        <p className="text-xs text-danger" role="alert">
                          {renameError}
                        </p>
                      ) : null}
                      <div className="flex items-center justify-end gap-1.5">
                        <Button aria-label="确认修改" disabled={!canMutateSessions} size="sm" type="submit">
                          <Check aria-hidden="true" size={14} />
                          保存
                        </Button>
                        <Button aria-label="取消" onClick={handleCancelRename} size="sm" type="button" variant="ghost">
                          <X aria-hidden="true" size={14} />
                          取消
                        </Button>
                      </div>
                    </form>
                  </li>
                )
              }

              if (isConfirming) {
                return (
                  <li className="border border-danger/40 bg-surface p-2 shadow-sm" key={session.id}>
                    <p className="text-xs text-muted-foreground">确认归档此会话？归档后将从列表移除。</p>
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <Button
                        aria-label="确认归档"
                        disabled={!canMutateSessions}
                        onClick={handleConfirmArchive}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        确认
                      </Button>
                      <Button
                        aria-label="取消归档"
                        onClick={() => setConfirmingArchiveId(null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        取消
                      </Button>
                    </div>
                  </li>
                )
              }

              return (
                <li
                  className={cn(
                    'group relative flex items-center justify-between border border-transparent px-3 py-2.5 transition-colors',
                    isSelected
                      ? 'border-border-subtle bg-surface text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-surface-muted/80 hover:text-foreground',
                  )}
                  key={session.id}
                >
                  <button
                    aria-current={isSelected ? 'true' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    disabled={!canMutateSessions}
                    onClick={() => handleSelectSession(session.id)}
                    type="button"
                  >
                    <MessageSquare
                      aria-hidden="true"
                      className={cn(
                        'shrink-0',
                        isSelected ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                      )}
                      size={15}
                    />
                    <span className="truncate">{session.title}</span>
                  </button>

                  {/* 悬停快捷操作 */}
                  {isSelected && canMutateSessions ? (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
                      <Button
                        aria-label="重命名会话"
                        className="size-7 p-0"
                        onClick={() => handleStartRename(session)}
                        size="icon"
                        title="重命名"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil aria-hidden="true" size={13} />
                      </Button>
                      <Button
                        aria-label="归档会话"
                        className="size-7 p-0 text-muted-foreground hover:text-danger"
                        onClick={() => handleStartArchive(session.id)}
                        size="icon"
                        title="归档会话"
                        type="button"
                        variant="ghost"
                      >
                        <Archive aria-hidden="true" size={13} />
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </aside>
  )
}
