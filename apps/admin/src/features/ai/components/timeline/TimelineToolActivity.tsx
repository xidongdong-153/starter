import type { TimelineToolItem } from '@admin/features/ai/harness/timeline'
import { Tag } from 'antd'
import { LoaderCircle, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const ERROR_STATUSES = [
  'failed',
  'not_found',
  'invalid_arguments',
  'forbidden',
  'timed_out',
  'cancelled',
  'interrupted',
]

/**
 * 工具元素：工具名、状态和脱敏摘要。
 * 工具入参不在协议里，这里不显示也不构造。
 */
export function TimelineToolActivity({ item }: { item: TimelineToolItem }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const running = item.status === 'running'
  const isError = ERROR_STATUSES.includes(item.status)
  const canExpand = item.safeSummary !== null && item.safeSummary.length > 0

  return (
    <div className="border-border-subtle bg-surface-muted/50 overflow-hidden rounded-xl border text-xs shadow-2xs">
      <div
        className={`flex items-center justify-between px-3 py-2 ${
          canExpand ? 'hover:bg-surface-muted/80 cursor-pointer select-none' : ''
        }`}
        onClick={() => canExpand && setExpanded(!expanded)}
      >
        <div className="flex min-w-0 items-center gap-2">
          {running ? (
            <LoaderCircle className="text-primary size-3.5 shrink-0 animate-spin" />
          ) : (
            <Wrench className="text-primary size-3.5 shrink-0" />
          )}
          <span className="text-fg font-mono font-medium">{item.name}</span>
          <Tag color={running ? 'processing' : isError ? 'error' : 'success'} className="m-0 text-[11px]">
            {running ? t('ai.sessions.tool.running') : t(`ai.sessions.tool.status.${item.status}`)}
          </Tag>
        </div>
        {canExpand ? (
          <span className="text-fg-muted text-[11px]">
            {expanded ? t('ai.sessions.collapse') : t('ai.sessions.expand')}
          </span>
        ) : null}
      </div>
      {expanded && item.safeSummary ? (
        <div className="border-border-subtle/80 bg-surface/50 chat-scrollbar max-h-48 overflow-y-auto border-t px-3 py-2 leading-5">
          <p className="text-fg-muted m-0 whitespace-pre-wrap font-mono">{item.safeSummary}</p>
        </div>
      ) : null}
    </div>
  )
}
