import type { Logger } from 'pino'
import { NOOP_TELEMETRY_CONTEXT } from '@earendil-works/pi-telemetry'
import type { TelemetryContext } from '@earendil-works/pi-telemetry'
import type {
  AgentRun,
  AgentRunSnapshot,
  AiModelRef,
  AiRunResolvedManifest,
  ApiErrorCode,
  FollowUpAgentRunInput,
  RunEvent,
  RunTimeline,
  RunTrace,
  StartAgentRunInput,
  SteerAgentRunInput,
  StructuredOutputItem,
  StructuredOutputList,
} from '@starter/contracts'
import { agentRunSnapshotSchema, ApiErrorCodes, starterRunDataSchema } from '@starter/contracts'

import type {
  ActiveRunLease,
  ActiveRunRegistry,
  AgentControlImage,
  AgentSessionStore,
  AttachableActiveRunControls,
  PiAgentExecutor,
  PreparedAgentExecution,
  RunExecutionContext,
} from '@api/infra/agent/index.js'
import { ActiveRunRegistryError, createRunExecutionContext } from '@api/infra/agent/index.js'
import type { ExecutorTerminalResult } from '@api/infra/agent/agent-executor.js'
import { createRunEventDraft } from '@api/infra/agent/run-execution-context.js'
import type { AiSpanEndAttributes, AiSpanScope } from '@api/infra/telemetry/index.js'
import { openAiSpanScope } from '@api/infra/telemetry/index.js'
import { AppError } from '@api/shared/app-error.js'
import { generateId } from '@api/shared/id.js'
import { toAiErrorCategory, isAiRetryableErrorCode } from '@api/modules/ai/ai-error.js'
import type { RuntimeAccessContext } from '@api/modules/ai/principal.js'

import type { AiAgentDefinitionService } from '../agent/agent.service.js'
import { enforceControlPolicy, enforceStartPolicy } from '../runtime/app-policy.js'
import type { AiAttachmentResolver } from '../attachment/index.js'
import type { AiOutputContractRegistry } from '../output/output-contract-registry.js'
import { toStructuredOutputContractRef } from '../output/output-contract-registry.js'
import type { AiStructuredOutputRepository } from '../output/structured-output.repository.js'
import type { AiAgentSessionRepository } from '../session/session.repository.js'
import type { LaneLeaseOwner, LaneLeaseStore } from './lane-lease.js'
import type { RunLiveSnapshotState } from './run.live-snapshot.js'
import { applyRunEvent, createRunLiveSnapshot, toAgentRunLiveSnapshot } from './run.live-snapshot.js'
import { toAgentRun, toStarterRunData } from './run.presenter.js'
import type { AiAgentRunRecord, AiAgentRunRepository } from './run.repository.js'
import type { AiRunAttemptRepository } from './run-attempt.repository.js'
import type { AiRunEventRepository, RunEventDraft } from './run-event.repository.js'
import type { AiRunResolvedManifestRepository } from './run-resolved-manifest.repository.js'
import type { AiRunTraceRepository } from './run-trace.repository.js'
import { buildResolvedRunManifest } from './resolved-manifest.js'
import { AsyncEventQueue } from '@api/infra/agent/pi-event-mapper.js'
import { RunEventPublisher } from './run-event.publisher.js'

/** 对外 SSE 订阅队列的有界缓冲；超限时关闭 transport，不阻塞 Agent loop。 */
const MAX_PENDING_EVENTS = 1024

/** auto retry 只对模型上游失败与超时生效；auth/参数/abort/存储失败不重试。 */
const AUTO_RETRY_ERROR_CODES: ReadonlySet<string> = new Set([
  ApiErrorCodes.AI_UPSTREAM_ERROR,
  ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
])

export interface StartRunResult {
  runId: string
  events: AsyncIterable<RunEvent>
}

export interface RunRecoveryReport {
  scanned: number
  recoveredFromEntry: number
  interrupted: number
  corrupted: number
}

export interface AiAgentRunService {
  startRun: (input: {
    access: RuntimeAccessContext
    sessionId: string
    input: StartAgentRunInput
    requestId: string
  }) => Promise<StartRunResult>
  get: (access: RuntimeAccessContext, sessionId: string, runId: string) => AgentRun
  /** 返回该 session 指定 lane 上仍在跑的 Run；没有就是 null。 */
  activeRun: (access: RuntimeAccessContext, sessionId: string, lane: string) => AgentRun | null
  abort: (access: RuntimeAccessContext, sessionId: string, runId: string) => AgentRun
  steer: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    input: SteerAgentRunInput,
  ) => Promise<AgentRun>
  followUp: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    input: FollowUpAgentRunInput,
  ) => Promise<AgentRun>
  trace: (access: RuntimeAccessContext, sessionId: string, runId: string) => RunTrace
  timeline: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
    pageSize: number,
  ) => RunTimeline
  sequenceForEvent: (access: RuntimeAccessContext, sessionId: string, runId: string, eventId: string) => number
  subscribe: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
  ) => AsyncIterable<RunEvent>
  /** 运行面主体读取 Run 的结构化输出；value 按 contract 可见性打码。 */
  structuredOutputs: (access: RuntimeAccessContext, sessionId: string, runId: string) => StructuredOutputList
  /** Admin 读取 Run 的全部结构化输出，value 不打码。 */
  adminStructuredOutputs: (runId: string) => StructuredOutputList
  /** 读回 Run 启动时固化的 resolved manifest；不存在（Run 未启动成功）返回 null。 */
  describeResolvedManifest: (runId: string) => AiRunResolvedManifest | null
  recoverInterrupted: () => Promise<RunRecoveryReport>
}

interface RunContext {
  execution: RunExecutionContext
  lease: ActiveRunLease
  /** db lease 凭据：续租、释放与终态 fencing 校验都用它。 */
  laneLease: LaneLeaseOwner
  /** 周期续租定时器；终态清理时统一清除。 */
  renewTimer: ReturnType<typeof setInterval> | null
  outputMode: 'optional' | 'required'
  /** Publisher 写库失败后的确定出口标记；终态强制为存储失败。 */
  storageFailed: boolean
  events: AsyncEventQueue<RunEvent>
  subscribers: Set<AsyncEventQueue<RunEvent>>
  publisher: RunEventPublisher
  telemetry: AiSpanScope<'starter.ai.run'>
  live: RunLiveSnapshotState
  /** 当前执行 attempt 序号；auto retry 追加后递增。 */
  currentAttemptNo: number
  /** auto retry 判定输入：maxAttempts（缺省 1）与副作用门禁。 */
  retry: { maxAttempts: number; blockedBySideEffect: boolean }
}

