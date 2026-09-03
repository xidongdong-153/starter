import {
  Agent,
  DEFAULT_COMPACTION_SETTINGS,
  buildSessionContext,
  compact,
  convertToLlm,
  estimateContextTokens,
  prepareCompaction,
  shouldCompact,
} from '@earendil-works/pi-agent-core'
import type { AgentMessage, CompactionSettings, Entry, StreamFn } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Context, Model, Models, SimpleStreamOptions, Usage } from '@earendil-works/pi-ai'
import { NOOP_TELEMETRY_CONTEXT } from '@earendil-works/pi-telemetry'
import { ApiErrorCodes } from '@starter/contracts'
import type {
  AgentDefinitionConfig,
  AiCost,
  AiModelCallResult,
  AiModelCallStopReason,
  AiModelRef,
  AiUsage,
  ApiErrorCode,
  RunEvent,
  Permission,
} from '@starter/contracts'
import type { RunEventDraft } from '@api/modules/ai/run/run-event.repository.js'
import {
  createStructuredOutputTool,
  type StructuredOutputRuntime,
} from '@api/modules/ai/output/structured-output.tool.js'
import type { ResolvedAiOutputContract } from '@api/modules/ai/output/output-contract-registry.js'

import type { AiRunLifecycleRepository } from '@api/modules/ai/run/run-lifecycle.repository.js'
import type { AppLogger } from '@api/infra/log/index.js'
import type { AiSpan, AiSpanEndAttributes, AiSpanScope, AiTelemetryTarget } from '@api/infra/telemetry/index.js'
import { openAiSpanScope, startAiSpan } from '@api/infra/telemetry/index.js'
import { createRunEventDraft, type RunExecutionContext, type RunStepState } from './run-execution-context.js'
import { isAiRetryableErrorCode, toAiErrorCategory } from '@api/modules/ai/ai-error.js'

import type { RegisteredAiTool } from '@api/modules/ai/tool/tool-registry.js'
import { createPiNativeStreamFn } from '@api/infra/ai/pi-native-stream.js'
import type { PiModelCallAudit, PiModelCallFact, PiStreamFailure } from '@api/infra/ai/pi-native-stream.js'
import { generateId } from '@api/shared/id.js'

import type { AgentControlImage, AgentControlMessage, AttachableActiveRunControls } from './active-run-registry.js'
import type { AgentSessionHandle, AgentSessionStore } from './pi-session-store.js'
import { AsyncEventQueue, PiEventMapper } from './pi-event-mapper.js'
import { createPiToolAdapter, type PiToolExecutionAudit } from './pi-tool-adapter.js'

export interface ResolvedAgentExecutorConfig {
  model: AiModelRef
  systemPrompt?: string
  thinkingLevel?: AgentDefinitionConfig['thinkingLevel']
  maxTurns: number
  /** Run 启动时已解析的 Tool 定义；Executor 不再按名称查询 Registry。 */
  tools: readonly RegisteredAiTool[]
  outputContract?: ResolvedAiOutputContract | null
  structuredOutput?: StructuredOutputRuntime
}

export interface AgentExecutorInput {
  /** Run Service 创建的关联上下文；Run、Session、lane、principal 和 scope 都从它读。 */
  execution: RunExecutionContext
  input: string
  /** 首条 user message 附带的图片块（base64）；无附件时省略，纯文本路径不变。 */
  images?: readonly AgentControlImage[]
  signal?: AbortSignal
  /** Run span 作用域；Turn、Step、Model Call 和 Tool span 都挂在它下面。 */
  telemetry?: AiTelemetryTarget
  config: ResolvedAgentExecutorConfig
}

export type ExecutorTerminalStatus = 'completed' | 'failed' | 'aborted'

export type ExecutorCompletionReason = Extract<RunEvent, { type: 'run.completed' }>['data']['reason']

export interface ExecutorTerminalResult {
  status: ExecutorTerminalStatus
  finalEntryId: string | null
  errorCode: ApiErrorCode | null
  /**
   * 只有 completed 终态有意义：`model_finished` 是模型给出普通回答，
   * `max_turns` 是收尾轮回答，`structured_output` 是终止型 Tool 已发布结果。
   */
  completionReason?: ExecutorCompletionReason
}

export interface PreparedAgentExecution {
  readonly controls: AttachableActiveRunControls
  readonly events: AsyncIterable<RunEventDraft>
  readonly eventStream: AsyncIterable<RunEventDraft>
  readonly result: Promise<ExecutorTerminalResult>
  readonly terminalResult: Promise<ExecutorTerminalResult>
  readonly start: () => Promise<void>
}

export interface PiAgentExecutorOptions {
  sessionStore: AgentSessionStore
  models?: Models
  resolveModel?: (model: AiModelRef) => Model<Api> | undefined
  streamFn?: StreamFn
  hasPermission?: (userId: string, permission: Permission) => Promise<boolean>
  getProviderRequestEnv?: (providerId: string) => Record<string, string>
  audit?: PiModelCallAudit
  toolAudit?: PiToolExecutionAudit
  lifecycle?: AiRunLifecycleRepository
  /** 安全日志出口；当前只用于记录被拒绝的工具上报数据。 */
  logger?: AppLogger
  requestTimeoutMs?: number
  maxRunMs?: number
  compaction?: Partial<CompactionSettings>
}

