import type { Metadata } from 'next'

import { FlowWorkspace } from '../_components/flow/flow-workspace'

export const metadata: Metadata = {
  title: '流程',
  description: '把 Agent 节点编排成流程，逐节点执行并查看每步产出。',
}

export default function FlowPage() {
  return (
    <main className="page-enter site-container flex h-[calc(100dvh-7rem)] flex-col pb-4">
      <div className="flex min-h-0 flex-1 flex-col">
        <FlowWorkspace className="flex-1" />
      </div>
    </main>
  )
}