export function createAiAgentRunService(input: {
  repository: AiAgentRunRepository
  sessionRepository: AiAgentSessionRepository
  sessionStore: AgentSessionStore
  agentService: AiAgentDefinitionService
  registry: ActiveRunRegistry
  executor: PiAgentExecutor
  logger: Logger
  eventRepository: AiRunEventRepository
  traceRepository?: AiRunTraceRepository
  structuredOutputRepository?: AiStructuredOutputRepository
  /** contract 渲染元数据（visibility / mode）的来源之一；表内值优先，NULL 回退。 */
  outputContractRegistry: AiOutputContractRegistry
  /** resolved manifest 持久化；startRun 必需。 */
  resolvedManifestRepository?: AiRunResolvedManifestRepository
  /** attempt 行 CRUD 与条件终态更新；startRun 与 auto retry 必需。 */
  attemptRepository?: AiRunAttemptRepository
  /** 附件解析：归属校验 + 读字节转 base64；带附件的输入必需。 */
  resolveAttachments: AiAttachmentResolver['resolveForRequest']
  /** 模型能力查询：目标模型是否支持图片输入，统一查 runtime 模型表。 */
  supportsImageInput: (model: AiModelRef) => boolean
  /** lane 执行所有权的持久 lease：排他与 fencing 的权威数据源。 */
  laneLeaseStore: LaneLeaseStore
  /** lease ownerId：当前实例的 APP_INSTANCE_ID。 */
  instanceId: string
  /**
   * AI readiness 门禁：启动恢复扫描完成前 startRun 在入口等待。
   * 默认 resolved，直连构造（测试 / 恢复扫描）不接门禁。
   */
  readiness?: Promise<void>
  /** Run span 的根上下文；默认 no-op。 */
  telemetry?: TelemetryContext
}): AiAgentRunService {
  const {
    repository,
    sessionRepository,
    sessionStore,
    agentService,
    registry,
    executor,
    logger,
    resolveAttachments,
    supportsImageInput,
    laneLeaseStore,
    instanceId,
  } = input
  const readiness = input.readiness ?? Promise.resolve()
  const structuredOutputRepository = input.structuredOutputRepository
  const outputContractRegistry = input.outputContractRegistry
  const resolvedManifestRepository = input.resolvedManifestRepository
  const attemptRepository = input.attemptRepository
  const eventRepository = input.eventRepository
  const telemetry = input.telemetry ?? NOOP_TELEMETRY_CONTEXT
  /** 活跃 Run 的进程内快照，Run 终态后立即移除。 */
  const liveSnapshots = new Map<string, RunLiveSnapshotState>()
  const contexts = new Map<string, RunContext>()

  function publish(context: RunContext, event: RunEventDraft): void {
    context.publisher.publish(event)
  }

  /** 预设 Agent 路径：显式 agentId 或 Session 默认 Agent，都没有时 400。 */
  async function resolvePresetAgent(
    input: StartAgentRunInput,
    session: ReturnType<typeof requireActiveSession>,
    access: RuntimeAccessContext,
  ) {
    const agentId = input.agentId ?? session.defaultAgentId
    if (!agentId) {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        '启动 Run 需要 agentId 或 Session 的 defaultAgentId',
        400,
      )
    }
    return agentService.resolve(agentId, access)
  }

  async function startRun(startInput: {
    access: RuntimeAccessContext
    sessionId: string
    input: StartAgentRunInput
    requestId: string
  }): Promise<StartRunResult> {
    const { access, sessionId, requestId } = startInput
    // readiness 门禁：启动恢复扫描完成前等待新请求，不拒绝也不并行执行。
    await readiness
    const session = requireActiveSession(access, sessionId)
    // 内联配置与预设 Agent 二选一（schema 层互斥）；都不传时回落 Session 默认 Agent。
    const resolved = startInput.input.config
      ? await agentService.resolveInline(startInput.input.config, access)
      : await resolvePresetAgent(startInput.input, session, access)
    if (
      startInput.input.expectedAgentRevision !== undefined &&
      resolved.revision !== startInput.input.expectedAgentRevision
    ) {
      throw new AppError(ApiErrorCodes.AI_AGENT_REVISION_CONFLICT, 'Agent revision 与请求期望不一致', 409)
    }
    enforceStartPolicy(access, {
      id: resolved.id,
      revision: resolved.revision,
      tools: resolved.tools.map((tool) => tool.sideEffect),
    })
    const lane = startInput.input.lane ?? 'main'

    // 附件解析与能力硬校验在幂等预检查之前：失败请求不 reserve、
    // 不建 Run 行、不消费幂等键，也不给模型静默降级。
    const images = await resolveInputImages({
      access,
      sessionId,
      model: resolved.model,
      attachmentIds: startInput.input.attachmentIds,
    })

    // 幂等预检查在 reserve 之前：命中既有 Run 就直接返回，不占 lane 租约。
    // key 只在 Run 行创建成功后才被消费，这里的末命中不代表后续失败也不消费。
    const idempotencyKey = startInput.input.idempotencyKey
    let idempotencyScope: string | undefined
    if (idempotencyKey !== undefined) {
      idempotencyScope = idempotencyScopeOf(access)
      const existing = repository.findByIdempotencyKey(idempotencyScope, idempotencyKey)
      if (existing) {
        if (existing.sessionId !== sessionId) throw idempotencyConflict()
        return replayExistingRun(access, sessionId, existing.id)
      }
    }

    const runId = generateId()
    const snapshot = buildSnapshot(resolved)
    // auto retry 判定输入：缺省 maxAttempts=1 不重试；manifest 含非幂等写 Tool 时整体禁用。
    const retryMaxAttempts = resolved.config.retryPolicy?.maxAttempts ?? 1
    const retryBlockedBySideEffect = resolved.tools.some((tool) => tool.sideEffect === 'non_idempotent_write')

    let lease: ActiveRunLease
    try {
      lease = registry.reserve(sessionId, lane)
    } catch (error) {
      if (error instanceof ActiveRunRegistryError && error.kind === 'busy') {
        throw new AppError(ApiErrorCodes.AI_SESSION_BUSY, '该 Session lane 已有 Run 在运行', 409)
      }
      throw error
    }

    // 排他权威是持久 lease：内存 miss 时 acquire，失败同样 AI.SESSION_BUSY。
    // 同 owner 未过期重复 acquire 也返回 busy：内存快速路径未拦住说明是异常重入。
    let laneLease: LaneLeaseOwner
    try {
      const acquired = laneLeaseStore.acquire({ sessionId, lane, ownerId: instanceId })
      if (acquired === 'busy') {
        throw new AppError(ApiErrorCodes.AI_SESSION_BUSY, '该 Session lane 已有 Run 在运行', 409)
      }
      laneLease = acquired
    } catch (error) {
      registry.release(lease)
      if (error instanceof AppError) throw error
      logger.error({ err: error, sessionId, lane, requestId }, 'Agent Run lane lease 领取失败')
      throw new AppError(ApiErrorCodes.SYSTEM_INTERNAL_ERROR, '创建 Agent Run 失败', 500)
    }

    // Pi 只自动创建 main lane；非 main lane 需要显式创建（幂等：已存在时忽略）。
    try {
      await ensureLane(sessionStore, sessionId, lane)
    } catch (cause) {
      registry.release(lease)
      laneLeaseStore.release({ sessionId, lane, owner: laneLease })
      logger.error({ err: cause, sessionId, lane, requestId }, 'Agent Run lane 创建失败')
      throw new AppError(ApiErrorCodes.AI_SESSION_STORAGE_FAILED, 'Agent Session lane 创建失败', 500)
    }

    if (!eventRepository) {
      registry.release(lease)
      laneLeaseStore.release({ sessionId, lane, owner: laneLease })
      throw new Error('Run Event repository 未配置')
    }
    if (!resolvedManifestRepository) {
      registry.release(lease)
      laneLeaseStore.release({ sessionId, lane, owner: laneLease })
      throw new Error('Run resolved manifest repository 未配置')
    }
    if (!attemptRepository) {
      registry.release(lease)
      laneLeaseStore.release({ sessionId, lane, owner: laneLease })
      throw new Error('Run attempt repository 未配置')
    }
    const events = new AsyncEventQueue<RunEvent>(MAX_PENDING_EVENTS)
    // 关联上下文由 Run Service 创建，向下传给 Executor、事件映射、模型流和 Tool adapter。
    const execution = createRunExecutionContext({
      runId,
      sessionId,
      lane,
      requestId,
      principal: access.principal,
      scope: access.scope,
      agentId: resolved.id,
      agentRevision: resolved.revision,
      outputContract: resolved.outputContract ?? null,
    })
    let controls: AttachableActiveRunControls | null = null
    // Run span 包住整个异步 Run 执行，结束时机是终态事务。
    const runTelemetry = openAiSpanScope(telemetry, 'starter.ai.run', {
      'starter.ai.run.id': runId,
      'starter.ai.session.id': sessionId,
      'starter.ai.lane': lane,
      'starter.ai.request.id': requestId,
      'starter.ai.principal.kind': access.principal.kind,
      'starter.ai.tenant.id': access.scope.tenantId,
      'starter.ai.project.id': access.scope.projectId,
      'starter.ai.application.id': access.principal.appId ?? undefined,
      'starter.ai.external_user.id': access.principal.externalUserId ?? undefined,
      'starter.ai.subject.type': access.scope.subjectType ?? undefined,
      'starter.ai.subject.id': access.scope.subjectId ?? undefined,
      'starter.ai.run.config.source': resolved.id !== null ? 'agent' : 'inline',
      'starter.ai.agent.id': resolved.id ?? undefined,
      'starter.ai.agent.revision': resolved.revision ?? undefined,
      'starter.ai.provider': resolved.model.providerId,
      'starter.ai.model': resolved.model.modelId,
      'starter.ai.output.mode': resolved.outputContract?.mode ?? resolved.config.outputMode,
      'starter.ai.output.contract.name': resolved.outputContract?.name,
      'starter.ai.output.contract.version': resolved.outputContract?.version,
    })
    const context: RunContext = {
      execution,
      lease,
      laneLease,
      renewTimer: null,
      outputMode: resolved.outputContract?.mode ?? resolved.config.outputMode,
      storageFailed: false,
      events,
      subscribers: new Set(),
      publisher: new RunEventPublisher({
        repository: eventRepository,
        sink: {
          push: (event) => {
            context.events.push(event)
            for (const subscriber of context.subscribers) subscriber.push(event)
          },
        },
        onPersisted: (event) => applyRunEvent(context.live, event),
        onStorageFailure: (error) => {
          // 事件写库失败：停止当前 transport 的新事件，Run 转入存储失败终态。
          context.storageFailed = true
          logger.error({ err: error, runId, sessionId, requestId }, 'Run 事件持久化失败，转入存储失败终态')
          controls?.abort()
        },
      }),
      telemetry: runTelemetry,
      live: createRunLiveSnapshot(resolved.maxTurns),
      currentAttemptNo: 1,
      retry: { maxAttempts: retryMaxAttempts, blockedBySideEffect: retryBlockedBySideEffect },
    }
    contexts.set(runId, context)
    liveSnapshots.set(runId, context.live)

    try {
      repository.create({
        id: runId,
        sessionId,
        agentId: resolved.id,
        lane,
        agentRevision: resolved.revision,
        snapshotJson: JSON.stringify(snapshot),
        requestId,
        now: new Date(),
        executionFencingToken: laneLease.fencingToken,
        ...(idempotencyKey !== undefined && idempotencyScope !== undefined ? { idempotencyKey, idempotencyScope } : {}),
      })
    } catch (cause) {
      registry.release(lease)
      laneLeaseStore.release({ sessionId, lane, owner: laneLease })
      contexts.delete(runId)
      liveSnapshots.delete(runId)
      // 并发竞争：另一个同 key 请求先创建了 Run，命中部分唯一索引。
      // 释放租约后重查，按既有 Run 返回或 409；key 不落在两个 Run 上。
      if (idempotencyKey !== undefined && idempotencyScope !== undefined && isIdempotencyUniqueViolation(cause)) {
        runTelemetry.close({
          attributes: {
            'starter.ai.run.outcome': 'failed',
            'starter.ai.error.code': ApiErrorCodes.AI_IDEMPOTENCY_KEY_CONFLICT,
            'starter.ai.error.category': 'validation',
          },
          status: { status: 'error' },
        })
        const existing = repository.findByIdempotencyKey(idempotencyScope, idempotencyKey)
        if (existing) {
          if (existing.sessionId !== sessionId) throw idempotencyConflict()
          return replayExistingRun(access, sessionId, existing.id)
        }
      }
      logger.error({ err: cause, runId, sessionId, requestId }, 'Agent Run row 创建失败')
      runTelemetry.close({
        attributes: {
          'starter.ai.run.outcome': 'failed',
          'starter.ai.error.code': ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
          'starter.ai.error.category': 'storage',
        },
        status: { status: 'error' },
      })
      throw new AppError(ApiErrorCodes.SYSTEM_INTERNAL_ERROR, '创建 Agent Run 失败', 500)
    }

    // resolved manifest 在 run row 之后、executor 启动前固化；写入失败按
    // 启动失败收尾（释放两层 lease），不存在无 manifest 的 starting/running Run。
    const manifest = buildResolvedRunManifest({
      agentId: resolved.id,
      agentRevision: resolved.revision,
      model: resolved.model,
      systemPrompt: resolved.manifestFacts.systemPrompt,
      skills: resolved.manifestFacts.skills,
      tools: resolved.tools,
      outputContract: resolved.outputContract,
    })

    // attempt 1 在 run row 之后创建（trigger=initial，owner/token 来自 lease）；
    // 写入失败与 manifest 失败同路径收尾，不存在无 attempt 行的 starting/running Run。
    try {
      attemptRepository.create({
        id: generateId(),
        runId,
        attemptNo: 1,
        trigger: 'initial',
        ownerId: laneLease.ownerId,
        fencingToken: laneLease.fencingToken,
        startedAt: new Date(),
      })
    } catch (cause) {
      logger.error({ err: cause, runId, sessionId, requestId }, 'Agent Run attempt 行创建失败')
      runTelemetry.close({
        attributes: {
          'starter.ai.run.outcome': 'failed',
          'starter.ai.error.code': ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
          'starter.ai.error.category': 'storage',
        },
        status: { status: 'error' },
      })
      void finalizeRun(context, {
        status: 'failed',
        finalEntryId: null,
        errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
      })
      return { runId, events }
    }

    try {
      resolvedManifestRepository.create({
        runId,
        manifestHash: manifest.manifestHash,
        manifestJson: JSON.stringify(manifest),
        now: new Date(),
      })
    } catch (cause) {
      logger.error({ err: cause, runId, sessionId, requestId }, 'Agent Run resolved manifest 写入失败')
      runTelemetry.close({
        attributes: {
          'starter.ai.run.outcome': 'failed',
          'starter.ai.error.code': ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
          'starter.ai.error.category': 'storage',
        },
        status: { status: 'error' },
      })
      void finalizeRun(context, {
        status: 'failed',
        finalEntryId: null,
        errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
      })
      return { runId, events }
    }

    // executor prepare 的统一入口：attempt 1 与 auto retry 重建共用同一配置。
    const prepareExecution = (): PreparedAgentExecution =>
      executor.prepare({
        execution,
        input: startInput.input.input,
        ...(images ? { images } : {}),
        telemetry: context.telemetry.span,
        config: {
          model: resolved.model,
          systemPrompt: resolved.systemPrompt,
          thinkingLevel: resolved.thinkingLevel,
          maxTurns: resolved.maxTurns,
          tools: resolved.tools,
          outputContract: resolved.outputContract,
          structuredOutput:
            resolved.outputContract && structuredOutputRepository
              ? {
                  persist: ({ runId, stepId, contract, value }) =>
                    structuredOutputRepository.create({
                      runId,
                      stepId,
                      contractName: contract.name,
                      contractVersion: contract.version,
                      schemaHash: contract.schemaHash,
                      renderKind: contract.renderKind,
                      visibility: contract.visibility,
                      mode: contract.mode,
                      value,
                    }),
                  publish: (event) => {
                    publish(
                      context,
                      createRunEventDraft(
                        execution,
                        'structured_output.available',
                        {
                          contract: event.contract,
                          value: event.value,
                          referenceId: event.referenceId,
                        },
                        { toolCallId: event.toolCallId },
                      ),
                    )
                  },
                }
              : undefined,
        },
      })

    let prepared: PreparedAgentExecution
    try {
      prepared = prepareExecution()
    } catch (cause) {
      logger.error({ err: cause, runId, sessionId, requestId }, 'Agent Run prepare 失败')
      void finalizeRun(context, {
        status: 'failed',
        finalEntryId: null,
        errorCode: ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      })
      return { runId, events }
    }

    try {
      registry.attach(lease, runId, prepared.controls)
      controls = prepared.controls
    } catch (cause) {
      logger.error({ err: cause, runId, sessionId, requestId }, 'Agent Run attach 失败')
      void finalizeRun(context, {
        status: 'failed',
        finalEntryId: null,
        errorCode: ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      })
      return { runId, events }
    }

    if (!repository.markRunning(runId, new Date())) {
      logger.error({ runId, sessionId, requestId }, 'Agent Run starting -> running 更新失败')
      void finalizeRun(context, {
        status: 'failed',
        finalEntryId: null,
        errorCode: ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      })
      return { runId, events }
    }

    try {
      publish(
        context,
        createRunEventDraft(execution, 'run.started', {
          agentId: execution.agentId,
          agentRevision: execution.agentRevision,
          model: resolved.model,
          outputContract: execution.outputContract?.ref ?? null,
        }),
      )
    } catch (cause) {
      logger.error({ err: cause, runId, sessionId, requestId }, 'Run started 事件持久化失败')
      prepared.controls.abort()
      void finalizeRun(context, storageFailureTerminal())
      return { runId, events }
    }

    // 执行期间周期续租；续租失败（被接管或过期）走现有 abort 路径，
    // 终态事务的 fencing 校验会把结果落成 interrupted，不发明新错误码。
    context.renewTimer = setInterval(() => {
      let renewed: boolean
      try {
        renewed = laneLeaseStore.renew({ sessionId, lane, owner: context.laneLease })
      } catch (error) {
        logger.error({ err: error, runId, sessionId, requestId }, 'Agent Run lane lease 续租查询失败')
        return
      }
      if (!renewed) {
        logger.warn({ runId, sessionId, lane, requestId }, 'Agent Run lane lease 已失效，中止执行')
        registry.get(runId)?.abort()
      }
    }, laneLeaseStore.renewIntervalMs)

    void prepared.start().catch((cause) => {
      logger.error({ err: cause, runId, sessionId, requestId }, 'Agent Executor start 失败')
    })

    // auto retry 重建 executor：attempt 行就位后由 runToTerminal 的重试循环调用；
    // registry 控制面替换为新 controls，abort/steer/followUp 继续可用。
    const startNextAttempt = (attemptNo: number): PreparedAgentExecution => {
      execution.setAttemptNo(attemptNo)
      const next = prepareExecution()
      registry.replace(runId, next.controls)
      controls = next.controls
      void next.start().catch((cause) => {
        logger.error({ err: cause, runId, sessionId, requestId, attemptNo }, 'Agent Executor start 失败')
      })
      return next
    }

    void runToTerminal(context, prepared, startNextAttempt)
    return { runId, events }
  }

  function trace(access: RuntimeAccessContext, sessionId: string, runId: string): RunTrace {
    requireScopedRun(access, sessionId, runId)
    const result = input.traceRepository?.findByRunId(runId)
    if (!result) throw notFound()
    return result
  }

  /**
   * 结构化输出读取路径。visibility/mode 取表内值（emit 时刻的事实），
   * 历史 NULL 行回退 registry 当前定义；两者都拿不到（contract 已移除且
   * 行无值）跳过并记 WARN。contract ref 组装与 session transcript 回放
   * 共用 toStructuredOutputContractRef。
   */
  function listStructuredOutputs(runId: string, includeAdminValues: boolean): StructuredOutputList {
    const records = structuredOutputRepository?.listByRun(runId) ?? []
    const items: StructuredOutputItem[] = []
    for (const record of records) {
      const contract = outputContractRegistry.find({
        name: record.contractName,
        version: record.contractVersion,
      })
      const ref = toStructuredOutputContractRef(record, contract)
      if (!ref) {
        logger.warn(
          {
            runId,
            referenceId: record.id,
            contractName: record.contractName,
            contractVersion: record.contractVersion,
          },
          'Structured Output 无法渲染（contract 已移除且无表内可见性），读取时跳过该条',
        )
        continue
      }
      items.push({
        referenceId: record.id,
        contract: ref,
        value: includeAdminValues || ref.visibility === 'product' ? record.value : null,
        createdAt: record.createdAt.toISOString(),
      })
    }
    return { items }
  }

  function structuredOutputs(access: RuntimeAccessContext, sessionId: string, runId: string): StructuredOutputList {
    requireScopedRun(access, sessionId, runId)
    return listStructuredOutputs(runId, false)
  }

  function adminStructuredOutputs(runId: string): StructuredOutputList {
    if (!repository.findById(runId)) throw notFound()
    return listStructuredOutputs(runId, true)
  }

  function describeResolvedManifest(runId: string): AiRunResolvedManifest | null {
    return resolvedManifestRepository?.findByRunId(runId) ?? null
  }

  function timeline(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
    pageSize: number,
  ): RunTimeline {
    requireScopedRun(access, sessionId, runId)
    const rows = eventRepository.listAfter(runId, afterSequence, pageSize + 1)
    const items = rows.slice(0, pageSize)
    return {
      items,
      afterSequence,
      nextSequence: rows.length > pageSize ? (items.at(-1)?.sequence ?? null) : null,
      hasMore: rows.length > pageSize,
    }
  }

  function sequenceForEvent(access: RuntimeAccessContext, sessionId: string, runId: string, eventId: string): number {
    requireScopedRun(access, sessionId, runId)
    const sequence = eventRepository.findSequenceByEventId(runId, eventId)
    if (sequence === undefined) {
      throw new AppError(ApiErrorCodes.COMMON_INVALID_REQUEST, 'Last-Event-ID 不属于该 Run', 400)
    }
    return sequence
  }

  function subscribe(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
  ): AsyncIterable<RunEvent> {
    const record = requireScopedRun(access, sessionId, runId)
    const context = contexts.get(runId)

    return replayAndSubscribe({
      record,
      context,
      runId,
      afterSequence,
    })
  }

  function replayAndSubscribe(input: {
    record: AiAgentRunRecord
    context: RunContext | undefined
    runId: string
    afterSequence: number
  }): AsyncIterable<RunEvent> {
    const { record, context, runId, afterSequence } = input
    if (!context) {
      const history = listAllEventsAfter(runId, afterSequence)
      const historyIterator = history[Symbol.iterator]()
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => historyIterator.next(),
          return: async () => {
            historyIterator.return?.(undefined)
            return { done: true, value: undefined }
          },
        }),
      }
    }

    const queue = new AsyncEventQueue<RunEvent>(MAX_PENDING_EVENTS)
    const queueIterator = queue[Symbol.asyncIterator]()
    context.subscribers.add(queue)
    const watermark = eventRepository.watermark(runId)
    const replayIterator = listEventsThrough(runId, afterSequence, watermark)[Symbol.iterator]()
    let live = false
    let closed = false

    const cleanup = () => {
      if (closed) return
      closed = true
      context.subscribers.delete(queue)
      queue.end()
    }

    const iterator: AsyncIterator<RunEvent> = {
      next: async () => {
        if (closed) return { done: true, value: undefined }
        if (!live) {
          const replay = replayIterator.next()
          if (!replay.done) return { done: false, value: replay.value }
          live = true
          if (record.status !== 'starting' && record.status !== 'running') {
            cleanup()
            return { done: true, value: undefined }
          }
        }

        while (true) {
          if (closed) return { done: true, value: undefined }
          const next = await queueIterator.next()
          if (next.done) {
            cleanup()
            return { done: true, value: undefined }
          }
          if (next.value.sequence <= watermark) continue
          return { done: false, value: next.value }
        }
      },
      return: async () => {
        cleanup()
        return { done: true, value: undefined }
      },
    }

    return { [Symbol.asyncIterator]: () => iterator }
  }

  function* listEventsThrough(runId: string, afterSequence: number, watermark: number): Generator<RunEvent> {
    let cursor = afterSequence
    while (cursor < watermark) {
      const rows = eventRepository.listAfter(runId, cursor, Math.min(MAX_PENDING_EVENTS, watermark - cursor))
      if (rows.length === 0) return
      for (const event of rows) {
        if (event.sequence > watermark) return
        cursor = event.sequence
        yield event
      }
    }
  }

  function* listAllEventsAfter(runId: string, afterSequence: number): Generator<RunEvent> {
    let cursor = afterSequence
    while (true) {
      const rows = eventRepository.listAfter(runId, cursor, MAX_PENDING_EVENTS)
      if (rows.length === 0) return
      for (const event of rows) {
        cursor = event.sequence
        yield event
      }
      if (rows.length < MAX_PENDING_EVENTS) return
    }
  }

  function get(access: RuntimeAccessContext, sessionId: string, runId: string): AgentRun {
    const record = requireScopedRun(access, sessionId, runId)
    return toAgentRun(record, readLiveSnapshot(record))
  }

  /**
   * 刷新页面后找回 runId 的入口。
   *
   * 只看主库 Run 行的 starting / running，不看 registry：进程重启后
   * `recoverInterrupted` 已经把非终态 Run 落成 interrupted，这里就返回 null。
   */
  function activeRun(access: RuntimeAccessContext, sessionId: string, lane: string): AgentRun | null {
    requireActiveSession(access, sessionId)
    const record = repository.findActiveInScope(sessionId, lane, access)
    if (!record) return null
    return toAgentRun(record, readLiveSnapshot(record))
  }

  /**
   * 活跃快照只在 Run 非终态时返回，终态后为 null，客户端回落 transcript。
   *
   * 判据用 Run row 状态而不是 registry handle：finalizeRun 先更新主库终态、
   * 后 release registry，两步之间存在窗口，按 handle 判断会返回「终态 + 非空快照」
   * 的非法组合。
   */
  function readLiveSnapshot(record: AiAgentRunRecord) {
    if (record.status !== 'starting' && record.status !== 'running') return null
    const state = liveSnapshots.get(record.id)
    if (!state) return null
    return toAgentRunLiveSnapshot(state)
  }

  function abort(access: RuntimeAccessContext, sessionId: string, runId: string): AgentRun {
    const run = requireScopedRun(access, sessionId, runId)
    enforceControlPolicy(access, 'abort')
    const handle = registry.get(runId)
    if (!handle) throw runNotActive()
    handle.abort()
    return toAgentRun(run)
  }

  async function steer(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    input: SteerAgentRunInput,
  ): Promise<AgentRun> {
    const run = requireScopedRun(access, sessionId, runId)
    enforceControlPolicy(access, 'steer')
    const handle = registry.get(runId)
    if (!handle) throw runNotActive()
    const images = await resolveInputImages({
      access,
      sessionId,
      model: runModelRef(run),
      attachmentIds: input.attachmentIds,
    })
    handle.steer({ text: input.text, ...(images ? { images } : {}) })
    return toAgentRun(run)
  }

  async function followUp(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    input: FollowUpAgentRunInput,
  ): Promise<AgentRun> {
    const run = requireScopedRun(access, sessionId, runId)
    enforceControlPolicy(access, 'follow_up')
    const handle = registry.get(runId)
    if (!handle) throw runNotActive()
    const images = await resolveInputImages({
      access,
      sessionId,
      model: runModelRef(run),
      attachmentIds: input.attachmentIds,
    })
    handle.followUp({ text: input.text, ...(images ? { images } : {}) })
    return toAgentRun(run)
  }

  async function recoverInterrupted(): Promise<RunRecoveryReport> {
    const runs = repository.listNonTerminal()
    const report: RunRecoveryReport = {
      scanned: runs.length,
      recoveredFromEntry: 0,
      interrupted: 0,
      corrupted: 0,
    }
    // 扫描到的 lane 集合：恢复完成后清理它们的过期 lease。
    const scannedLanes = new Map<string, { sessionId: string; lane: string }>()
    for (const run of runs) {
      scannedLanes.set(`${run.sessionId}\u0000${run.lane}`, { sessionId: run.sessionId, lane: run.lane })
      const runId = run.id
      if (registry.getBySessionLane(run.sessionId, run.lane)) continue

      const session = sessionRepository.findForRecovery(run.sessionId)
      if (!session) {
        report.interrupted += 1
        markInterrupted(run)
        continue
      }
      const recoveryAccess: RuntimeAccessContext = {
        principal: {
          kind: session.principalKind as RuntimeAccessContext['principal']['kind'],
          principalId: session.ownerId ?? session.externalUserId ?? session.id,
          tenantId: session.tenantId,
          projectId: session.projectId,
          externalUserId: session.externalUserId,
          appId: session.appId,
        },
        scope: {
          tenantId: session.tenantId,
          projectId: session.projectId,
          subjectType: session.subjectType,
          subjectId: session.subjectId,
        },
      }
      if (!sessionRepository.findInScope(session.id, recoveryAccess)) {
        report.interrupted += 1
        markInterrupted(run)
        continue
      }

      let entries
      try {
        entries = await sessionStore.findRunTerminalEntries({
          sessionId: run.sessionId,
          lane: run.lane,
          runId,
        })
      } catch (cause) {
        report.interrupted += 1
        logger.error(
          {
            err: cause,
            runId,
            sessionId: run.sessionId,
            requestId: run.requestId,
          },
          'Run 恢复读取 terminal entry 失败',
        )
        markInterrupted(run)
        continue
      }

      if (entries.length === 1) {
        const parsed = starterRunDataSchema.safeParse(entries[0]?.data)
        if (!parsed.success) {
          report.corrupted += 1
          logger.error(
            {
              runId,
              sessionId: run.sessionId,
              requestId: run.requestId,
              reason: parsed.error.message,
            },
            'Run terminal entry 解析失败，标记 interrupted',
          )
          markInterrupted(run)
          continue
        }
        const data = parsed.data
        if (
          data.runId !== runId ||
          data.sessionId !== run.sessionId ||
          data.lane !== run.lane ||
          data.agentId !== run.agentId ||
          data.agentRevision !== run.agentRevision
        ) {
          report.corrupted += 1
          logger.error(
            {
              runId,
              sessionId: run.sessionId,
              requestId: run.requestId,
            },
            'Run terminal entry 身份字段不匹配，标记 interrupted',
          )
          markInterrupted(run)
          continue
        }
        if (
          repository.completeWithTerminalEvent({
            id: runId,
            status: data.status,
            finalEntryId: data.finalEntryId,
            errorCode: data.errorCode,
            finishedAt: new Date(data.finishedAt),
            event: terminalEventForRecord(run, data.status, data.finalEntryId, data.errorCode),
            attempt: { attemptNo: run.currentAttemptNo },
          })
        ) {
          report.recoveredFromEntry += 1
        } else {
          // 已有终态（恢复函数同进程已修复），不再处理
        }
        continue
      }

      if (entries.length > 1) {
        report.corrupted += 1
        logger.error(
          {
            runId,
            sessionId: run.sessionId,
            requestId: run.requestId,
            entryCount: entries.length,
          },
          'Run 存在重复 terminal entry，视为损坏并标记 interrupted',
        )
        markInterrupted(run)
        continue
      }

      report.interrupted += 1
      logger.error(
        {
          runId,
          sessionId: run.sessionId,
          requestId: run.requestId,
          entryCount: entries.length,
        },
        'Run 缺少唯一 terminal entry，标记 interrupted',
      )
      markInterrupted(run)
    }
    // 只删过期行：未过期的 lease 可能属于仍在执行的其他实例；
    // 并发接管只会把行换成未过期新行，这里的条件删除不会误删。
    if (scannedLanes.size > 0) {
      laneLeaseStore.releaseExpired([...scannedLanes.values()])
    }
    return report
  }

  function markInterrupted(run: AiAgentRunRecord): void {
    repository.completeWithTerminalEvent({
      id: run.id,
      status: 'interrupted',
      finalEntryId: run.finalEntryId,
      errorCode: ApiErrorCodes.AI_RUN_INTERRUPTED,
      finishedAt: new Date(),
      event: terminalEventForRecord(run, 'failed', run.finalEntryId, ApiErrorCodes.AI_RUN_INTERRUPTED),
      attempt: { attemptNo: run.currentAttemptNo },
    })
  }

  /**
   * 执行到终态的主循环：executor result 先判定 auto retry（可重试错误 +
   * 未撞上限 + 无非幂等写门禁），命中就关闭旧 attempt、创建新 attempt 并
   * 重建 executor 继续；否则走 finalize。lease 不释放不重取，续租持续。
   */
  async function runToTerminal(
    context: RunContext,
    first: PreparedAgentExecution,
    startNextAttempt: (attemptNo: number) => PreparedAgentExecution,
  ): Promise<void> {
    const { runId, sessionId, requestId } = context.execution
    let prepared = first
    let pump = pumpExecutorEvents(prepared, context, publish)
    while (true) {
      let terminal: ExecutorTerminalResult
      try {
        const [result] = await Promise.all([prepared.result, pump])
        terminal = result
      } catch (cause) {
        prepared.controls.abort()
        logger.error({ err: cause, runId, sessionId, requestId }, 'Run 事件持久化失败，转入存储失败终态')
        terminal = storageFailureTerminal()
      }
      const next = maybeRetryAttempt(context, terminal, startNextAttempt)
      if (next) {
        prepared = next
        pump = pumpExecutorEvents(prepared, context, publish)
        continue
      }
      await finalizeRun(context, terminal)
      return
    }
  }

  function shouldAutoRetry(context: RunContext, terminal: ExecutorTerminalResult): boolean {
    if (terminal.status !== 'failed' || terminal.errorCode === null) return false
    if (!AUTO_RETRY_ERROR_CODES.has(terminal.errorCode)) return false
    if (context.storageFailed) return false
    if (context.retry.blockedBySideEffect) return false
    return context.currentAttemptNo < context.retry.maxAttempts
  }

  /**
   * auto retry 的 attempt 调度：旧 attempt 行落 failed，创建下一 attempt 行
   * （trigger=auto_retry，retry_reason 记录触发错误码），更新 Run 行指针并
   * 重建 executor。任何写入或重建失败都回落到原终态收尾，不产生悬挂状态。
   */
  function maybeRetryAttempt(
    context: RunContext,
    terminal: ExecutorTerminalResult,
    startNextAttempt: (attemptNo: number) => PreparedAgentExecution,
  ): PreparedAgentExecution | null {
    if (!shouldAutoRetry(context, terminal)) return null
    if (!attemptRepository) return null
    const { runId, sessionId, requestId } = context.execution
    const finishedAt = new Date()
    const nextAttemptNo = context.currentAttemptNo + 1
    try {
      const closed = attemptRepository.complete({
        runId,
        attemptNo: context.currentAttemptNo,
        status: 'failed',
        errorCode: terminal.errorCode,
        finishedAt,
      })
      if (!closed) return null
      attemptRepository.create({
        id: generateId(),
        runId,
        attemptNo: nextAttemptNo,
        trigger: 'auto_retry',
        retryReason: terminal.errorCode ?? undefined,
        ownerId: context.laneLease.ownerId,
        fencingToken: context.laneLease.fencingToken,
        startedAt: finishedAt,
      })
      if (!repository.updateCurrentAttemptNo(runId, nextAttemptNo)) {
        throw new Error('ai_agent_runs.current_attempt_no 更新失败')
      }
    } catch (cause) {
      logger.error({ err: cause, runId, sessionId, requestId }, 'Agent Run auto retry attempt 行写入失败')
      return null
    }
    context.currentAttemptNo = nextAttemptNo
    context.execution.setAttemptNo(nextAttemptNo)
    logger.warn(
      { runId, sessionId, requestId, attemptNo: nextAttemptNo, errorCode: terminal.errorCode },
      'Agent Run auto retry：创建新 Attempt 继续执行',
    )
    try {
      return startNextAttempt(nextAttemptNo)
    } catch (cause) {
      logger.error(
        { err: cause, runId, sessionId, requestId, attemptNo: nextAttemptNo },
        'Agent Run auto retry executor 重建失败',
      )
      return null
    }
  }

  async function finalizeRun(context: RunContext, terminal: ExecutorTerminalResult): Promise<void> {
    const { runId, sessionId, lane, requestId } = context.execution
    const finishedAt = new Date()
    // 终态事务前先把待合并的增量刷出，终态事件才能拿到最后一个 sequence。
    try {
      context.publisher.flush()
    } catch {
      // onStorageFailure 已经记录并标记，下面统一转存储失败终态。
    }
    if (context.storageFailed) {
      terminal = storageFailureTerminal()
    } else if (
      terminal.status === 'completed' &&
      context.outputMode === 'required' &&
      (!structuredOutputRepository || structuredOutputRepository.listByRun(runId).length === 0)
    ) {
      terminal = {
        status: 'failed',
        finalEntryId: terminal.finalEntryId,
        errorCode: ApiErrorCodes.AI_AGENT_CONFIG_INVALID,
      }
    }
    try {
      await sessionStore.appendRunTerminalEntry({
        sessionId,
        lane,
        data: toStarterRunData({
          runId,
          sessionId,
          lane,
          agentId: context.execution.agentId,
          agentRevision: context.execution.agentRevision,
          status: terminal.status,
          finalEntryId: terminal.finalEntryId,
          errorCode: terminal.errorCode,
          finishedAt,
        }),
      })
    } catch (cause) {
      logger.error({ err: cause, runId, sessionId, requestId }, 'starter.run 写入失败')
      await commitTerminal(context, {
        status: 'failed',
        finalEntryId: terminal.finalEntryId,
        errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
      })
      return
    }

    await commitTerminal(context, terminal)
  }

  async function commitTerminal(context: RunContext, terminal: ExecutorTerminalResult): Promise<void> {
    const { runId, sessionId, lane, requestId } = context.execution
    let committed: RunEvent | false = false
    try {
      committed = repository.completeWithTerminalEvent({
        id: runId,
        status: terminal.status,
        finalEntryId: terminal.finalEntryId,
        errorCode: terminal.errorCode,
        finishedAt: new Date(),
        event: terminalEvent({ runId, sessionId, lane, attemptNo: context.currentAttemptNo }, terminal),
        lease: { ownerId: context.laneLease.ownerId },
        attempt: { attemptNo: context.currentAttemptNo },
      })
      if (committed) {
        context.publisher.publishPersisted(committed)
      } else {
        logger.error({ runId, sessionId, requestId }, 'Run 主库终态事务未提交，不发布 terminal event')
      }
    } catch (cause) {
      logger.error({ err: cause, runId, sessionId, requestId }, 'Run 主库终态事务失败，不发布 terminal event')
    }
    context.telemetry.close({
      attributes: runSpanEndAttributes(terminal, committed !== false),
      ...(terminal.status === 'completed' && committed !== false ? {} : { status: { status: 'error' as const } }),
    })
    // Run 结束：清掉合并定时器与续租定时器，不留悬挂 timer。
    context.publisher.close()
    context.events.end()
    if (context.renewTimer) {
      clearInterval(context.renewTimer)
      context.renewTimer = null
    }
    for (const subscriber of context.subscribers) subscriber.end()
    context.subscribers.clear()
    contexts.delete(runId)
    liveSnapshots.delete(runId)
    // 释放顺序固定：终态事务之后先 db lease 再 registry。
    laneLeaseStore.release({ sessionId, lane, owner: context.laneLease })
    release(registry, runId, context.lease)
  }

  function requireActiveSession(access: RuntimeAccessContext, sessionId: string) {
    const record = sessionRepository.findInScope(sessionId, access)
    if (!record || record.archivedAt !== null) throw notFound()
    return record
  }

  /**
   * 附件输入解析：无 attachmentIds 时返回 undefined，纯文本路径零变化。
   * 归属或能力校验失败抛 AI_ATTACHMENT_NOT_FOUND / AI_IMAGE_NOT_SUPPORTED，
   * 调用点必须位于任何写操作之前。
   */
  async function resolveInputImages(input: {
    access: RuntimeAccessContext
    sessionId: string | null
    model: AiModelRef
    attachmentIds: string[] | undefined
  }): Promise<AgentControlImage[] | undefined> {
    const { access, sessionId, model, attachmentIds } = input
    if (!attachmentIds || attachmentIds.length === 0) return undefined
    const attachments = await resolveAttachments({
      access,
      sessionId,
      attachmentIds,
    })
    if (!supportsImageInput(model)) {
      throw new AppError(ApiErrorCodes.AI_IMAGE_NOT_SUPPORTED, '当前模型不支持图片输入', 400)
    }
    return attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      data: attachment.data,
      mimeType: attachment.mimeType,
    }))
  }

  /** steer / followUp 时从 Run snapshot 读启动时的模型引用；snapshot 是执行事实。 */
  function runModelRef(run: AiAgentRunRecord): AiModelRef {
    return agentRunSnapshotSchema.parse(JSON.parse(run.snapshotJson)).model
  }

  function requireScopedRun(access: RuntimeAccessContext, sessionId: string, runId: string) {
    const record = repository.findInScope(runId, sessionId, access)
    if (!record) throw notFound()
    return record
  }

  function notFound(): AppError {
    return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '资源不存在', 404)
  }

  function runNotActive(): AppError {
    return new AppError(ApiErrorCodes.AI_RUN_NOT_ACTIVE, 'Run 当前不在活动状态', 409)
  }

  function idempotencyConflict(): AppError {
    return new AppError(ApiErrorCodes.AI_IDEMPOTENCY_KEY_CONFLICT, '幂等键已绑定其他 Session', 409)
  }

  /** 幂等命中时返回与首次启动同构的结果：同一 runId + 从 sequence 0 起的事件流。 */
  function replayExistingRun(access: RuntimeAccessContext, sessionId: string, runId: string): StartRunResult {
    return { runId, events: subscribe(access, sessionId, runId, 0) }
  }

  return {
    startRun,
    get,
    activeRun,
    trace,
    timeline,
    sequenceForEvent,
    subscribe,
    structuredOutputs,
    adminStructuredOutputs,
    describeResolvedManifest,
    abort,
    steer,
    followUp,
    recoverInterrupted,
  }
}