export class AgentExecutorError extends Error {
  constructor(readonly kind: 'not_attached' | 'already_started') {
    super(`Pi Agent executor error: ${kind}`)
    this.name = 'AgentExecutorError'
  }
}

export class PiAgentExecutor {
  constructor(private readonly options: PiAgentExecutorOptions) {}

  prepare(input: AgentExecutorInput): PreparedAgentExecution {
    const events = new AsyncEventQueue<RunEventDraft>()
    const execution = input.execution
    const lifecycle = this.options.lifecycle
    let attached = false
    let started = false
    let agent: Agent | undefined
    let session: AgentSessionHandle | undefined
    let unsubscribe: (() => void) | undefined
    let callerAbortListener: (() => void) | undefined
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    let deadlineAt: number | undefined
    let abortRequested = false
    let turns = 0
    let summaryPlanned = false
    let structuredOutputEmitted = false
    /** 本次 attempt 的顶层 agent Step（turnId=NULL）；outcome 与执行终态一致。 */
    let agentStepId: string | undefined
    let settledTerminal: ExecutorTerminalResult | undefined
    const runTelemetry: AiTelemetryTarget = input.telemetry ?? NOOP_TELEMETRY_CONTEXT
    let turnScope: AiSpanScope<'starter.ai.turn'> | null = null
    let stepScope: AiSpanScope<'starter.ai.step'> | null = null
    let compactionTelemetry: AiTelemetryTarget | null = null
    /** 模型请求和 Tool 执行的 span parent，读取时才解析当前 Step。 */
    const telemetryParent = (): AiTelemetryTarget => stepScope?.span ?? turnScope?.span ?? runTelemetry
    let latestModelFailure: PiStreamFailure | undefined
    let terminalOverride: ExecutorTerminalResult | undefined
    /**
     * Pi `turn_end` 只知道 assistant 的 stopReason。Run deadline 超时、Tool 终止失败
     * 和 Session 存储失败发生在事件流之外，用 executor 已记录的信号覆盖。
     */
    const resolveLifecycleOutcome = (base: 'succeeded' | 'failed' | 'aborted'): 'succeeded' | 'failed' | 'aborted' => {
      if (base !== 'succeeded') return base
      if (terminalOverride && terminalOverride.status !== 'completed') {
        return terminalOverride.status === 'aborted' ? 'aborted' : 'failed'
      }
      if (latestModelFailure) {
        return latestModelFailure.kind === 'aborted' ? 'aborted' : 'failed'
      }
      return 'succeeded'
    }
    const lifecycleErrorCode = (): ApiErrorCode | null =>
      terminalOverride?.errorCode ?? latestModelFailure?.errorCode ?? null
    const closeTurnScopes = (outcome: 'succeeded' | 'failed' | 'aborted'): void => {
      const failed = outcome !== 'succeeded'
      const errorCode = lifecycleErrorCode()
      const stepAttributes: AiSpanEndAttributes<'starter.ai.step'> =
        failed && errorCode
          ? {
              'starter.ai.step.outcome': outcome,
              'starter.ai.error.code': errorCode,
            }
          : { 'starter.ai.step.outcome': outcome }
      stepScope?.close({
        attributes: stepAttributes,
        ...(failed ? { status: { status: 'error' as const } } : {}),
      })
      stepScope = null
      turnScope?.close({
        attributes: { 'starter.ai.turn.outcome': outcome },
        ...(failed ? { status: { status: 'error' as const } } : {}),
      })
      turnScope = null
    }
    /** Run 结束前兜底关闭遗留的 running Turn / Step，不留未解释的执行记录。 */
    const sweepRunningLifecycle = (outcome: 'failed' | 'aborted', errorCode: string | null): void => {
      if (!lifecycle) return
      try {
        const running = lifecycle.listRunning(execution.runId)
        const finishedAt = new Date()
        for (const stepId of running.steps) {
          lifecycle.completeStep(stepId, outcome, errorCode, finishedAt)
        }
        for (const turnId of running.turns) {
          lifecycle.completeTurn(turnId, outcome, finishedAt)
        }
      } catch {
        // 兜底关闭失败不能改写 Run 终态，留给启动恢复处理。
      }
    }
    const pendingSteers: AgentMessage[] = []
    const pendingFollowUps: AgentMessage[] = []
    const transcript: Entry[] = []
    let resolveResult!: (result: ExecutorTerminalResult) => void
    const result = new Promise<ExecutorTerminalResult>((resolve) => {
      resolveResult = resolve
    })
    /** 终态落定前记录，finally 里用它收尾 agent Step。 */
    const settle = (terminal: ExecutorTerminalResult) => {
      settledTerminal = terminal
      resolveResult(terminal)
    }

    const controls: AttachableActiveRunControls = {
      attach() {
        if (attached) throw new AgentExecutorError('already_started')
        attached = true
      },
      isAttached() {
        return attached
      },
      abort() {
        abortRequested = true
        agent?.abort()
      },
      steer(message: AgentControlMessage) {
        const userMsg = userMessageWithImages(message)
        if (agent) agent.steer(userMsg)
        else pendingSteers.push(userMsg)
      },
      followUp(message: AgentControlMessage) {
        const userMsg = userMessageWithImages(message)
        if (agent) agent.followUp(userMsg)
        else pendingFollowUps.push(userMsg)
      },
    }

    const start = async (): Promise<void> => {
      if (started) throw new AgentExecutorError('already_started')
      if (!attached) throw new AgentExecutorError('not_attached')
      started = true
      callerAbortListener = () => {
        abortRequested = true
        agent?.abort()
      }
      input.signal?.addEventListener('abort', callerAbortListener, {
        once: true,
      })
      if (input.signal?.aborted) abortRequested = true
      try {
        // 每个 attempt 一条顶层 agent Step：不属于任何 turn，outcome 随本次执行终态；
        // run 终态事务会在 fenced/重写时把它强制改为最终状态。
        agentStepId = generateId()
        lifecycle?.beginStep({
          id: agentStepId,
          runId: execution.runId,
          turnId: null,
          kind: 'agent',
          attempt: execution.attemptNo,
          attemptNo: execution.attemptNo,
          startedAt: new Date(),
        })
        if (abortRequested) {
          settle({
            status: 'aborted',
            finalEntryId: null,
            errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
          })
          return
        }
        try {
          session = await this.options.sessionStore.openSession(execution.sessionId)
          transcript.push(...(await session.readTranscript({ lane: execution.lane })))
        } catch {
          if (!abortRequested) {
            terminalOverride = {
              status: 'failed',
              finalEntryId: null,
              errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
            }
          }
          throw new Error('Agent Session 读取失败')
        }
        if (abortRequested) {
          settle({
            status: 'aborted',
            finalEntryId: null,
            errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
          })
          return
        }

        const maxRunMs = this.options.maxRunMs ?? 120_000
        deadlineAt = Date.now() + maxRunMs
        const config = input.config
        const modelRef = config.model
        const model = resolveModel(this.options, modelRef)
        if (!model) {
          terminalOverride = {
            status: 'failed',
            finalEntryId: null,
            errorCode: ApiErrorCodes.AI_MODEL_NOT_FOUND,
          }
          settle(terminalOverride)
          return
        }
        const compactionSettings = resolveCompactionSettings(this.options.compaction)
        let mapper!: PiEventMapper
        const configuredTools =
          config.outputContract && config.structuredOutput
            ? [
                ...config.tools,
                createStructuredOutputTool(config.outputContract, {
                  ...config.structuredOutput,
                  publish: (event) => {
                    config.structuredOutput?.publish(event)
                    structuredOutputEmitted = true
                  },
                }),
              ]
            : config.tools
        const toolAdapter = createPiToolAdapter(configuredTools, {
          execution,
          hasPermission: this.options.hasPermission ?? (async () => false),
          getRemainingRunMs: () => remainingRunMs(deadlineAt),
          getTelemetryParent: telemetryParent,
          audit: this.options.toolAudit,
          ...(this.options.logger ? { logger: this.options.logger } : {}),
          onSource: (fact) => {
            // 工具上报的 source 已经过服务端校验，这里只转成产品事件。
            events.push(mapper.sourceAvailableEvent(fact))
          },
          onTerminalFailure: (reason) => {
            if (terminalOverride) return
            terminalOverride = {
              status: reason === 'cancelled' ? 'aborted' : 'failed',
              finalEntryId: mapper.lastAssistantEntryId,
              errorCode:
                reason === 'storage_failed'
                  ? ApiErrorCodes.AI_SESSION_STORAGE_FAILED
                  : reason === 'timed_out'
                    ? ApiErrorCodes.AI_TOOL_TIMED_OUT
                    : ApiErrorCodes.AI_REQUEST_ABORTED,
            }
            agent?.abort()
          },
        })

        mapper = new PiEventMapper({
          session,
          execution,
          maxTurns: config.maxTurns,
          thinkingLevel: config.thinkingLevel ?? 'off',
          getAssistantErrorCode: () => terminalOverride?.errorCode ?? latestModelFailure?.errorCode ?? null,
          onEntryAppended: (entry) => transcript.push(entry),
          onToolExecutionStart: (toolInput) => toolAdapter.onToolExecutionStart(toolInput),
          onTurnStart: (turnIndex) => {
            const turnId = execution.beginTurn(turnIndex)
            lifecycle?.beginTurn({
              id: turnId,
              runId: execution.runId,
              turnIndex,
              attemptNo: execution.attemptNo,
              startedAt: new Date(),
            })
            turnScope = openAiSpanScope(runTelemetry, 'starter.ai.turn', {
              'starter.ai.run.id': execution.runId,
              'starter.ai.turn.id': turnId,
              'starter.ai.turn.index': turnIndex,
            })
            const stepId = execution.beginStep('assistant', execution.attemptNo)
            lifecycle?.beginStep({
              id: stepId,
              runId: execution.runId,
              turnId,
              kind: 'assistant',
              attempt: execution.attemptNo,
              attemptNo: execution.attemptNo,
              startedAt: new Date(),
            })
            stepScope = openAiSpanScope(turnScope.span, 'starter.ai.step', {
              'starter.ai.run.id': execution.runId,
              'starter.ai.turn.id': turnId,
              'starter.ai.step.id': stepId,
              'starter.ai.step.kind': 'assistant',
              'starter.ai.step.attempt': execution.attemptNo,
            })
          },
          onTurnEnd: (piOutcome) => {
            const outcome = resolveLifecycleOutcome(piOutcome)
            const finishedAt = new Date()
            const step = execution.endStep()
            const errorCode = outcome === 'succeeded' ? null : lifecycleErrorCode()
            if (step) {
              lifecycle?.completeStep(step.id, outcome, errorCode, finishedAt)
            }
            const turnId = execution.endTurn()
            if (turnId) lifecycle?.completeTurn(turnId, outcome, finishedAt)
            closeTurnScopes(outcome)
            return { outcome, step, errorCode }
          },
          onToolExecutionEnd: (toolInput) => toolAdapter.onToolExecutionEnd(toolInput),
        })

        const streamFn =
          this.options.streamFn ??
          this.createStreamFn(
            execution,
            (fact) => {
              if (fact.kind === 'started') execution.setModelCall(fact.modelCallId)
              events.push(modelCallEvent(execution, fact))
            },
            (failure) => {
              latestModelFailure = failure
            },
            telemetryParent,
          )
        const instrumentedModels = this.options.models
          ? createInstrumentedModels(
              this.options.models,
              this.options.audit,
              execution,
              modelRef,
              this.options.requestTimeoutMs ?? 60_000,
              () => compactionTelemetry ?? runTelemetry,
            )
          : undefined
        let initialMessages: AgentMessage[]
        try {
          initialMessages = buildSessionContext(transcript).messages
        } catch {
          if (!abortRequested) {
            terminalOverride = {
              status: 'failed',
              finalEntryId: null,
              errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
            }
          }
          throw new Error('Agent Session context 读取失败')
        }
        agent = new Agent({
          initialState: {
            systemPrompt: config.systemPrompt ?? '',
            model,
            thinkingLevel: config.thinkingLevel ?? 'off',
            messages: initialMessages,
            tools: [...toolAdapter.tools],
          },
          convertToLlm: (messages) => convertToLlm(sanitizeToolErrors(messages)),
          streamFn,
          sessionId: execution.sessionId,
          toolExecution: 'parallel',
          afterToolCall: toolAdapter.afterToolCall,
          // Pi 的回调顺序是 turn_end -> prepareNextTurn -> shouldStopAfterTurn，
          // 所以清空工具只能在 prepareNextTurn 里做，停或不停由 shouldStopAfterTurn 决定。
          prepareNextTurnWithContext: ({ context, message }) => {
            if (summaryPlanned) return undefined
            // shouldStopAfterTurn 还没加，刚结束的这一轮是第 turns + 1 轮。
            if (turns + 1 < config.maxTurns) return undefined
            // 判据是刚结束那一轮 assistant message 里的 toolCall block，
            // 与 Pi agent loop 判断是否还要继续的依据一致。
            if (!hasToolCalls(message)) return undefined
            summaryPlanned = true
            return {
              context: {
                ...context,
                tools: [],
                messages: [...context.messages, summaryHintMessage()],
              },
            }
          },
          shouldStopAfterTurn: async () => {
            turns += 1
            if (turns < config.maxTurns) return false
            // 撞顶那一轮安排了收尾轮，就再放一轮无工具的模型请求。
            return !(summaryPlanned && turns === config.maxTurns)
          },
          transformContext: async (messages, signal) => {
            return compactIfNeeded({
              messages,
              transcript,
              session,
              lane: execution.lane,
              model,
              models: instrumentedModels,
              settings: compactionSettings,
              thinkingLevel: config.thinkingLevel ?? 'off',
              signal,
              telemetry: {
                parent: turnScope?.span ?? runTelemetry,
                runId: execution.runId,
                turnId: execution.turnId,
                attemptNo: execution.attemptNo,
                onStepSpan: (span) => {
                  compactionTelemetry = span
                },
              },
              lifecycle,
              onFailure: (errorCode) => {
                terminalOverride = {
                  status: 'failed',
                  finalEntryId: mapper.lastAssistantEntryId,
                  errorCode,
                }
              },
              onStepStarted: (step) => {
                events.push(mapper.stepStartedEvent(step))
              },
              onStepCompleted: (step, outcome, errorCode) => {
                events.push(mapper.stepCompletedEvent({ step, outcome, errorCode }))
              },
              onCompacted: (info) => {
                // 发事件失败不能影响 compaction 结果本身。
                try {
                  events.push(mapper.contextCompactedEvent(info))
                } catch {
                  // 忽略：compaction 已成功写入 Pi transcript。
                }
              },
            })
          },
        })

        unsubscribe = agent.subscribe(async (event, signal) => {
          try {
            const mapped = await mapper.map(event, signal)
            for (const mappedEvent of mapped) events.push(mappedEvent)
          } catch {
            terminalOverride = {
              status: 'failed',
              finalEntryId: mapper.lastAssistantEntryId,
              errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
            }
            throw new Error('Agent Session 写入失败')
          }
        })

        deadlineTimer = setTimeout(
          () => {
            terminalOverride = {
              status: 'failed',
              finalEntryId: mapper.lastAssistantEntryId,
              errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
            }
            agent?.abort()
          },
          Math.max(1, (deadlineAt ?? Date.now()) - Date.now()),
        )

        for (const message of pendingSteers) agent.steer(message)
        for (const message of pendingFollowUps) agent.followUp(message)
        pendingSteers.length = 0
        pendingFollowUps.length = 0

        if (abortRequested) {
          settle({
            status: 'aborted',
            finalEntryId: null,
            errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
          })
          return
        }

        const prompt =
          input.images && input.images.length > 0
            ? agent.prompt(
                userMessageWithImages({
                  text: input.input,
                  images: input.images,
                }),
              )
            : agent.prompt(input.input)
        if (abortRequested) agent.abort()
        await prompt
        const terminal = resolveTerminalResult(
          mapper,
          abortRequested || input.signal?.aborted === true,
          terminalOverride,
          latestModelFailure,
          structuredOutputEmitted ? 'structured_output' : summaryPlanned ? 'max_turns' : 'model_finished',
        )
        settle(terminal)
      } catch {
        const terminal =
          terminalOverride ??
          ({
            status: abortRequested ? 'aborted' : 'failed',
            finalEntryId: null,
            errorCode: abortRequested ? ApiErrorCodes.AI_REQUEST_ABORTED : ApiErrorCodes.AI_UPSTREAM_ERROR,
          } satisfies ExecutorTerminalResult)
        settle(terminal)
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer)
        if (callerAbortListener) {
          input.signal?.removeEventListener('abort', callerAbortListener)
        }
        unsubscribe?.()
        // agent Step 收尾：outcome 与本次执行终态一致；
        // run 终态事务可能把它改写为 interrupted。
        if (agentStepId) {
          const agentOutcome =
            settledTerminal?.status === 'completed'
              ? 'succeeded'
              : settledTerminal?.status === 'aborted'
                ? 'aborted'
                : 'failed'
          lifecycle?.completeStep(agentStepId, agentOutcome, settledTerminal?.errorCode ?? null, new Date())
        }
        // Pi 没有发出 turn_end 时也要结束 span，不能留下未结束的作用域。
        const sweepOutcome = abortRequested ? 'aborted' : 'failed'
        closeTurnScopes(sweepOutcome)
        sweepRunningLifecycle(sweepOutcome, lifecycleErrorCode())
        events.end()
      }
    }

