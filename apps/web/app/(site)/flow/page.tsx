import type { Metadata } from 'next'

import { FlowWorkspace } from '../_components/flow/flow-workspace'

export const metadata: Metadata = {
  title: '流程',
  description: '把 Agent 节点编排成流程，逐节点执行并查看每步产出。',
}

export default function FlowPage() {
  return (
    <main className="page-enter mx-auto flex h-[calc(100dvh-7rem)] w-full max-w-[120rem] flex-col px-4 pb-4 md:px-6 lg:px-8">
      <div className="flex min-h-0 flex-1 flex-col">
        <FlowWorkspace className="flex-1" />
      </div>
    </main>
  )
}
