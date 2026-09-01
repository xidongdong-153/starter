'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { Loader2, Menu, PanelLeftOpen } from 'lucide-react'

import { AgentSelect } from '@web/components/ui/agent-select'
import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'

export interface ChatHeaderProps {
  agentId: string
  agents: AgentDefinitionSummary[]
  onAgentChange: (agentId: string) => void
  onToggleSidebarMobile?: () => void
  onToggleSidebarDesktop?: () => void
  isSidebarCollapsed?: boolean
  running: boolean
  sessionTitle: string
  stopping: boolean
}

/**
 * 右侧对话区域顶部栏：
 * 包含移动端与桌面端展开/收起侧边栏按钮、当前会话标题、Agent 选择器以及运行状态徽章。
 */
export function ChatHeader({
  agentId,
  agents,
  onAgentChange,
  onToggleSidebarMobile,
  onToggleSidebarDesktop,
  isSidebarCollapsed = false,
  running,
  sessionTitle,
  stopping,
}: ChatHeaderProps) {
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2.5">
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

        {onToggleSidebarDesktop && isSidebarCollapsed ? (
          <Button
            aria-label="展开会话列表"
            className="hidden md:flex size-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={onToggleSidebarDesktop}
            size="icon"
            title="展开会话列表"
            type="button"
            variant="outline"
          >
            <PanelLeftOpen aria-hidden="true" size={15} />
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
        <AgentSelect
          agentId={agentId}
          agents={agents}
          disabled={running || agents.length === 0}
          id="header-agent-select"
          menuAlign="end"
          onAgentChange={onAgentChange}
          placeholder="选择 Agent"
          size="sm"
        />
      </div>
    </header>
  )
}