    return {
      controls,
      events,
      eventStream: events,
      result,
      terminalResult: result,
      start,
    }
  }

  private createStreamFn(
    execution: RunExecutionContext,
    onModelCallFact: (fact: PiModelCallFact) => void,
    onFailure: (failure: PiStreamFailure) => void,
    getTelemetryParent: () => AiTelemetryTarget,
  ): StreamFn {
    if (!this.options.models) {
      throw new Error('Pi Agent executor 需要 models 或 streamFn')
    }
    return createPiNativeStreamFn({
      models: this.options.models,
      timeoutMs: this.options.requestTimeoutMs ?? 60_000,
      execution,
      getTelemetryParent,
      getProviderRequestEnv: this.options.getProviderRequestEnv,
      audit: this.options.audit,
      onModelCallFact,
      onFailure,
    }) as StreamFn
  }
}

/** Model Call 事实转产品事件；只带安全字段，不带 Provider payload 和原始错误。 */
function modelCallEvent(execution: RunExecutionContext, fact: PiModelCallFact): RunEventDraft {
  switch (fact.kind) {
    case 'started':
      return createRunEventDraft(execution, 'model_call.started', {
        providerId: fact.providerId,
        modelId: fact.modelId,
        api: fact.api,
        streaming: true,
      })
    case 'first_output':
      return createRunEventDraft(execution, 'model_call.first_output', {
        elapsedMs: fact.elapsedMs,
      })
    case 'completed':
      return createRunEventDraft(execution, 'model_call.completed', {
        responseModel: fact.responseModel,
        responseId: fact.responseId,
        stopReason: fact.stopReason,
        usage: fact.usage,
        cost: fact.cost,
      })
    case 'failed':
      return createRunEventDraft(execution, 'model_call.failed', {
        error: {
          code: fact.errorCode,
          category: toAiErrorCategory(fact.errorCode),
          retryable: isAiRetryableErrorCode(fact.errorCode),
        },
      })
  }
}

