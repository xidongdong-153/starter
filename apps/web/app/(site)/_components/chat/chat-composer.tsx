'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { Send, Square } from 'lucide-react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { Button } from '@web/components/ui/button'
import { Label } from '@web/components/ui/label'
import { Textarea } from '@web/components/ui/textarea'

const selectClass =
  'min-h-11 border border-input bg-surface px-3 text-sm transition-colors outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60'

/**
 * Chat 输入区：Agent 选择、文本框、发送和停止。
 *
 * Enter 发送，Shift+Enter 换行。Run 运行中禁用输入框和发送按钮，只留停止按钮。
 * 停止按钮要等 runId 到位（`run.started` 事件）才可用，否则 abort 接口没有目标。
 */
export function ChatComposer({
  agentId,
  agents,
  canStop,
  onAgentChange,
  onSend,
  onStop,
  onTextChange,
  running,
  stopping,
  text,
}: {
  agentId: string
  agents: AgentDefinitionSummary[]
  canStop: boolean
  onAgentChange: (agentId: string) => void
  onSend: () => void
  onStop: () => void
  onTextChange: (text: string) => void
  running: boolean
  stopping: boolean
  text: string
}) {
  const canSend = !running && text.trim().length > 0 && agentId.length > 0

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (canSend) onSend()
  }

  function handleAgentChange(event: ChangeEvent<HTMLSelectElement>) {
    onAgentChange(event.target.value)
  }

  return (
    <div className="mt-6 border-t border-border pt-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-2">
          <Label className="text-xs text-muted-foreground" htmlFor="chat-agent">
            Agent
          </Label>
          <select
            className={selectClass}
            disabled={running || agents.length === 0}
            id="chat-agent"
            onChange={handleAgentChange}
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

      <Label className="mt-4 block text-xs text-muted-foreground" htmlFor="chat-input">
        发送给 Agent 的内容
      </Label>
      <Textarea
        className="mt-2 min-h-24 resize-y text-sm leading-6"
        disabled={running}
        id="chat-input"
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter 发送，Shift+Enter 换行"
        value={text}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={!canSend} onClick={onSend} type="button">
          <Send aria-hidden="true" size={16} />
          发送
        </Button>
        {running ? (
          <Button
            disabled={stopping || !canStop}
            onClick={onStop}
            title={canStop ? undefined : '等运行启动后可以停止'}
            type="button"
            variant="outline"
          >
            <Square aria-hidden="true" size={16} />
            {stopping ? '正在停止' : '停止生成'}
          </Button>
        ) : null}
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有可用的 Agent，需要先在 Admin 启用一个 Agent。</p>
        ) : null}
      </div>
    </div>
  )
}
