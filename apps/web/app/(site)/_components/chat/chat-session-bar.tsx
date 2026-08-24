'use client'

import type { AgentSession } from '@starter/contracts'
import { Archive, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'

/** 和 contracts 的 agentSessionTitleSchema 一致：trim 后 1-120 字符。 */
const TITLE_MAX_LENGTH = 120

const controlBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60'
const inputBase =
  'min-h-11 rounded-sm border border-border bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60'

/**
 * 会话区：选择器、新建、改名、归档。
 * 业务动作都在 `useChatRun`，这里只做本地 UI 状态（编辑中和二段确认）、本地校验和交互装配。
 */
export function ChatSessionBar({
  canMutateSessions,
  onArchive,
  onNew,
  onRename,
  onSelect,
  sessionBusy,
  sessionId,
  sessions,
  sessionTotal,
}: {
  canMutateSessions: boolean
  onArchive: () => void
  onNew: () => void
  onRename: (title: string) => Promise<void>
  onSelect: (sessionId: string) => void
  sessionBusy: boolean
  sessionId: string | null
  sessions: AgentSession[]
  sessionTotal: number
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const currentSession = sessions.find((item) => item.id === sessionId)

  function handleSelectChange(event: ChangeEvent<HTMLSelectElement>) {
    setRenaming(false)
    setConfirming(false)
    onSelect(event.target.value)
  }

  function handleNew() {
    setRenaming(false)
    setConfirming(false)
    onNew()
  }

  function handleRenameStart() {
    setDraft(currentSession?.title ?? '')
    setRenameError(null)
    setRenaming(true)
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = draft.trim()
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
      // 保存失败时 hook 会抛错，错误提示由页面 notice 区显示，这里只退出编辑态。
      await onRename(title)
      setRenaming(false)
    } catch {
      setRenaming(false)
    }
  }

  function handleRenameCancel() {
    setRenaming(false)
    setRenameError(null)
  }

  function handleArchiveStart() {
    setConfirming(true)
  }

  function handleArchiveConfirm() {
    setConfirming(false)
    onArchive()
  }

  return (
    <section aria-label="会话列表" className="mb-6 border-b border-border pb-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="chat-session">
            会话
          </label>
          <select
            className={inputBase}
            disabled={!canMutateSessions}
            id="chat-session"
            onChange={handleSelectChange}
            value={sessionId ?? ''}
          >
            {sessionId === null ? <option value="">未保存的新对话</option> : null}
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className={`${controlBase} border border-border bg-surface`}
            disabled={!canMutateSessions}
            onClick={handleNew}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            新建对话
          </button>
          <button
            className={`${controlBase} border border-border bg-surface`}
            disabled={!canMutateSessions || sessionId === null}
            onClick={handleRenameStart}
            type="button"
          >
            <Pencil aria-hidden="true" size={16} />
            改名
          </button>
          <button
            className={`${controlBase} border border-border bg-surface`}
            disabled={!canMutateSessions || sessionId === null}
            onClick={handleArchiveStart}
            type="button"
          >
            <Archive aria-hidden="true" size={16} />
            归档
          </button>
        </div>
      </div>

      {sessionTotal > sessions.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          共 {sessionTotal} 个会话，只显示最近 {sessions.length} 个。
        </p>
      ) : null}
      {sessionBusy ? (
        <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">
          正在处理会话…
        </p>
      ) : null}

      {renaming && currentSession ? (
        <form className="mt-4 grid gap-2" onSubmit={handleRenameSubmit}>
          <label className="text-xs text-muted-foreground" htmlFor="chat-session-rename">
            新标题
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              autoFocus
              className={`${inputBase} min-w-0 flex-1`}
              id="chat-session-rename"
              onChange={(event) => {
                setDraft(event.target.value)
                setRenameError(null)
              }}
              value={draft}
            />
            <button
              className={`${controlBase} bg-primary text-primary-foreground`}
              disabled={!canMutateSessions}
              type="submit"
            >
              保存
            </button>
            <button
              className={`${controlBase} border border-border bg-surface`}
              onClick={handleRenameCancel}
              type="button"
            >
              取消
            </button>
          </div>
          {renameError ? (
            <p className="text-sm text-danger" role="alert">
              {renameError}
            </p>
          ) : null}
        </form>
      ) : null}

      {confirming ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">归档后这个对话会从列表消失，无法恢复。</p>
          <button
            className={`${controlBase} border border-border bg-surface`}
            onClick={handleArchiveConfirm}
            type="button"
          >
            确认归档
          </button>
          <button
            className={`${controlBase} border border-border bg-surface`}
            onClick={() => setConfirming(false)}
            type="button"
          >
            取消
          </button>
        </div>
      ) : null}
    </section>
  )
}