export function createPiAgentExecutor(options: PiAgentExecutorOptions): PiAgentExecutor {
  return new PiAgentExecutor(options)
}

function resolveModel(options: PiAgentExecutorOptions, modelRef: AiModelRef): Model<Api> | undefined {
  try {
    return options.resolveModel?.(modelRef) ?? options.models?.getModel(modelRef.providerId, modelRef.modelId)
  } catch {
    return undefined
  }
}

function userMessage(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: Date.now() }
}

/**
 * 带图片的 user message：content 为 text 块 + image 块数组；顶层 attachmentIds
 * 与 runId 挂载同模式附加，Pi 原样持久化，transcript 回放时反查。
 */
function userMessageWithImages(input: AgentControlMessage): AgentMessage {
  const { text, images } = input
  if (!images || images.length === 0) return userMessage(text)
  const attachmentIds = images.every((image) => image.attachmentId)
    ? images.map((image) => image.attachmentId as string)
    : undefined
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...images.map((image) => ({
        type: 'image',
        data: image.data,
        mimeType: image.mimeType,
      })),
    ],
    timestamp: Date.now(),
    ...(attachmentIds ? { attachmentIds } : {}),
  } as unknown as AgentMessage
}

function hasToolCalls(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === 'toolCall')
}

/**
 * 收尾轮提示只进内存 context，不经过 message_start / message_end，
 * 因此不会写入 Pi transcript。
 */
