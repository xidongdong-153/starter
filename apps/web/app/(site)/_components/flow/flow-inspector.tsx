'use client'

import type {
  AgentDefinitionSummary,
  AgentThinkingLevel,
  AiSkillSummary,
  AiToolSummary,
  AiUserModel,
} from '@starter/contracts'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { AgentSelect } from '@web/components/ui/agent-select'
import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { ModelSelect } from '@web/components/ui/model-select'
import { Textarea } from '@web/components/ui/textarea'
import type { FlowAgentInlineConfig, FlowNode } from '@web/lib/flow/flow-document'
import { FLOW_AGENT_NAME_MAX_LENGTH } from '@web/lib/flow/flow-document'
import { FLOW_INPUT_SAMPLES } from '@web/lib/flow/flow-presets'
import type { FlowStepRunState } from '@web/lib/flow/flow-run'
import { cn } from '@web/lib/utils'

import { FlowPromptEditor } from './flow-prompt-editor'

export interface FlowInspectorProps {
  selectedNode: FlowNode | null
  agents: AgentDefinitionSummary[]
  /** 自定义模式数据源。 */
  models: AiUserModel[]
  tools: AiToolSummary[]
  skills: AiSkillSummary[]
  /** 链上序号，nodeId → 从 0 计的步骤序号。 */
  chainIndex: Map<string, number>
  /** 运行态，nodeId → 步骤状态。 */
  stepStates: Record<string, FlowStepRunState>
  running: boolean
  onNameChange: (nodeId: string, name: string) => void
  onAgentIdChange: (nodeId: string, agentId: string) => void
  /** 切换预设/自定义模式：custom 为 true 时写入默认内联配置，false 时删掉 config 字段。 */
  onModeChange: (nodeId: string, custom: boolean) => void
  onConfigChange: (nodeId: string, config: FlowAgentInlineConfig) => void
  onPromptTemplateChange: (nodeId: string, template: string) => void
  onInputTextChange: (nodeId: string, text: string) => void
  onDeleteNode?: (nodeId: string) => void
  onRetryFrom: (nodeId: string) => void
  onRun?: () => void
  onToggleCollapse?: () => void
  className?: string
}

/**
 * 右侧检查面板：选中 Agent 节点时编辑配置（预设/自定义两种模式、Prompt 模板、变量插入），
 * 并显示该节点的运行态、产出全文和错误信息；选中输入节点时编辑起点输入；支持折叠收起。
 */