async function pumpExecutorEvents(
  prepared: PreparedAgentExecution,
  context: RunContext,
  publish: (context: RunContext, event: RunEventDraft) => void,
): Promise<void> {
  for await (const event of prepared.events) {
    publish(context, event)
  }
}

function storageFailureTerminal(): ExecutorTerminalResult {
  return {
    status: 'failed',
    finalEntryId: null,
    errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
  }
}

/** Run span 的终态属性；事务未提交时标记为存储失败。 */
function runSpanEndAttributes(
  terminal: ExecutorTerminalResult,
  committed: boolean,
): AiSpanEndAttributes<'starter.ai.run'> {
  if (!committed) {
    return {
      'starter.ai.run.outcome': 'failed',
      'starter.ai.error.code': ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
      'starter.ai.error.category': 'storage',
    }
  }
  if (terminal.status === 'completed') {
    return {
      'starter.ai.run.outcome': 'completed',
      'starter.ai.run.completion_reason': terminal.completionReason ?? 'model_finished',
    }
  }
  return {
    'starter.ai.run.outcome': terminal.status,
    'starter.ai.error.code': terminal.errorCode ?? ApiErrorCodes.AI_UPSTREAM_ERROR,
    'starter.ai.error.category': toAiErrorCategory(terminal.errorCode),
  }
}