function summaryHintMessage(): AgentMessage {
  return userMessage(
    'Tools are no longer available for this run. Answer the user directly in text, based on the tool results you already have.',
  )
}

function resolveCompactionSettings(settings: Partial<CompactionSettings> | undefined): CompactionSettings {
  return {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...settings,
  }
}

async function compactIfNeeded(input: {
  messages: AgentMessage[]
  transcript: import('@earendil-works/pi-agent-core').Entry[]
  session: AgentSessionHandle | undefined
  lane: string
  model: Model<Api>
  models: Models | undefined
  settings: CompactionSettings
  thinkingLevel: AgentDefinitionConfig['thinkingLevel']
  signal?: AbortSignal
  telemetry: {
    parent: AiTelemetryTarget
    runId: string
    turnId: string | null
    attemptNo: number
    onStepSpan: (span: AiSpan<'starter.ai.step'> | null) => void
  }
  lifecycle?: AiRunLifecycleRepository
  onFailure: (errorCode: ApiErrorCode) => void
  /** compaction Step 开始事实；发事件失败不能影响 compaction 本身。 */
  onStepStarted?: (step: RunStepState) => void
  onStepCompleted?: (
    step: RunStepState,
    outcome: 'succeeded' | 'failed' | 'deferred',
    errorCode: ApiErrorCode | null,
  ) => void
  onCompacted: (info: { entryId: string; tokensBefore: number; summary: string; stepId: string }) => void
}): Promise<AgentMessage[]> {
  if (
    !input.models ||
    !input.session ||
    !shouldCompact(estimateContextTokens(input.messages).tokens, input.model.contextWindow, input.settings)
  ) {
    return input.messages
  }

  // compaction 是独立 Step kind：同一个 stepId 同时写 telemetry span、
  // `ai_run_steps`、Step 事件和 `context.compacted` 事件，不复用当前 assistant Step。
  const step: RunStepState = {
    id: generateId(),
    kind: 'compaction',
    attempt: input.telemetry.attemptNo,
  }
  const stepId = step.id
  const turnId = input.telemetry.turnId
  const lifecycle = input.lifecycle
  if (turnId && lifecycle) {
    try {
      lifecycle.beginStep({
        id: stepId,
        runId: input.telemetry.runId,
        turnId,
        kind: 'compaction',
        attempt: input.telemetry.attemptNo,
        attemptNo: input.telemetry.attemptNo,
        startedAt: new Date(),
      })
    } catch {
      // Step 记录写失败不能阻止 compaction 本身。
    }
  }
  try {
    input.onStepStarted?.(step)
  } catch {
    // 同上：发事件失败不改写 compaction 结果。
  }
  const completeStep = (outcome: 'succeeded' | 'failed' | 'deferred', errorCode: ApiErrorCode | null): void => {
    if (turnId && lifecycle) {
      try {
        lifecycle.completeStep(stepId, outcome, errorCode, new Date())
      } catch {
        // 同上：审计写失败不改写 compaction 结果。
      }
    }
    try {
      input.onStepCompleted?.(step, outcome, errorCode)
    } catch {
      // 同上。
    }
  }

  return startAiSpan(
    input.telemetry.parent,
    'starter.ai.step',
    {
      'starter.ai.run.id': input.telemetry.runId,
      'starter.ai.turn.id': turnId ?? undefined,
      'starter.ai.step.id': stepId,
      'starter.ai.step.kind': 'compaction',
      'starter.ai.step.attempt': input.telemetry.attemptNo,
    },
    async (span) => {
      input.telemetry.onStepSpan(span)
      const state: {
        outcome: 'succeeded' | 'deferred'
        failureCode: ApiErrorCode | null
      } = { outcome: 'succeeded', failureCode: null }
      try {
        const messages = await runCompaction(
          {
            ...input,
            onFailure: (errorCode) => {
              state.failureCode = errorCode
              input.onFailure(errorCode)
            },
            onCompacted: (info) => input.onCompacted({ ...info, stepId }),
            onDeferred: () => {
              state.outcome = 'deferred'
            },
          },
          span,
        )
        span.setAttributes({ 'starter.ai.step.outcome': state.outcome })
        completeStep(state.outcome, null)
        return messages
      } catch (error) {
        span.setAttributes({ 'starter.ai.step.outcome': 'failed' })
        completeStep('failed', state.failureCode)
        throw error
      } finally {
        input.telemetry.onStepSpan(null)
      }
    },
  )
}

