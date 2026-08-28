'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { Bot, Loader2, Menu } from 'lucide-react'
import type { ChangeEvent } from 'react'

import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'

const selectClass =
  'h-9 border border-input bg-surface px-2.5 text-xs transition-colors outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60'

export interface ChatHeaderProps {
  agentId: string
  agents: AgentDefinitionSummary[]
  onAgentChange: (agentId: string) => void
  onToggleSidebarMobile?: () => void
  running: boolean
  sessionTitle: string
  stopping: boolean
}

/**
 * 右侧对话区域顶部栏：
 * 包含移动端展开侧边栏按钮、当前会话标题、Agent 选择器以及运行状态徽章。
 */
export function ChatHeader({
  agentId,
  agents,
  onAgentChange,
  onToggleSidebarMobile,
  running,
  sessionTitle,
  stopping,
}: ChatHeaderProps) {
  function handleAgentSelect(event: ChangeEvent<HTMLSelectElement>) {
    onAgentChange(event.target.value)
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        {onToggleSidebarMobile ? (
          <Button
            aria-label="打开会话列表"
            className="md:hidden"
            onClick={onToggleSidebarMobile}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Menu aria-hidden="true" size={18} />
          </Button>
        ) : null}

        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-foreground">{sessionTitle}</h2>
          {running ? (
            <Badge
              className="flex shrink-0 items-center gap-1 bg-primary/10 text-primary border-primary/30 text-[10px]"
              variant="outline"
            >
              <Loader2 aria-hidden="true" className="animate-spin" size={10} />
              {stopping ? '正在停止' : '运行中'}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="header-agent-select">
          选择 Agent
        </label>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Bot aria-hidden="true" className="shrink-0 text-primary" size={15} />
          <select
            className={selectClass}
            disabled={running || agents.length === 0}
            id="header-agent-select"
            onChange={handleAgentSelect}
            value={agentId}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  )
}