function buildEvent<T extends RunEvent['type']>(
  identity: { runId: string; sessionId: string; lane: string; attemptNo: number },
  type: T,
  data: Extract<RunEvent, { type: T }>['data'],
): RunEventDraft {
  return {
    runId: identity.runId,
    sessionId: identity.sessionId,
    lane: identity.lane,
    attemptNo: identity.attemptNo,
    turnIndex: null,
    stepId: null,
    modelCallId: null,
    messageId: null,
    toolCallId: null,
    toolExecutionId: null,
    type,
    data,
  } as RunEventDraft
}

function terminalEvent(
  identity: { runId: string; sessionId: string; lane: string; attemptNo: number },
  terminal: ExecutorTerminalResult,
): RunEventDraft {
  if (terminal.status === 'completed') {
    return buildEvent(identity, 'run.completed', {
      finalEntryId: terminal.finalEntryId,
      reason: terminal.completionReason ?? 'model_finished',
    })
  }
  if (terminal.status === 'aborted') {
    return buildEvent(identity, 'run.aborted', {
      code: ApiErrorCodes.AI_REQUEST_ABORTED,
    })
  }
  return buildEvent(identity, 'run.failed', {
    error: {
      code: terminal.errorCode ?? ApiErrorCodes.AI_UPSTREAM_ERROR,
      category: toAiErrorCategory(terminal.errorCode),
      retryable: isAiRetryableErrorCode(terminal.errorCode),
    },
    finalEntryId: terminal.finalEntryId,
  })
}