async function runCompaction(
  input: {
    messages: AgentMessage[]
    transcript: import('@earendil-works/pi-agent-core').Entry[]
    session: AgentSessionHandle | undefined
    lane: string
    model: Model<Api>
    models: Models | undefined
    settings: CompactionSettings
    thinkingLevel: AgentDefinitionConfig['thinkingLevel']
    signal?: AbortSignal
    onFailure: (errorCode: ApiErrorCode) => void
    onDeferred: () => void
    onCompacted: (info: { entryId: string; tokensBefore: number; summary: string }) => void
  },
  span: AiSpan<'starter.ai.step'>,
): Promise<AgentMessage[]> {
  if (!input.models || !input.session) return input.messages

  const preparation = prepareCompaction(input.transcript, input.settings)
  if (!preparation.ok) {
    input.onFailure(ApiErrorCodes.AI_UPSTREAM_ERROR)
    throw new Error('Pi compaction 准备失败')
  }
  if (!preparation.value) {
    span.setAttributes({ 'starter.ai.step.outcome': 'deferred' })
    input.onDeferred()
    return input.messages
  }

  const compacted = await compact(
    preparation.value,
    input.models,
    input.model,
    undefined,
    input.signal,
    input.thinkingLevel,
  )
  if (!compacted.ok) {
    input.onFailure(ApiErrorCodes.AI_UPSTREAM_ERROR)
    throw new Error('Pi compaction 摘要生成失败')
  }

  try {
    const entry = await input.session.appendCompaction(input.lane, {
      type: 'compaction',
      id: generateId(),
      summary: compacted.value.summary,
      retainedTail: compacted.value.retainedTail,
      tokensBefore: compacted.value.tokensBefore,
      ...(compacted.value.details === undefined ? {} : { details: compacted.value.details }),
      ...(compacted.value.usage === undefined ? {} : { usage: compacted.value.usage }),
    })
    input.transcript.push(entry)
    input.onCompacted({
      entryId: entry.id,
      tokensBefore: compacted.value.tokensBefore,
      summary: compacted.value.summary,
    })
    return buildSessionContext(input.transcript).messages
  } catch {
    input.onFailure(ApiErrorCodes.AI_SESSION_STORAGE_FAILED)
    throw new Error('Pi compaction entry 写入失败')
  }
}