export function FlowInspector({
  selectedNode,
  agents,
  models,
  tools,
  skills,
  chainIndex,
  stepStates,
  running,
  onNameChange,
  onAgentIdChange,
  onModeChange,
  onConfigChange,
  onPromptTemplateChange,
  onInputTextChange,
  onDeleteNode,
  onRetryFrom,
  onRun,
  onToggleCollapse,
  className,
}: FlowInspectorProps) {
  if (selectedNode === null) {
    return (
      <aside
        aria-label="节点配置面板"
        className={cn(
          'hidden w-80 shrink-0 flex-col border-l border-border bg-surface-muted/40 transition-all lg:flex',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <span className="text-xs font-semibold text-foreground">配置与详情</span>
          {onToggleCollapse ? (
            <Button
              aria-label="收起检查面板"
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleCollapse}
              size="icon"
              title="收起检查面板"
              type="button"
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" size={15} />
            </Button>
          ) : null}
        </div>
        <div className="flex h-full items-center justify-center p-6 text-center">
          <p className="text-xs text-muted-foreground">点击画布上的节点，在这里配置和查看运行产出。</p>
        </div>
      </aside>
    )
  }

  if (selectedNode.type === 'input') {
    return (
      <aside
        aria-label="输入节点配置"
        className={cn(
          'hidden w-80 shrink-0 flex-col border-l border-border bg-surface-muted/40 transition-all lg:flex',
          className,
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-xs font-semibold text-foreground">起点输入配置</span>
          <div className="flex items-center gap-1">
            {onDeleteNode ? (
              <Button
                aria-label="删除此输入节点"
                className="size-7 p-0 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                onClick={() => onDeleteNode(selectedNode.id)}
                size="icon"
                title="删除此节点"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" size={14} />
              </Button>
            ) : null}
            {onToggleCollapse ? (
              <Button
                aria-label="收起检查面板"
                className="size-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={onToggleCollapse}
                size="icon"
                title="收起检查面板"
                type="button"
                variant="ghost"
              >
                <ChevronRight aria-hidden="true" size={15} />
              </Button>
            ) : null}
          </div>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs" htmlFor="flow-input-text">
                输入内容
              </Label>
              <span className="font-mono text-[10px] text-muted-foreground">⌘+Enter 运行</span>
            </div>
            <Textarea
              className="mt-1.5 min-h-40 text-xs leading-relaxed"
              id="flow-input-text"
              onChange={(event) => onInputTextChange(selectedNode.id, event.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  onRun?.()
                }
              }}
              placeholder="运行流程时，这里的内容作为起点输入..."
              value={selectedNode.data.inputText}
            />
          </div>

          {/* 示例预设快速载入 */}
          <div className="space-y-1.5 rounded border border-border-subtle bg-surface p-2.5">
            <div className="flex items-center gap-1 text-[11px] font-medium text-foreground">
              <Sparkles aria-hidden="true" className="text-primary" size={12} />
              <span>载入测试用例：</span>
            </div>
            <div className="space-y-1">
              {FLOW_INPUT_SAMPLES.map((sample) => (
                <button
                  className="flex w-full flex-col items-start rounded p-1.5 text-left text-xs transition-colors hover:bg-surface-muted"
                  key={sample.id}
                  onClick={() => onInputTextChange(selectedNode.id, sample.content)}
                  type="button"
                >
                  <span className="font-medium text-foreground">{sample.name}</span>
                  <span className="line-clamp-1 text-[10px] text-muted-foreground">{sample.content}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11px] leading-5 text-muted-foreground">
            后续 Agent 节点可在 Prompt 模板中使用 <code className="text-foreground">{'{{input}}'}</code>{' '}
            引用此处的起点内容。
          </p>
        </div>
      </aside>
    )
  }

  const stepIndex = chainIndex.get(selectedNode.id) ?? null
  const runState = stepStates[selectedNode.id] ?? null
  const canRetry = !running && (runState?.status === 'failed' || runState?.status === 'aborted')
  // 节点自定义名称：非空时作为面板标题，空串回落链上序号
  const nodeName =
    selectedNode.type === 'agent' && selectedNode.data.name.trim().length > 0 ? selectedNode.data.name : null

  return (
    <aside
      aria-label="Agent 节点配置"
      className={cn(
        'hidden w-80 shrink-0 flex-col border-l border-border bg-surface-muted/40 transition-all lg:flex',
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-foreground">
            {nodeName ?? `Agent 节点${stepIndex !== null ? ` ${stepIndex + 1}` : ''}`}
          </h2>
          {runState !== null ? <RunStateBadge status={runState.status} /> : null}
        </div>
        <div className="flex items-center gap-1">
          {onDeleteNode ? (
            <Button
              aria-label="删除此 Agent 节点"
              className="size-7 p-0 text-muted-foreground hover:bg-danger/10 hover:text-danger"
              onClick={() => onDeleteNode(selectedNode.id)}
              size="icon"
              title="删除此节点"
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" size={14} />
            </Button>
          ) : null}
          {onToggleCollapse ? (
            <Button
              aria-label="收起检查面板"
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleCollapse}
              size="icon"
              title="收起检查面板"
              type="button"
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" size={15} />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {(() => {
          const node = selectedNode
          if (node.type !== 'agent') return null
          const customMode = node.data.config !== undefined
          const config = node.data.config

          function updateConfig(patch: Partial<FlowAgentInlineConfig>) {
            if (config === undefined) return
            onConfigChange(node.id, { ...config, ...patch })
          }

          const selectedModelKey = config?.model != null ? `${config.model.providerId}:${config.model.modelId}` : null

          return (
            <>
              <div>
                <Label className="text-xs" htmlFor="flow-agent-name">
                  节点名称
                </Label>
                <Input
                  className="mt-1.5 h-9 text-xs"
                  disabled={running}
                  id="flow-agent-name"
                  maxLength={FLOW_AGENT_NAME_MAX_LENGTH}
                  onChange={(event) => onNameChange(node.id, event.target.value)}
                  placeholder="留空时按 Agent 序号显示"
                  value={node.data.name}
                />
              </div>

              <div>
                <Label className="text-xs">配置模式</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-1 rounded border border-border bg-surface p-1">
                  <button
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors',
                      !customMode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                    )}
                    disabled={running}
                    onClick={() => onModeChange(node.id, false)}
                    type="button"
                  >
                    <Bot aria-hidden="true" size={13} />
                    预设 Agent
                  </button>
                  <button
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors',
                      customMode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                    )}
                    disabled={running}
                    onClick={() => onModeChange(node.id, true)}
                    type="button"
                  >
                    <SlidersHorizontal aria-hidden="true" size={13} />
                    自定义配置
                  </button>
                </div>
              </div>

              {customMode && config !== undefined ? (
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs" htmlFor="flow-model-select">
                      模型
                    </Label>
                    <div className="mt-1.5">
                      <ModelSelect
                        disabled={running}
                        id="flow-model-select"
                        models={models}
                        onModelChange={(model) =>
                          updateConfig(
                            model === null
                              ? { model: null }
                              : { model: { providerId: model.providerId, modelId: model.modelId } },
                          )
                        }
                        selectedKey={selectedModelKey}
                      />
                    </div>
                    {config.model === null ? (
                      <p className="mt-1.5 text-[11px] text-warning">尚未选择模型，运行前需要先选择。</p>
                    ) : null}
                  </div>

                  <div>
                    <Label className="text-xs" htmlFor="flow-system-prompt">
                      系统提示词
                    </Label>
                    <Textarea
                      className="mt-1.5 min-h-24 text-xs"
                      disabled={running}
                      id="flow-system-prompt"
                      onChange={(event) => updateConfig({ systemPrompt: event.target.value })}
                      placeholder="告诉这个节点扮演什么角色、按什么规则输出"
                      value={config.systemPrompt}
                    />
                    {config.systemPrompt.trim().length === 0 ? (
                      <p className="mt-1.5 text-[11px] text-warning">系统提示词为空，运行前需要先填写。</p>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs" htmlFor="flow-thinking-level">
                        思考强度
                      </Label>
                      <select
                        aria-label="思考强度"
                        className="mt-1.5 h-9 w-full rounded border border-input bg-surface px-2 text-xs text-foreground outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40"
                        disabled={running}
                        id="flow-thinking-level"
                        onChange={(event) => updateConfig({ thinkingLevel: event.target.value as AgentThinkingLevel })}
                        value={config.thinkingLevel}
                      >
                        <option value="off">off</option>
                        <option value="minimal">minimal</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                        <option value="xhigh">xhigh</option>
                        <option value="max">max</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor="flow-max-turns">
                        最大轮数
                      </Label>
                      <Input
                        className="mt-1.5 h-9 text-xs"
                        id="flow-max-turns"
                        max={32}
                        min={1}
                        onChange={(event) => {
                          const value = Number(event.target.value)
                          updateConfig({
                            maxTurns: Number.isFinite(value) ? Math.min(32, Math.max(1, Math.trunc(value))) : 8,
                          })
                        }}
                        type="number"
                        value={config.maxTurns}
                      />
                    </div>
                  </div>

                  <CheckboxGroup
                    disabled={running}
                    emptyText="暂无可用工具"
                    items={tools.map((tool) => ({
                      key: `${tool.name}@${tool.version}`,
                      label: tool.name,
                      description: tool.description,
                      checked: config.toolRefs.some((ref) => ref.name === tool.name && ref.version === tool.version),
                      onToggle: (checked) => {
                        const ref = { name: tool.name, version: tool.version }
                        const next = checked
                          ? [...config.toolRefs, ref]
                          : config.toolRefs.filter((item) => !(item.name === ref.name && item.version === ref.version))
                        updateConfig({ toolRefs: next })
                      },
                    }))}
                    title="工具"
                  />

                  <CheckboxGroup
                    disabled={running}
                    emptyText="暂无可用技能"
                    items={skills.map((skill) => ({
                      key: skill.id,
                      label: skill.name,
                      description: skill.description,
                      checked: config.skillIds.includes(skill.id),
                      onToggle: (checked) => {
                        const next = checked
                          ? [...config.skillIds, skill.id]
                          : config.skillIds.filter((id) => id !== skill.id)
                        updateConfig({ skillIds: next })
                      },
                    }))}
                    title="技能"
                  />
                </div>
              ) : (
                <div>
                  <Label className="text-xs" htmlFor="flow-agent-select">
                    Agent
                  </Label>
                  <div className="mt-1.5">
                    <AgentSelect
                      agentId={node.data.agentId}
                      agents={agents}
                      allowEmpty
                      disabled={running}
                      emptyOptionText="未选择 Agent"
                      id="flow-agent-select"
                      onAgentChange={(agentId) => onAgentIdChange(node.id, agentId)}
                      placeholder="选择 Agent"
                      size="default"
                    />
                  </div>
                  {node.data.agentId.length === 0 ? (
                    <p className="mt-1.5 text-[11px] text-warning">尚未选择 Agent，运行前需要先选择。</p>
                  ) : null}
                </div>
              )}
            </>
          )
        })()}

        <FlowPromptEditor
          disabled={running}
          onChange={(template) => onPromptTemplateChange(selectedNode.id, template)}
          onRun={onRun}
          stepIndex={stepIndex}
          value={selectedNode.data.promptTemplate}
        />

        {runState !== null ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-foreground">运行状态</p>
            {runState.runId !== null ? (
              <p className="break-all text-[11px] text-muted-foreground">Run: {runState.runId}</p>
            ) : null}
            {runState.output !== null && runState.output.length > 0 ? (
              <div>
                <p className="text-[11px] text-muted-foreground">产出：</p>
                <pre className="mt-1 max-h-64 overflow-y-auto border border-border-subtle bg-surface p-2.5 whitespace-pre-wrap text-[11px] leading-5 text-foreground">
                  {runState.output}
                </pre>
              </div>
            ) : null}
            {runState.status === 'failed' ? (
              <p className="text-[11px] leading-5 text-danger">
                {runState.errorMessage ?? `运行失败：${runState.errorCode ?? '未返回错误码'}`}
              </p>
            ) : null}
            {canRetry ? (
              <Button
                className="w-full gap-1.5"
                onClick={() => onRetryFrom(selectedNode.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" size={14} />
                从此节点重试
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

/** 勾选列表：工具/技能多选共用；条目少时比下拉多选更直观。 */
function CheckboxGroup(props: {
  title: string
  disabled: boolean
  emptyText: string
  items: Array<{
    key: string
    label: string
    description: string
    checked: boolean
    onToggle: (checked: boolean) => void
  }>
}) {
  return (
    <fieldset className="space-y-1.5" disabled={props.disabled}>
      <legend className="text-xs text-foreground">{props.title}</legend>
      {props.items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{props.emptyText}</p>
      ) : (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded border border-border bg-surface p-2">
          {props.items.map((item) => (
            <label
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 transition-colors hover:bg-surface-muted/70',
                props.disabled && 'cursor-not-allowed opacity-60',
              )}
              key={item.key}
            >
              <input
                checked={item.checked}
                className="mt-0.5 size-3.5 shrink-0 accent-[rgb(var(--color-primary))]"
                onChange={(event) => item.onToggle(event.target.checked)}
                type="checkbox"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">{item.label}</span>
                {item.description.length > 0 ? (
                  <span className="mt-0.5 block line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                    {item.description}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

function RunStateBadge({ status }: { status: FlowStepRunState['status'] }) {
  if (status === 'completed') {
    return (
      <Badge className="gap-1 border-success/30 bg-success/10 text-[10px] text-success" variant="outline">
        <CheckCircle2 aria-hidden="true" size={10} />
        完成
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge className="gap-1 border-danger/30 bg-danger/10 text-[10px] text-danger" variant="outline">
        <AlertCircle aria-hidden="true" size={10} />
        失败
      </Badge>
    )
  }
  if (status === 'aborted') {
    return (
      <Badge className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning" variant="outline">
        <CircleStop aria-hidden="true" size={10} />
        已停止
      </Badge>
    )
  }
  return (
    <Badge className="text-[10px]" variant="secondary">
      未运行
    </Badge>
  )
}
