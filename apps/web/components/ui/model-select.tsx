'use client'

import type { AiUserModel } from '@starter/contracts'
import { Box, Check, ChevronDown } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { cn } from '@web/lib/utils'

export interface ModelSelectProps {
  /** 选中模型的 providerId: modelId 键；null 表示未选。 */
  selectedKey: string | null
  models: AiUserModel[]
  onModelChange: (model: AiUserModel | null) => void
  disabled?: boolean
  placeholder?: string
  id?: string
  'aria-label'?: string
}

function modelKey(model: AiUserModel): string {
  return `${model.providerId}:${model.modelId}`
}

/**
 * 模型下拉选择：数据源 `GET /api/ai/models`，形态与 AgentSelect 一致。
 * 按 Provider 分组展示，支持键盘导航与点击外部关闭。
 */
export function ModelSelect({
  selectedKey,
  models,
  onModelChange,
  disabled = false,
  placeholder = '选择模型',
  id: customId,
  'aria-label': ariaLabel,
}: ModelSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)
  const generatedId = useId()
  const componentId = customId ?? generatedId
  const menuId = `${componentId}-menu`

  const selectedModel = useMemo(
    () => models.find((model) => modelKey(model) === selectedKey) ?? null,
    [models, selectedKey],
  )

  const groups = useMemo(() => {
    const map = new Map<string, AiUserModel[]>()
    for (const model of models) {
      const list = map.get(model.providerName) ?? []
      list.push(model)
      map.set(model.providerName, list)
    }
    return [...map.entries()]
  }, [models])

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

  useEffect(() => {
    if (isOpen) {
      const activeIdx = models.findIndex((model) => modelKey(model) === selectedKey)
      setHighlightedIndex(activeIdx >= 0 ? activeIdx : 0)
    } else {
      setHighlightedIndex(-1)
    }
  }, [isOpen, models, selectedKey])

  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listboxRef.current) {
      const items = listboxRef.current.querySelectorAll('[role="option"]')
      const targetItem = items[highlightedIndex] as HTMLElement | undefined
      if (targetItem) targetItem.scrollIntoView({ block: 'nearest' })
    }
  }, [isOpen, highlightedIndex])

  function handleSelect(model: AiUserModel) {
    onModelChange(model)
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
        setHighlightedIndex((prev) => (prev < models.length - 1 ? prev + 1 : 0))
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : models.length - 1))
        break
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const model = models[highlightedIndex]
        if (model !== undefined) handleSelect(model)
        break
      }
      case 'Tab': {
        setIsOpen(false)
        break
      }
    }
  }

  return (
    <div className={cn('relative w-full text-left', isOpen ? 'z-50' : 'z-10')} ref={containerRef}>
      <button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? (selectedModel ? `当前选中的模型: ${selectedModel.name}` : placeholder)}
        className={cn(
          'group flex h-11 w-full items-center justify-between border bg-surface text-foreground transition-all duration-150 outline-none rounded px-3 gap-2.5 text-xs md:text-sm',
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
              'grid size-6 shrink-0 place-items-center rounded bg-primary/10 text-primary transition-colors group-hover:bg-primary/20',
            )}
          >
            <Box aria-hidden="true" size={15} />
          </div>
          <span
            className={cn(
              'truncate text-left font-medium',
              selectedModel ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {selectedModel ? `${selectedModel.providerName} / ${selectedModel.name}` : placeholder}
          </span>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-180 text-foreground',
          )}
        />
      </button>

      {isOpen ? (
        <div
          className={cn(
            'absolute top-[calc(100%+4px)] left-0 z-50 max-h-72 w-full min-w-[280px] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/15 backdrop-blur-md',
            'animate-in fade-in-0 zoom-in-95 duration-150',
          )}
        >
          <ul
            aria-activedescendant={highlightedIndex >= 0 ? `${componentId}-opt-${highlightedIndex}` : undefined}
            aria-label="模型选项"
            className="space-y-1 p-0.5"
            id={menuId}
            onKeyDown={handleKeyDown}
            ref={listboxRef}
            role="listbox"
            tabIndex={-1}
          >
            {models.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">暂无可用模型</li>
            ) : (
              groups.map(([providerName, groupModels]) => {
                const baseIndex = models.findIndex((model) => model.providerName === providerName)
                return (
                  <li className="pt-1" key={providerName}>
                    <p className="px-2.5 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {providerName}
                    </p>
                    <ul className="space-y-0.5">
                      {groupModels.map((model) => {
                        const index = baseIndex + groupModels.indexOf(model)
                        const isSelected = selectedKey === modelKey(model)
                        const isHighlighted = highlightedIndex === index
                        return (
                          <li
                            aria-selected={isSelected}
                            className={cn(
                              'group flex w-full cursor-pointer items-start gap-2.5 rounded px-2.5 py-2 text-left transition-colors select-none outline-none',
                              isSelected && 'bg-primary/10 text-primary',
                              isHighlighted && !isSelected && 'bg-surface-muted text-foreground',
                              !isSelected && !isHighlighted && 'text-foreground hover:bg-surface-muted/70',
                            )}
                            id={`${componentId}-opt-${index}`}
                            key={modelKey(model)}
                            onClick={() => handleSelect(model)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            role="option"
                          >
                            <div className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  'block truncate text-xs font-semibold',
                                  isSelected ? 'text-primary' : 'text-foreground',
                                )}
                              >
                                {model.name}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                                {model.modelId}
                              </span>
                            </div>
                            {isSelected ? (
                              <Check aria-hidden="true" className="mt-0.5 shrink-0 text-primary" size={14} />
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
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