function resolveTerminalResult(
  mapper: PiEventMapper,
  abortRequested: boolean,
  override: ExecutorTerminalResult | undefined,
  failure: PiStreamFailure | undefined,
  completionReason: ExecutorCompletionReason,
): ExecutorTerminalResult {
  if (override) {
    return {
      ...override,
      finalEntryId: override.finalEntryId ?? mapper.lastAssistantEntryId,
    }
  }
  if (failure?.kind === 'timeout') {
    return {
      status: 'failed',
      finalEntryId: mapper.lastAssistantEntryId,
      errorCode: failure.errorCode,
    }
  }
  const message = mapper.lastAssistantMessage
  if (
    abortRequested ||
    failure?.kind === 'aborted' ||
    (message?.role === 'assistant' && message.stopReason === 'aborted')
  ) {
    return {
      status: 'aborted',
      finalEntryId: mapper.lastAssistantEntryId,
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
    }
  }
  if (message?.role === 'assistant' && message.stopReason === 'error') {
    return {
      status: 'failed',
      finalEntryId: mapper.lastAssistantEntryId,
      errorCode: failure?.errorCode ?? ApiErrorCodes.AI_UPSTREAM_ERROR,
    }
  }
  return {
    status: 'completed',
    finalEntryId: mapper.lastAssistantEntryId,
    errorCode: null,
    completionReason,
  }
}

function remainingRunMs(deadlineAt: number | undefined): number | undefined {
  return deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - Date.now())
}

/**
 * 给 Pi 的 `completeSimple`（compaction 摘要请求）包上 Model Call span 和审计。
 * span 包裹与审计注入解耦：没有 audit 也产生 span 和 modelCallId。
 */
