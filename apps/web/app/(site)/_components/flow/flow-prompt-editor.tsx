'use client'

import { Check, ChevronDown, Maximize2, Minimize2, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Button } from '@web/components/ui/button'
import { Label } from '@web/components/ui/label'
import { Textarea } from '@web/components/ui/textarea'
import { FLOW_PROMPT_PRESETS } from '@web/lib/flow/flow-presets'
import { availableVariables } from '@web/lib/flow/flow-template'
import { cn } from '@web/lib/utils'

export interface FlowPromptEditorProps {
  value: string
  stepIndex: number | null
  agentNames?: Map<string, string>
  disabled?: boolean
  onChange: (value: string) => void
  onRun?: () => void
  className?: string
}

interface VariableInfo {
  variable: string
  label: string
  description: string
}

/**
 * 智能 Prompt 模板编辑器：
 * 1. 支持键入 `{` 或 `{{` 触发变量下拉联想；
 * 2. 具名变量胶囊列表一键插入；
 * 3. 常用 Prompt 模式预设一键填入；
 * 4. 沉浸式全屏放大模态编辑；
 * 5. Cmd+Enter / Ctrl+Enter 快捷提交或触发运行。
 */
export function FlowPromptEditor({
  value,
  stepIndex,
  disabled = false,
  onChange,
  onRun,
  className,
}: FlowPromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modalTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPresetOpen, setIsPresetOpen] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [suggestionFilter, setSuggestionFilter] = useState('')
  const presetDropdownId = useId()

  const rawVariables = useMemo(() => {
    return stepIndex === null ? ['{{input}}'] : availableVariables(stepIndex)
  }, [stepIndex])

  const variableItems: VariableInfo[] = useMemo(() => {
    return rawVariables.map((v) => {
      if (v === '{{input}}') {
        return {
          variable: v,
          label: '起点输入',
          description: '流程初始传入的文本内容',
        }
      }
      const match = v.match(/\{\{steps\.(\d+)\.output\}\}/)
      if (match && match[1] !== undefined) {
        const stepNum = Number(match[1]) + 1
        return {
          variable: v,
          label: `Agent ${stepNum} 产出`,
          description: `第 ${stepNum} 步节点的最终生成结果`,
        }
      }
      return { variable: v, label: v, description: '' }
    })
  }, [rawVariables])

  const filteredSuggestions = useMemo(() => {
    if (!suggestionFilter) return variableItems
    const lower = suggestionFilter.toLowerCase()
    return variableItems.filter(
      (item) =>
        item.variable.toLowerCase().includes(lower) ||
        item.label.toLowerCase().includes(lower) ||
        item.description.toLowerCase().includes(lower),
    )
  }, [suggestionFilter, variableItems])

  const insertTextAtCursor = useCallback(
    (textToInsert: string, replacePrefixLen = 0, isModal = false) => {
      const el = isModal ? modalTextareaRef.current : textareaRef.current
      if (!el) {
        onChange(value + textToInsert)
        return
      }

      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      const replaceStart = Math.max(0, start - replacePrefixLen)
      const next = value.slice(0, replaceStart) + textToInsert + value.slice(end)

      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        const newCursorPos = replaceStart + textToInsert.length
        el.setSelectionRange(newCursorPos, newCursorPos)
      })
    },
    [onChange, value],
  )

  const handleApplyPreset = useCallback(
    (presetId: string) => {
      const preset = FLOW_PROMPT_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      const defaultVar = rawVariables[rawVariables.length - 1] ?? '{{input}}'
      const generated = preset.template(defaultVar)
      onChange(generated)
      setIsPresetOpen(false)
    },
    [onChange, rawVariables],
  )

  const checkTrigger = useCallback((text: string, cursorPos: number) => {
    const textBeforeCursor = text.slice(0, cursorPos)
    const match = textBeforeCursor.match(/\{{1,2}([\w.]*)$/)
    if (match) {
      setShowSuggestions(true)
      setSuggestionFilter(match[1] ?? '')
      setActiveSuggestionIndex(0)
    } else {
      setShowSuggestions(false)
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, isModal = false) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onRun?.()
        return
      }

      if (showSuggestions && filteredSuggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveSuggestionIndex((idx) => (idx + 1) % filteredSuggestions.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveSuggestionIndex((idx) => (idx - 1 + filteredSuggestions.length) % filteredSuggestions.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const selected = filteredSuggestions[activeSuggestionIndex]
          if (selected) {
            const el = isModal ? modalTextareaRef.current : textareaRef.current
            const cursorPos = el?.selectionStart ?? value.length
            const textBeforeCursor = value.slice(0, cursorPos)
            const match = textBeforeCursor.match(/\{{1,2}([\w.]*)$/)
            const prefixLen = match ? match[0].length : 0

            insertTextAtCursor(selected.variable, prefixLen, isModal)
            setShowSuggestions(false)
          }
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowSuggestions(false)
        }
      }
    },
    [activeSuggestionIndex, filteredSuggestions, insertTextAtCursor, onRun, showSuggestions, value],
  )

  // 点击外部关闭预设菜单与补全列表
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement | null
      if (!target?.closest(`[data-dropdown-id="${presetDropdownId}"]`)) {
        setIsPresetOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [presetDropdownId])

  return (
    <div className={cn('relative space-y-2', className)}>
      <div className="flex items-center justify-between gap-1.5">
        <Label className="text-xs font-medium text-foreground" htmlFor="flow-prompt-textarea">
          Prompt 模板
        </Label>

        <div className="flex items-center gap-1">
          {/* 预设模板菜单 */}
          <div className="relative" data-dropdown-id={presetDropdownId}>
            <button
              className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              disabled={disabled}
              onClick={() => setIsPresetOpen((prev) => !prev)}
              title="载入常用 Prompt 模板"
              type="button"
            >
              <Sparkles aria-hidden="true" className="text-primary" size={12} />
              <span>常用模板</span>
              <ChevronDown aria-hidden="true" size={11} />
            </button>

            {isPresetOpen ? (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded border border-border bg-surface p-1 shadow-lg backdrop-blur-md">
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">选择模板片段</div>
                <div className="space-y-0.5">
                  {FLOW_PROMPT_PRESETS.map((preset) => (
                    <button
                      className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-muted"
                      key={preset.id}
                      onClick={() => handleApplyPreset(preset.id)}
                      type="button"
                    >
                      <span className="font-medium text-foreground">{preset.name}</span>
                      <span className="line-clamp-1 text-[10px] text-muted-foreground">{preset.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* 全屏放大编辑 */}
          <button
            aria-label="放大编辑"
            className="flex size-6 items-center justify-center rounded border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            onClick={() => setIsFullscreen(true)}
            title="放大编辑 (Focus Mode)"
            type="button"
          >
            <Maximize2 aria-hidden="true" size={12} />
          </button>
        </div>
      </div>

      <div className="relative">
        <Textarea
          className="min-h-40 font-mono text-xs leading-relaxed"
          disabled={disabled}
          id="flow-prompt-textarea"
          onChange={(e) => {
            onChange(e.target.value)
            checkTrigger(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={(e) => handleKeyDown(e, false)}
          placeholder="输入 Prompt 模板，键入 { 或点击下方胶囊插入变量..."
          ref={textareaRef}
          value={value}
        />

        {/* 键入 { 时的浮动联想菜单 */}
        {showSuggestions && filteredSuggestions.length > 0 ? (
          <div className="absolute left-2 top-full z-40 mt-1 max-h-44 w-64 overflow-y-auto rounded border border-border bg-surface p-1 shadow-xl">
            <div className="px-2 py-1 text-[10px] text-muted-foreground">选择变量（回车确认，Esc 取消）</div>
            {filteredSuggestions.map((item, idx) => (
              <button
                className={cn(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors',
                  idx === activeSuggestionIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-surface-muted',
                )}
                key={item.variable}
                onClick={() => {
                  const cursorPos = textareaRef.current?.selectionStart ?? value.length
                  const textBeforeCursor = value.slice(0, cursorPos)
                  const match = textBeforeCursor.match(/\{{1,2}([\w.]*)$/)
                  const prefixLen = match ? match[0].length : 0
                  insertTextAtCursor(item.variable, prefixLen, false)
                  setShowSuggestions(false)
                }}
                type="button"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-[11px] font-semibold">{item.variable}</span>
                  <span
                    className={cn(
                      'text-[10px]',
                      idx === activeSuggestionIndex ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {item.label}
                  </span>
                </div>
                {idx === activeSuggestionIndex ? <Check size={12} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* 变量胶囊快速插入栏 */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>可用变量（点击即插入）：</span>
          <span className="font-mono text-[10px]">快捷键: ⌘+Enter 运行</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {variableItems.map((item) => (
            <button
              className="flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary transition-all hover:bg-primary/15 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              disabled={disabled}
              key={item.variable}
              onClick={() => insertTextAtCursor(item.variable, 0, false)}
              title={`${item.label}: ${item.description}`}
              type="button"
            >
              <span className="font-medium">{item.label}</span>
              <span className="font-mono text-[10px] text-primary/70">{item.variable}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 全屏放大编辑模态弹窗 */}
      {isFullscreen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-surface shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-surface-muted/50">
              <div className="flex items-center gap-2">
                <Sparkles className="text-primary" size={16} />
                <span className="text-sm font-semibold text-foreground">Prompt 模板沉浸式编辑</span>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => setIsFullscreen(false)} size="sm" type="button" variant="ghost">
                  <Minimize2 aria-hidden="true" size={14} />
                  <span>完成并返回</span>
                </Button>
                <button
                  aria-label="关闭弹窗"
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                  onClick={() => setIsFullscreen(false)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 p-4 flex flex-col gap-3 min-h-0 bg-surface">
              <Textarea
                autoFocus
                className="flex-1 resize-none font-mono text-sm leading-relaxed p-4 border-border"
                onChange={(e) => {
                  onChange(e.target.value)
                  checkTrigger(e.target.value, e.target.selectionStart)
                }}
                onKeyDown={(e) => handleKeyDown(e, true)}
                placeholder="输入完整的 Prompt 模板..."
                ref={modalTextareaRef}
                value={value}
              />

              <div className="flex items-center justify-between border-t border-border-subtle pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">插入变量:</span>
                  {variableItems.map((item) => (
                    <button
                      className="flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary transition-all hover:bg-primary/20 hover:border-primary"
                      key={item.variable}
                      onClick={() => insertTextAtCursor(item.variable, 0, true)}
                      type="button"
                    >
                      <span>{item.label}</span>
                      <span className="font-mono text-[10px] text-primary/70">{item.variable}</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">⌘+Enter 运行流程</span>
                  <Button onClick={() => setIsFullscreen(false)} size="sm" type="button">
                    确定
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