function terminalEventForRecord(
  run: AiAgentRunRecord,
  status: 'completed' | 'failed' | 'aborted' | 'interrupted',
  finalEntryId: string | null,
  errorCode: string | null,
): RunEventDraft {
  const identity = {
    runId: run.id,
    sessionId: run.sessionId,
    lane: run.lane,
    attemptNo: run.currentAttemptNo,
  }
  if (status === 'completed') {
    return terminalEvent(identity, {
      status,
      finalEntryId,
      errorCode: errorCode as ApiErrorCode | null,
      completionReason: 'model_finished',
    })
  }
  if (status === 'aborted') {
    return terminalEvent(identity, {
      status,
      finalEntryId,
      errorCode: errorCode as ApiErrorCode | null,
    })
  }
  return terminalEvent(identity, {
    status: 'failed',
    finalEntryId,
    errorCode: errorCode as ApiErrorCode | null,
  })
}

function buildSnapshot(resolved: import('../agent/agent.service.js').ResolvedAgentDefinition): AgentRunSnapshot {
  return {
    schemaVersion: 3,
    agentId: resolved.id,
    agentRevision: resolved.revision,
    model: resolved.model,
    systemPromptId: resolved.config.systemPromptId,
    skillIds: resolved.config.skillIds,
    toolRefs: resolved.config.toolRefs,
    outputContract: resolved.outputContract?.ref ?? null,
    outputMode: resolved.outputContract?.mode ?? resolved.config.outputMode,
    thinkingLevel: resolved.config.thinkingLevel,
    maxTurns: resolved.config.maxTurns,
  }
}

