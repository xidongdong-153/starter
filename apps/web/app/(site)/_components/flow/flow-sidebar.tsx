'use client'

import type { FlowDocument } from '@web/lib/flow/flow-document'
import { Check, Copy, Pencil, Waypoints, X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'

import { Button } from '@web/components/ui/button'
import { Input } from '@web/components/ui/input'
import { cn } from '@web/lib/utils'

const NAME_MAX_LENGTH = 120

export interface FlowSidebarProps {
  documents: FlowDocument[]
  activeId: string | null
  disabled?: boolean
  onSelect: (documentId: string) => void
  onCreate: () => void
  onDuplicate: (documentId: string) => void
  onRename: (documentId: string, name: string) => void
  onDelete: (documentId: string) => void
  className?: string
}

/**
 * 左侧流程文档列表：新建、复制、重命名、删除，localStorage 是唯一存储。
 */
export function FlowSidebar({
  documents,
  activeId,
  disabled = false,
  onSelect,
  onCreate,
  onDuplicate,
  onRename,
  onDelete,
  className,
}: FlowSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function handleStartRename(document: FlowDocument) {
    setRenamingId(document.id)
    setDraftName(document.name)
    setNameError(null)
    setDeletingId(null)
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = draftName.trim()
    if (name.length === 0) {
      setNameError('名称不能为空。')
      return
    }
    if (name.length > NAME_MAX_LENGTH) {
      setNameError(`名称不能超过 ${NAME_MAX_LENGTH} 个字符。`)
      return
    }
    if (renamingId !== null) onRename(renamingId, name)
    setRenamingId(null)
  }

  return (
    <aside
      aria-label="流程文档侧边栏"
      className={cn('flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface-muted/40', className)}
    >
      <div className="border-b border-border p-4">
        <Button
          className="w-full justify-start gap-2 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          disabled={disabled}
          onClick={onCreate}
          type="button"
        >
          <Waypoints aria-hidden="true" size={16} />
          新建流程
        </Button>
      </div>

      <div className="border-b border-border-subtle px-4 py-2 text-xs text-muted-foreground">
        流程文档 ({documents.length})
      </div>

      <nav aria-label="流程文档列表" className="flex-1 overflow-y-auto p-2">
        {documents.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">暂无流程，点击上方按钮新建。</div>
        ) : (
          <ul className="space-y-1">
            {documents.map((document) => {
              const isActive = document.id === activeId
              const isRenaming = renamingId === document.id
              const isDeleting = deletingId === document.id

              if (isRenaming) {
                return (
                  <li className="border border-border bg-surface p-2 shadow-sm" key={document.id}>
                    <form onSubmit={handleRenameSubmit}>
                      <Input
                        autoFocus
                        className="h-9 text-xs"
                        onChange={(event) => {
                          setDraftName(event.target.value)
                          setNameError(null)
                        }}
                        value={draftName}
                      />
                      {nameError ? (
                        <p className="mt-1.5 text-xs text-danger" role="alert">
                          {nameError}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-end gap-1.5">
                        <Button size="sm" type="submit">
                          <Check aria-hidden="true" size={14} />
                          保存
                        </Button>
                        <Button onClick={() => setRenamingId(null)} size="sm" type="button" variant="ghost">
                          <X aria-hidden="true" size={14} />
                          取消
                        </Button>
                      </div>
                    </form>
                  </li>
                )
              }

              if (isDeleting) {
                return (
                  <li className="border border-danger/40 bg-surface p-2 shadow-sm" key={document.id}>
                    <p className="text-xs text-muted-foreground">确认删除此流程？删除后无法恢复。</p>
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <Button onClick={() => onDelete(document.id)} size="sm" type="button" variant="destructive">
                        删除
                      </Button>
                      <Button onClick={() => setDeletingId(null)} size="sm" type="button" variant="ghost">
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
                    isActive
                      ? 'border-border-subtle bg-surface text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-surface-muted/80 hover:text-foreground',
                  )}
                  key={document.id}
                >
                  <button
                    aria-current={isActive ? 'true' : undefined}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    disabled={disabled}
                    onClick={() => onSelect(document.id)}
                    type="button"
                  >
                    <span className="w-full truncate text-xs font-medium">{document.name}</span>
                    <span className="text-[10px] text-muted-foreground" suppressHydrationWarning>
                      {new Date(document.updatedAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>

                  {isActive ? (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
                      <Button
                        aria-label="重命名流程"
                        className="size-7 p-0"
                        disabled={disabled}
                        onClick={() => handleStartRename(document)}
                        size="icon"
                        title="重命名"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil aria-hidden="true" size={13} />
                      </Button>
                      <Button
                        aria-label="复制流程"
                        className="size-7 p-0"
                        disabled={disabled}
                        onClick={() => onDuplicate(document.id)}
                        size="icon"
                        title="复制"
                        type="button"
                        variant="ghost"
                      >
                        <Copy aria-hidden="true" size={13} />
                      </Button>
                      <Button
                        aria-label="删除流程"
                        className="size-7 p-0 text-muted-foreground hover:text-danger"
                        disabled={disabled}
                        onClick={() => setDeletingId(document.id)}
                        size="icon"
                        title="删除"
                        type="button"
                        variant="ghost"
                      >
                        <X aria-hidden="true" size={13} />
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
