import type { TimelineUserItem } from '@admin/features/ai/harness/timeline'
import { formatDate } from '@admin/utils/dayjs'
import { User } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** 用户消息气泡。历史侧来自 transcript，流式侧来自刚提交还没落库的输入。 */
export function TimelineUserMessage({ item }: { item: TimelineUserItem }) {
  const { t } = useTranslation()

  return (
    <article className="flex justify-end">
      <div className="flex max-w-[min(840px,94%)] flex-col items-end gap-1.5">
        <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
          {item.createdAt ? (
            <span className="text-fg-muted/60 text-[11px]">{formatDate(item.createdAt, 'HH:mm')}</span>
          ) : null}
          <span className="font-medium">{t('ai.sessions.user')}</span>
          <div className="bg-primary/15 text-primary border-primary/20 flex size-5.5 items-center justify-center rounded-full border">
            <User className="size-3.5" />
          </div>
        </div>
        <div className="bg-primary/10 border-primary/20 rounded-2xl rounded-tr-xs border px-4 py-3 sm:px-5 sm:py-3.5">
          <p className="text-fg m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
        </div>
      </div>
    </article>
  )
}