function release(registry: ActiveRunRegistry, runId: string, lease: ActiveRunLease): void {
  try {
    registry.release(runId)
    // attach 之前没有 runId handle，必须同时释放原始 lane lease。
    registry.release(lease)
  } catch {
    // release 幂等，失败只记录
  }
}

async function ensureLane(sessionStore: AgentSessionStore, sessionId: string, lane: string): Promise<void> {
  if (lane === 'main') return
  try {
    await sessionStore.createLane({ sessionId, lane })
  } catch (error) {
    if (isAlreadyExistsError(error)) return
    throw error
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('Lane already exists') || error.message.includes('already_exists'))
  )
}

/**
 * 幂等隔离 scope：与 session.repository 的 accessWhere 判据字段一一对应，
 * 同一可见性身份算出同一 scope，不同调用方（不同应用或用户）互不冲突。
 */
function idempotencyScopeOf(access: RuntimeAccessContext): string {
  const p = access.principal
  return [
    p.kind,
    p.tenantId,
    p.projectId,
    p.principalId,
    p.externalUserId ?? '',
    access.scope.subjectType ?? '',
    access.scope.subjectId ?? '',
  ].join('|')
}

/** create 命中幂等部分唯一索引：better-sqlite3 唯一约束错误或携带索引名的错误。 */
function isIdempotencyUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ((error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return true
  }
  return error instanceof Error && error.message.includes('ai_agent_runs_idempotency_unique')
}
