'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { Send, Square } from 'lucide-react'
import type { ChangeEvent, KeyboardEvent } from 'react'

const controlBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60'

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
          <label className="text-xs text-muted-foreground" htmlFor="chat-agent">
            Agent
          </label>
          <select
            className="min-h-11 rounded-sm border border-border bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
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

      <label className="mt-4 block text-xs text-muted-foreground" htmlFor="chat-input">
        发送给 Agent 的内容
      </label>
      <textarea
        className="mt-2 min-h-24 w-full resize-y rounded-sm border border-border bg-surface px-3 py-2 text-sm leading-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        disabled={running}
        id="chat-input"
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter 发送，Shift+Enter 换行"
        value={text}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className={`${controlBase} bg-primary text-primary-foreground`}
          disabled={!canSend}
          onClick={onSend}
          type="button"
        >
          <Send aria-hidden="true" size={16} />
          发送
        </button>
        {running ? (
          <button
            className={`${controlBase} border border-border bg-surface`}
            disabled={stopping || !canStop}
            onClick={onStop}
            title={canStop ? undefined : '等运行启动后可以停止'}
            type="button"
          >
            <Square aria-hidden="true" size={16} />
            {stopping ? '正在停止' : '停止生成'}
          </button>
        ) : null}
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有可用的 Agent，需要先在 Admin 启用一个 Agent。</p>
        ) : null}
      </div>
    </div>
  )
}
