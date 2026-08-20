import type { TimelineCompactionItem } from '@admin/features/ai/harness/timeline'
import { Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** 上下文压缩提示行，带压缩前的 token 数（transcript 侧有这个字段）。 */
export function TimelineCompaction({ item }: { item: TimelineCompactionItem }) {
  const { t } = useTranslation()

  return (
    <div className="border-border-subtle bg-surface-muted/50 text-fg-muted flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
      <Archive className="size-3.5 shrink-0" />
      <span>{t('ai.sessions.tool.compaction')}</span>
      {item.tokensBefore !== null ? (
        <span className="text-fg-muted/70 shrink-0 font-mono text-[11px]">
          {t('ai.sessions.compactionTokens', { tokens: item.tokensBefore })}
        </span>
      ) : null}
      <span className="text-fg-muted/70 min-w-0 flex-1 truncate">{item.summary}</span>
    </div>
  )
}
