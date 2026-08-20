import type { AiUsage } from '@starter/contracts'

import type { TimelineMessageItem } from '@admin/features/ai/harness/timeline'
import { formatDate } from '@admin/utils/dayjs'
import { Tag } from 'antd'
import { Bot, Brain, ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MarkdownRenderer } from '../MarkdownRenderer'

/** 默认折叠的思考块。展开后按纯文本显示，不走 Markdown 渲染。 */
function ThinkingBlock({ text }: { text: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-border-subtle/80 bg-surface-muted/40 my-2 overflow-hidden rounded-xl border text-xs">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="hover:bg-surface-muted/70 flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-fg-muted size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-fg-muted size-3.5 shrink-0" />
        )}
        <Brain className="text-primary size-3.5 shrink-0" />
        <span className="text-fg-muted font-medium">{t('ai.sessions.thinking')}</span>
        <span className="text-fg-muted/60 ml-auto text-[11px]">
          {expanded ? t('ai.sessions.collapse') : t('ai.sessions.expand')}
        </span>
      </button>
      {expanded ? (
        <div className="border-border-subtle/60 bg-surface/50 chat-scrollbar max-h-64 overflow-y-auto border-t px-3 py-2 leading-5">
          <p className="text-fg-muted m-0 whitespace-pre-wrap break-words">{text}</p>
        </div>
      ) : null}
    </div>
  )
}

/** token 用量。只显示读到的字段，缺失的不补 0。 */
function UsageSummary({ usage }: { usage: AiUsage }) {
  const { t } = useTranslation()
  const parts: string[] = []
  if (usage.inputTokens !== null) parts.push(`${t('ai.sessions.usage.input')} ${usage.inputTokens}`)
  if (usage.outputTokens !== null) parts.push(`${t('ai.sessions.usage.output')} ${usage.outputTokens}`)
  if (usage.reasoningTokens !== null) parts.push(`${t('ai.sessions.usage.reasoning')} ${usage.reasoningTokens}`)
  if (usage.totalTokens !== null) parts.push(`${t('ai.sessions.usage.total')} ${usage.totalTokens}`)
  if (parts.length === 0) return null

  return (
    <p className="text-fg-muted/70 m-0 px-1 font-mono text-[11px]">
      {t('ai.sessions.usage.label')} · {parts.join(' · ')}
    </p>
  )
}

/**
 * assistant 消息元素：按 blocks 顺序渲染文字与思考块，带状态、模型和 token 用量。
 *
 * 只带 toolCall 的 assistant message 投影出来没有内容块，工具轮每一轮都会产生一条。
 * 这种已完成又没有内容也没有错误码的消息不渲染，否则每个工具卡上方会多一个空气泡。
 */
export function TimelineAssistantMessage({ item }: { item: TimelineMessageItem }) {
  const { t } = useTranslation()
  if (item.completed && item.blocks.length === 0 && !item.errorCode) return null
  const showStatusTag = item.status !== null && item.status !== 'completed'
  const statusColor =
    item.status === 'aborted' || item.status === 'interrupted'
      ? 'warning'
      : item.status === 'failed'
        ? 'error'
        : 'default'

  return (
    <article className="flex justify-start">
      <div className="flex max-w-[min(840px,94%)] flex-col items-start gap-1.5">
        <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
          <div className="bg-surface-muted text-primary border-border-subtle flex size-5.5 items-center justify-center rounded-full border shadow-2xs">
            <Bot className="size-3.5" />
          </div>
          <span className="font-medium">{t('ai.sessions.assistant')}</span>
          {showStatusTag ? (
            <Tag color={statusColor} className="m-0 text-[11px]">
              {t(`ai.sessions.status.${item.status}`)}
            </Tag>
          ) : null}
          {!item.completed ? (
            <Tag color="processing" icon={<LoaderCircle className="size-3 animate-spin" />} className="m-0 text-[11px]">
              {t('ai.sessions.streaming')}
            </Tag>
          ) : null}
          {item.model ? (
            <span className="text-fg-muted/70 hidden font-mono text-[11px] sm:inline">
              {item.model.providerId}/{item.model.modelId}
            </span>
          ) : null}
          {item.createdAt ? (
            <span className="text-fg-muted/60 text-[11px]">{formatDate(item.createdAt, 'HH:mm')}</span>
          ) : null}
        </div>
        {item.blocks.length > 0 || !item.completed ? (
          <div className="border-border-subtle bg-surface rounded-2xl rounded-tl-xs border px-4 py-3 shadow-2xs sm:px-5 sm:py-3.5">
            {item.blocks.length === 0 ? (
              <div className="text-fg-muted flex items-center gap-2 text-sm">
                <LoaderCircle className="text-primary size-4 animate-spin" />
                <span>{t('ai.sessions.generating')}...</span>
              </div>
            ) : (
              item.blocks.map((block, index) =>
                block.type === 'thinking' ? (
                  <ThinkingBlock key={`thinking-${index}`} text={block.text} />
                ) : (
                  <MarkdownRenderer key={`text-${index}`} content={block.text} />
                ),
              )
            )}
          </div>
        ) : null}
        {item.usage ? <UsageSummary usage={item.usage} /> : null}
        {item.errorCode ? (
          <p className="text-danger border-danger/30 bg-danger/5 m-0 mt-1 rounded-lg border p-2 text-xs">
            {item.errorCode}
          </p>
        ) : null}
      </div>
    </article>
  )
}