function createInstrumentedModels(
  models: Models,
  audit: PiModelCallAudit | undefined,
  execution: RunExecutionContext,
  modelRef: AiModelRef,
  timeoutMs: number,
  getTelemetryParent: () => AiTelemetryTarget,
): Models {
  return new Proxy(models, {
    get(target, property) {
      if (property === 'completeSimple') {
        return async (
          model: Model<Api>,
          context: Context,
          options: SimpleStreamOptions = {},
        ): Promise<AssistantMessage> =>
          startAiSpan(
            getTelemetryParent(),
            'starter.ai.model_call',
            {
              'starter.ai.run.id': execution.runId,
              'starter.ai.provider': model.provider,
              'starter.ai.model': model.id,
              'starter.ai.api': model.api,
              'starter.ai.streaming': false,
            },
            async (span) => {
              const startedAt = new Date()
              const effectiveTimeoutMs = Math.max(1, Math.min(options.timeoutMs ?? timeoutMs, timeoutMs))
              // modelCallId 在请求开始前生成，auditId 只在审计成功时有值。
              const modelCallId = generateId()
              let auditId: string | null = null
              let finalized = false
              let responseModel: string | undefined
              let responseId: string | undefined
              const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs)
              const cause: { kind: 'aborted' | 'timeout' | null } = {
                kind: options.signal?.aborted ? 'aborted' : null,
              }
              const onInputAbort = () => {
                cause.kind ??= 'aborted'
              }
              const onTimeout = () => {
                cause.kind ??= 'timeout'
              }
              options.signal?.addEventListener('abort', onInputAbort, {
                once: true,
              })
              timeoutSignal.addEventListener('abort', onTimeout, {
                once: true,
              })
              const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
              const finalize = (
                resultValue: Exclude<AiModelCallResult, 'running'>,
                stopReason: AiModelCallStopReason,
                errorCode: string | null,
                usage: AiUsage,
                cost: AiCost | null,
              ) => {
                if (finalized) return
                finalized = true
                span.setAttributes({
                  'starter.ai.model_call.id': modelCallId,
                  'starter.ai.model_call.result': resultValue,
                  'starter.ai.response.model': responseModel,
                  'starter.ai.response.id': responseId,
                  'starter.ai.response.stop_reason': stopReason,
                  'starter.ai.usage.input_tokens': usage.inputTokens ?? undefined,
                  'starter.ai.usage.output_tokens': usage.outputTokens ?? undefined,
                  'starter.ai.usage.cache_read_tokens': usage.cacheReadTokens ?? undefined,
                  'starter.ai.usage.cache_write_tokens': usage.cacheWriteTokens ?? undefined,
                  'starter.ai.usage.reasoning_tokens': usage.reasoningTokens ?? undefined,
                  'starter.ai.usage.total_tokens': usage.totalTokens ?? undefined,
                  'starter.ai.usage.cost': cost?.total ?? undefined,
                  'starter.ai.duration_ms': Date.now() - startedAt.getTime(),
                  'starter.ai.error.code': errorCode ?? undefined,
                })
                if (resultValue !== 'succeeded') span.setStatus({ status: 'error' })
                if (!auditId) return
                try {
                  audit?.finalizeModelCall({
                    id: auditId,
                    requestId: execution.requestId,
                    startedAt,
                    finishedAt: new Date(),
                    result: resultValue,
                    stopReason,
                    errorCode,
                    usage,
                    cost,
                    responseModel: responseModel ?? null,
                    responseId: responseId ?? null,
                  })
                } catch {
                  // 审计是 best-effort，不能改变 compaction 结果。
                }
              }
              try {
                try {
                  auditId =
                    audit?.beginModelCall({
                      id: modelCallId,
                      runId: execution.runId,
                      userId: execution.userId,
                      requestId: execution.requestId,
                      model: modelRef,
                      api: model.api,
                      turnId: execution.turnId,
                      timeoutMs: effectiveTimeoutMs,
                      startedAt,
                    }) ?? null
                } catch {
                  auditId = null
                }
                const result = await target.completeSimple(model, context, {
                  ...options,
                  signal,
                  timeoutMs: effectiveTimeoutMs,
                })
                responseModel = result.responseModel ?? undefined
                responseId = result.responseId ?? undefined
                const outcome = classifyCompleteSimpleResult(result, cause.kind)
                finalize(
                  outcome.result,
                  outcome.stopReason,
                  outcome.errorCode,
                  toAiUsage(result.usage),
                  toAiCost(result.usage),
                )
                return result
              } catch (error) {
                const kind =
                  cause.kind ?? (timeoutSignal.aborted ? 'timeout' : options.signal?.aborted ? 'aborted' : null)
                finalize(
                  kind === 'timeout' ? 'timed_out' : kind === 'aborted' ? 'cancelled' : 'upstream_failed',
                  kind === 'timeout' || kind === 'aborted' ? 'aborted' : 'error',
                  kind === 'timeout'
                    ? ApiErrorCodes.AI_UPSTREAM_TIMEOUT
                    : kind === 'aborted'
                      ? ApiErrorCodes.AI_REQUEST_ABORTED
                      : ApiErrorCodes.AI_UPSTREAM_ERROR,
                  emptyUsage(),
                  null,
                )
                throw error
              } finally {
                options.signal?.removeEventListener('abort', onInputAbort)
                timeoutSignal.removeEventListener('abort', onTimeout)
              }
            },
          )
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Models
}

function classifyCompleteSimpleResult(
  message: AssistantMessage,
  cause: 'aborted' | 'timeout' | null,
): {
  result: Exclude<AiModelCallResult, 'running'>
  stopReason: AiModelCallStopReason
  errorCode: string | null
} {
  if (cause === 'timeout') {
    return {
      result: 'timed_out',
      stopReason: 'aborted',
      errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
    }
  }
  if (cause === 'aborted' || message.stopReason === 'aborted') {
    return {
      result: 'cancelled',
      stopReason: 'aborted',
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
    }
  }
  if (message.stopReason === 'error') {
    return {
      result: 'upstream_failed',
      stopReason: 'error',
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
    }
  }
  if (message.stopReason === 'deferred') {
    return {
      result: 'upstream_failed',
      stopReason: 'deferred',
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
    }
  }
  return {
    result: 'succeeded',
    stopReason: normalizeModelStopReason(message),
    errorCode: null,
  }
}

function normalizeModelStopReason(message: AssistantMessage): AiModelCallStopReason {
  if (message.stopReason === 'length') return 'length'
  if (message.stopReason === 'toolUse') return 'tool_use'
  if (message.stopReason === 'aborted') return 'aborted'
  if (message.stopReason === 'error') return 'error'
  if (message.stopReason === 'deferred') return 'deferred'
  return 'stop'
}

function toAiUsage(usage: Usage): AiUsage {
  return {
    inputTokens: numberOrNull(usage.input),
    outputTokens: numberOrNull(usage.output),
    cacheReadTokens: numberOrNull(usage.cacheRead),
    cacheWriteTokens: numberOrNull(usage.cacheWrite),
    cacheWrite1hTokens: numberOrNull(usage.cacheWrite1h),
    reasoningTokens: numberOrNull(usage.reasoning),
    totalTokens: numberOrNull(usage.totalTokens),
  }
}

function toAiCost(usage: Usage): AiCost | null {
  const input = numberOrNull(usage.cost?.input)
  const output = numberOrNull(usage.cost?.output)
  const cacheRead = numberOrNull(usage.cost?.cacheRead)
  const cacheWrite = numberOrNull(usage.cost?.cacheWrite)
  const total = numberOrNull(usage.cost?.total)
  if (input === null || output === null || cacheRead === null || cacheWrite === null || total === null) {
    return null
  }
  return { currency: 'USD', input, output, cacheRead, cacheWrite, total }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function sanitizeToolErrors(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== 'toolResult' || !message.isError || hasSafeToolDetails(message.details)) {
      return message
    }
    return {
      ...message,
      content: [{ type: 'text', text: 'The tool failed.' }],
    }
  })
}

function hasSafeToolDetails(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    value.status === 'succeeded' ||
    value.status === 'not_found' ||
    value.status === 'invalid_arguments' ||
    value.status === 'forbidden' ||
    value.status === 'failed' ||
    value.status === 'timed_out' ||
    value.status === 'cancelled' ||
    value.status === 'interrupted'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptyUsage(): AiUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  }
}
