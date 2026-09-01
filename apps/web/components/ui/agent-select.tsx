'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { Bot, Check, ChevronDown, Sparkles } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { Badge } from '@web/components/ui/badge'
import { cn } from '@web/lib/utils'

export interface AgentSelectProps {
  agentId: string
  agents: AgentDefinitionSummary[]
  onAgentChange: (agentId: string) => void
  disabled?: boolean
  placeholder?: string
  allowEmpty?: boolean
  emptyOptionText?: string
  size?: 'sm' | 'default'
  menuAlign?: 'start' | 'end'
  className?: string
  id?: string
  'aria-label'?: string
}

/**
 * 适配 Rose Pine 主题的 Agent 下拉选择菜单：
 * 支持紧凑工具栏尺寸与全宽表单尺寸、键盘导航、无障碍 ARIA 属性及描述信息展示。
 */
export function AgentSelect({
  agentId,
  agents,
  onAgentChange,
  disabled = false,
  placeholder = '选择 Agent',
  allowEmpty = false,
  emptyOptionText = '未选择 Agent',
  size = 'default',
  menuAlign = 'start',
  className,
  id: customId,
  'aria-label': ariaLabel,
}: AgentSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)
  const generatedId = useId()
  const componentId = customId ?? generatedId
  const menuId = `${componentId}-menu`

  const selectedAgent = useMemo(() => agents.find((item) => item.id === agentId) ?? null, [agents, agentId])

  // 可选项目列表（如果 allowEmpty，首项为 null 表示清空/未选）
  const options = useMemo(() => {
    const list: Array<AgentDefinitionSummary | null> = []
    if (allowEmpty) {
      list.push(null)
    }
    list.push(...agents)
    return list
  }, [allowEmpty, agents])

  // 点击外部自动关闭
  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  // 打开时将高亮移动到当前选中的项目
  useEffect(() => {
    if (isOpen) {
      const activeIdx = options.findIndex((opt) => (opt === null ? agentId === '' : opt.id === agentId))
      setHighlightedIndex(activeIdx >= 0 ? activeIdx : 0)
    } else {
      setHighlightedIndex(-1)
    }
  }, [isOpen, options, agentId])

  // 高亮项改变时自动滚动列表
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listboxRef.current) {
      const items = listboxRef.current.querySelectorAll('[role="option"]')
      const targetItem = items[highlightedIndex] as HTMLElement | undefined
      if (targetItem) {
        targetItem.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [isOpen, highlightedIndex])

  function handleSelect(agent: AgentDefinitionSummary | null) {
    const nextId = agent ? agent.id : ''
    onAgentChange(nextId)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement | HTMLUListElement>) {
    if (disabled) return

    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (event.key) {
      case 'Escape': {
        event.preventDefault()
        setIsOpen(false)
        triggerRef.current?.focus()
        break
      }
      case 'ArrowDown': {
        event.preventDefault()
        setHighlightedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0))
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1))
        break
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          handleSelect(options[highlightedIndex] ?? null)
        }
        break
      }
      case 'Tab': {
        setIsOpen(false)
        break
      }
    }
  }

  const isCompact = size === 'sm'
  const isSelectedValid = selectedAgent !== null

  return (
    <div
      className={cn('relative inline-block text-left', isCompact ? 'min-w-[150px]' : 'w-full', className)}
      ref={containerRef}
    >
      {/* 下拉触发器按钮 */}
      <button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? (selectedAgent ? `当前选中的 Agent: ${selectedAgent.name}` : placeholder)}
        className={cn(
          'group flex w-full items-center justify-between border bg-surface text-foreground transition-all duration-150 outline-none rounded',
          isCompact ? 'h-9 px-2.5 gap-2 text-xs' : 'h-11 px-3 gap-2.5 text-xs md:text-sm',
          isOpen
            ? 'border-primary ring-2 ring-ring/40 bg-surface-elevated/40'
            : 'border-input hover:border-primary/50 hover:bg-surface-elevated/60',
          'focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40',
          disabled && 'cursor-not-allowed opacity-50 hover:border-input hover:bg-surface',
        )}
        disabled={disabled}
        id={componentId}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        type="button"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className={cn(
              'grid shrink-0 place-items-center rounded bg-primary/10 text-primary transition-colors group-hover:bg-primary/20',
              isCompact ? 'size-5' : 'size-6',
            )}
          >
            <Bot aria-hidden="true" size={isCompact ? 13 : 15} />
          </div>

          <span
            className={cn(
              'truncate font-medium text-left',
              isSelectedValid ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {isSelectedValid ? selectedAgent.name : allowEmpty && agentId === '' ? emptyOptionText : placeholder}
          </span>
        </div>

        <ChevronDown
          aria-hidden="true"
          className={cn(
            'shrink-0 text-muted-foreground transition-transform duration-200',
            isCompact ? 'size-3.5' : 'size-4',
            isOpen && 'rotate-180 text-foreground',
          )}
        />
      </button>

      {/* 展开的下拉选项列表 */}
      {isOpen ? (
        <div
          className={cn(
            'absolute top-[calc(100%+4px)] z-50 rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/15 backdrop-blur-md',
            menuAlign === 'end' ? 'right-0 min-w-[240px] max-w-[320px]' : 'left-0 w-full min-w-[240px]',
            'animate-in fade-in-0 zoom-in-95 duration-150',
          )}
        >
          <ul
            aria-activedescendant={highlightedIndex >= 0 ? `${componentId}-opt-${highlightedIndex}` : undefined}
            aria-label="Agent 选项"
            className="max-h-64 overflow-y-auto overscroll-contain space-y-0.5 p-0.5"
            id={menuId}
            onKeyDown={handleKeyDown}
            ref={listboxRef}
            role="listbox"
            tabIndex={-1}
          >
            {options.length === 0 ? (
              <li className="py-4 px-3 text-center text-xs text-muted-foreground">暂无可用的 Agent</li>
            ) : (
              options.map((agent, index) => {
                const isSelected = agent === null ? agentId === '' : agent.id === agentId
                const isHighlighted = highlightedIndex === index

                return (
                  <li
                    aria-selected={isSelected}
                    className={cn(
                      'group flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left transition-colors cursor-pointer outline-none select-none',
                      isSelected && 'bg-primary/10 text-primary',
                      isHighlighted && !isSelected && 'bg-surface-muted text-foreground',
                      !isSelected && !isHighlighted && 'text-foreground hover:bg-surface-muted/70',
                    )}
                    id={`${componentId}-opt-${index}`}
                    key={agent?.id ?? '__empty__'}
                    onClick={() => handleSelect(agent)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    role="option"
                  >
                    <div
                      className={cn(
                        'mt-0.5 grid size-5 shrink-0 place-items-center rounded transition-colors',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-surface-muted text-muted-foreground group-hover:text-foreground',
                      )}
                    >
                      {agent === null ? (
                        <Sparkles aria-hidden="true" size={11} />
                      ) : (
                        <Bot aria-hidden="true" size={12} />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'text-xs font-semibold truncate',
                            isSelected ? 'text-primary' : 'text-foreground',
                          )}
                        >
                          {agent === null ? emptyOptionText : agent.name}
                        </span>

                        {agent !== null && agent.status !== 'enabled' ? (
                          <Badge
                            className="text-[9px] px-1 py-0"
                            variant={agent.status === 'draft' ? 'secondary' : 'outline'}
                          >
                            {agent.status === 'draft' ? '草稿' : '已停用'}
                          </Badge>
                        ) : null}
                      </div>

                      {agent?.description ? (
                        <p className="mt-0.5 line-clamp-1 text-[11px] leading-tight text-muted-foreground">
                          {agent.description}
                        </p>
                      ) : null}
                    </div>

                    {isSelected ? (
                      <Check aria-hidden="true" className="mt-0.5 shrink-0 text-primary" size={14} />
                    ) : null}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
