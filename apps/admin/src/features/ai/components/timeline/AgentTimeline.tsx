import type { AgentTimelineItem } from '@admin/features/ai/harness/timeline'

import { TimelineAssistantMessage } from './TimelineAssistantMessage'
import { TimelineCompaction } from './TimelineCompaction'
import { TimelineToolActivity } from './TimelineToolActivity'
import { TimelineUserMessage } from './TimelineUserMessage'

/** 单个时间线元素。流式视图和历史视图共用，保证 Run 进终态时元素位置不变。 */
export function AgentTimelineItemView({ item }: { item: AgentTimelineItem }) {
  switch (item.kind) {
    case 'user':
      return <TimelineUserMessage item={item} />
    case 'message':
      return <TimelineAssistantMessage item={item} />
    case 'tool':
      return <TimelineToolActivity item={item} />
    case 'compaction':
      return <TimelineCompaction item={item} />
  }
}

/** 一条时间线，元素顺序即服务端给出的 sequence 顺序。 */
export function AgentTimeline({ items }: { items: AgentTimelineItem[] }) {
  return (
    <>
      {items.map((item) => (
        <AgentTimelineItemView key={item.key} item={item} />
      ))}
    </>
  )
}
