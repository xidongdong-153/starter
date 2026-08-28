import type { Logger } from "pino";
import { NOOP_TELEMETRY_CONTEXT } from "@earendil-works/pi-telemetry";
import type { TelemetryContext } from "@earendil-works/pi-telemetry";
import type {
  AgentRun,
  AgentRunSnapshot,
  ApiErrorCode,
  RunEvent,
  RunTimeline,
  RunTrace,
  StartAgentRunInput,
} from "@starter/contracts";
import { ApiErrorCodes, starterRunDataSchema } from "@starter/contracts";

import type {
  ActiveRunLease,
  ActiveRunRegistry,
  AgentSessionStore,
  AttachableActiveRunControls,
  PiAgentExecutor,
  PreparedAgentExecution,
  RunExecutionContext,
} from "@api/infra/agent/index.js";
import {
  ActiveRunRegistryError,
  createRunExecutionContext,
} from "@api/infra/agent/index.js";
import type { ExecutorTerminalResult } from "@api/infra/agent/agent-executor.js";
import { createRunEventDraft } from "@api/infra/agent/run-execution-context.js";
import type {
  AiSpanEndAttributes,
  AiSpanScope,
} from "@api/infra/telemetry/index.js";
import { openAiSpanScope } from "@api/infra/telemetry/index.js";
import { AppError } from "@api/shared/app-error.js";
import { generateId } from "@api/shared/id.js";
import {
  toAiErrorCategory,
  isAiRetryableErrorCode,
} from "@api/modules/ai/ai-error.js";
import type { RuntimeAccessContext } from "@api/modules/ai/principal.js";

import type { AiAgentDefinitionService } from "../agent/agent.service.js";
import type { AiStructuredOutputRepository } from "../output/structured-output.repository.js";
import type { AiAgentSessionRepository } from "../session/session.repository.js";
import type { RunLiveSnapshotState } from "./run.live-snapshot.js";
import {
  applyRunEvent,
  createRunLiveSnapshot,
  toAgentRunLiveSnapshot,
} from "./run.live-snapshot.js";
import { toAgentRun, toStarterRunData } from "./run.presenter.js";
import type {
  AiAgentRunRecord,
  AiAgentRunRepository,
} from "./run.repository.js";
import type {
  AiRunEventRepository,
  RunEventDraft,
} from "./run-event.repository.js";
import type { AiRunTraceRepository } from "./run-trace.repository.js";
import { AsyncEventQueue } from "@api/infra/agent/pi-event-mapper.js";
import { RunEventPublisher } from "./run-event.publisher.js";

/** 对外 SSE 订阅队列的有界缓冲；超限时关闭 transport，不阻塞 Agent loop。 */
const MAX_PENDING_EVENTS = 1024;

export interface StartRunResult {
  runId: string;
  events: AsyncIterable<RunEvent>;
}

export interface RunRecoveryReport {
  scanned: number;
  recoveredFromEntry: number;
  interrupted: number;
  corrupted: number;
}

export interface AiAgentRunService {
  startRun: (input: {
    access: RuntimeAccessContext;
    sessionId: string;
    input: StartAgentRunInput;
    requestId: string;
  }) => Promise<StartRunResult>;
  get: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
  ) => AgentRun;
  /** 返回该 session 指定 lane 上仍在跑的 Run；没有就是 null。 */
  activeRun: (
    access: RuntimeAccessContext,
    sessionId: string,
    lane: string,
  ) => AgentRun | null;
  abort: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
  ) => AgentRun;
  steer: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    text: string,
  ) => AgentRun;
  followUp: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    text: string,
  ) => AgentRun;
  trace: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
  ) => RunTrace;
  timeline: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
    pageSize: number,
  ) => RunTimeline;
  sequenceForEvent: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    eventId: string,
  ) => number;
  subscribe: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
  ) => AsyncIterable<RunEvent>;
  recoverInterrupted: () => Promise<RunRecoveryReport>;
}

interface RunContext {
  execution: RunExecutionContext;
  lease: ActiveRunLease;
  outputMode: "optional" | "required";
  /** Publisher 写库失败后的确定出口标记；终态强制为存储失败。 */
  storageFailed: boolean;
  events: AsyncEventQueue<RunEvent>;
  subscribers: Set<AsyncEventQueue<RunEvent>>;
  publisher: RunEventPublisher;
  telemetry: AiSpanScope<"starter.ai.run">;
  live: RunLiveSnapshotState;
}

export function createAiAgentRunService(input: {
  repository: AiAgentRunRepository;
  sessionRepository: AiAgentSessionRepository;
  sessionStore: AgentSessionStore;
  agentService: AiAgentDefinitionService;
  registry: ActiveRunRegistry;
  executor: PiAgentExecutor;
  logger: Logger;
  eventRepository: AiRunEventRepository;
  traceRepository?: AiRunTraceRepository;
  structuredOutputRepository?: AiStructuredOutputRepository;
  /** Run span 的根上下文；默认 no-op。 */
  telemetry?: TelemetryContext;
}): AiAgentRunService {
  const {
    repository,
    sessionRepository,
    sessionStore,
    agentService,
    registry,
    executor,
    logger,
  } = input;
  const structuredOutputRepository = input.structuredOutputRepository;
  const eventRepository = input.eventRepository;
  const telemetry = input.telemetry ?? NOOP_TELEMETRY_CONTEXT;
  /** 活跃 Run 的进程内快照，Run 终态后立即移除。 */
  const liveSnapshots = new Map<string, RunLiveSnapshotState>();
  const contexts = new Map<string, RunContext>();

  function publish(context: RunContext, event: RunEventDraft): void {
    context.publisher.publish(event);
  }

  async function startRun(startInput: {
    access: RuntimeAccessContext;
    sessionId: string;
    input: StartAgentRunInput;
    requestId: string;
  }): Promise<StartRunResult> {
    const { access, sessionId, requestId } = startInput;
    const session = requireActiveSession(access, sessionId);
    const agentId = startInput.input.agentId ?? session.defaultAgentId;
    if (!agentId) {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        "启动 Run 需要 agentId 或 Session 的 defaultAgentId",
        400,
      );
    }

    const resolved = await agentService.resolve(agentId, access);
    const lane = startInput.input.lane ?? "main";
    const runId = generateId();
    const snapshot = buildSnapshot(resolved.id, resolved.revision, resolved);

    let lease: ActiveRunLease;
    try {
      lease = registry.reserve(sessionId, lane);
    } catch (error) {
      if (error instanceof ActiveRunRegistryError && error.kind === "busy") {
        throw new AppError(
          ApiErrorCodes.AI_SESSION_BUSY,
          "该 Session lane 已有 Run 在运行",
          409,
        );
      }
      throw error;
    }

    // Pi 只自动创建 main lane；非 main lane 需要显式创建（幂等：已存在时忽略）。
    try {
      await ensureLane(sessionStore, sessionId, lane);
    } catch (cause) {
      registry.release(lease);
      logger.error(
        { err: cause, sessionId, lane, requestId },
        "Agent Run lane 创建失败",
      );
      throw new AppError(
        ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
        "Agent Session lane 创建失败",
        500,
      );
    }

    if (!eventRepository) {
      throw new Error("Run Event repository 未配置");
    }
    const events = new AsyncEventQueue<RunEvent>(MAX_PENDING_EVENTS);
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
    });
    let controls: AttachableActiveRunControls | null = null;
    // Run span 包住整个异步 Run 执行，结束时机是终态事务。
    const runTelemetry = openAiSpanScope(telemetry, "starter.ai.run", {
      "starter.ai.run.id": runId,
      "starter.ai.session.id": sessionId,
      "starter.ai.lane": lane,
      "starter.ai.request.id": requestId,
      "starter.ai.principal.kind": access.principal.kind,
      "starter.ai.tenant.id": access.scope.tenantId,
      "starter.ai.project.id": access.scope.projectId,
      "starter.ai.application.id": access.principal.appId ?? undefined,
      "starter.ai.external_user.id":
        access.principal.externalUserId ?? undefined,
      "starter.ai.subject.type": access.scope.subjectType ?? undefined,
      "starter.ai.subject.id": access.scope.subjectId ?? undefined,
      "starter.ai.agent.id": resolved.id,
      "starter.ai.agent.revision": resolved.revision,
      "starter.ai.provider": resolved.model.providerId,
      "starter.ai.model": resolved.model.modelId,
      "starter.ai.output.mode":
        resolved.outputContract?.mode ?? resolved.config.outputMode,
      "starter.ai.output.contract.name": resolved.outputContract?.name,
      "starter.ai.output.contract.version": resolved.outputContract?.version,
    });
    const context: RunContext = {
      execution,
      lease,
      outputMode: resolved.outputContract?.mode ?? resolved.config.outputMode,
      storageFailed: false,
      events,
      subscribers: new Set(),
      publisher: new RunEventPublisher({
        repository: eventRepository,
        sink: {
          push: (event) => {
            for (const subscriber of context.subscribers)
              subscriber.push(event);
          },
        },
        onPersisted: (event) => applyRunEvent(context.live, event),
        onStorageFailure: (error) => {
          // 事件写库失败：停止当前 transport 的新事件，Run 转入存储失败终态。
          context.storageFailed = true;
          logger.error(
            { err: error, runId, sessionId, requestId },
            "Run 事件持久化失败，转入存储失败终态",
          );
          controls?.abort();
        },
      }),
      telemetry: runTelemetry,
      live: createRunLiveSnapshot(resolved.maxTurns),
    };
    contexts.set(runId, context);
    liveSnapshots.set(runId, context.live);

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
      });
    } catch (cause) {
      registry.release(lease);
      logger.error(
        { err: cause, runId, sessionId, requestId },
        "Agent Run row 创建失败",
      );
      runTelemetry.close({
        attributes: {
          "starter.ai.run.outcome": "failed",
          "starter.ai.error.code": ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
          "starter.ai.error.category": "storage",
        },
        status: { status: "error" },
      });
      throw new AppError(
        ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
        "创建 Agent Run 失败",
        500,
      );
    }

    let prepared: PreparedAgentExecution;
    try {
      prepared = executor.prepare({
        execution,
        input: startInput.input.input,
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
                      value,
                    }),
                  publish: (event) => {
                    publish(
                      context,
                      createRunEventDraft(
                        execution,
                        "structured_output.available",
                        {
                          contract: event.contract,
                          value: event.value,
                          referenceId: event.referenceId,
                        },
                        { toolCallId: event.toolCallId },
                      ),
                    );
                  },
                }
              : undefined,
        },
      });
    } catch (cause) {
      logger.error(
        { err: cause, runId, sessionId, requestId },
        "Agent Run prepare 失败",
      );
      void finalizeRun(context, {
        status: "failed",
        finalEntryId: null,
        errorCode: ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      });
      return { runId, events };
    }

    try {
      registry.attach(lease, runId, prepared.controls);
      controls = prepared.controls;
    } catch (cause) {
      logger.error(
        { err: cause, runId, sessionId, requestId },
        "Agent Run attach 失败",
      );
      void finalizeRun(context, {
        status: "failed",
        finalEntryId: null,
        errorCode: ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      });
      return { runId, events };
    }

    if (!repository.markRunning(runId, new Date())) {
      logger.error(
        { runId, sessionId, requestId },
        "Agent Run starting -> running 更新失败",
      );
      void finalizeRun(context, {
        status: "failed",
        finalEntryId: null,
        errorCode: ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      });
      return { runId, events };
    }

    try {
      publish(
        context,
        createRunEventDraft(execution, "run.started", {
          agentId: execution.agentId,
          agentRevision: execution.agentRevision,
          model: resolved.model,
          outputContract: execution.outputContract?.ref ?? null,
        }),
      );
    } catch (cause) {
      logger.error(
        { err: cause, runId, sessionId, requestId },
        "Run started 事件持久化失败",
      );
      prepared.controls.abort();
      void finalizeRun(context, storageFailureTerminal());
      return { runId, events };
    }

    void prepared.start().catch((cause) => {
      logger.error(
        { err: cause, runId, sessionId, requestId },
        "Agent Executor start 失败",
      );
    });

    const pump = pumpExecutorEvents(prepared, context, publish);
    void runToTerminal(context, prepared, pump);
    return { runId, events };
  }

  function trace(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
  ): RunTrace {
    requireScopedRun(access, sessionId, runId);
    const result = input.traceRepository?.findByRunId(runId);
    if (!result) throw notFound();
    return result;
  }

  function timeline(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
    pageSize: number,
  ): RunTimeline {
    requireScopedRun(access, sessionId, runId);
    const rows = eventRepository.listAfter(runId, afterSequence, pageSize + 1);
    const items = rows.slice(0, pageSize);
    return {
      items,
      afterSequence,
      nextSequence:
        rows.length > pageSize ? (items.at(-1)?.sequence ?? null) : null,
      hasMore: rows.length > pageSize,
    };
  }

  function sequenceForEvent(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    eventId: string,
  ): number {
    requireScopedRun(access, sessionId, runId);
    const sequence = eventRepository.findSequenceByEventId(runId, eventId);
    if (sequence === undefined) {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        "Last-Event-ID 不属于该 Run",
        400,
      );
    }
    return sequence;
  }

  function subscribe(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
  ): AsyncIterable<RunEvent> {
    const record = requireScopedRun(access, sessionId, runId);
    const context = contexts.get(runId);

    return replayAndSubscribe({
      record,
      context,
      runId,
      afterSequence,
    });
  }

  async function* replayAndSubscribe(input: {
    record: AiAgentRunRecord;
    context: RunContext | undefined;
    runId: string;
    afterSequence: number;
  }): AsyncGenerator<RunEvent> {
    const { record, context, runId, afterSequence } = input;
    if (!context) {
      yield* listAllEventsAfter(runId, afterSequence);
      return;
    }

    const queue = new AsyncEventQueue<RunEvent>(MAX_PENDING_EVENTS);
    context.subscribers.add(queue);
    const watermark = eventRepository.watermark(runId);
    try {
      // 先回放订阅建立时的持久 watermark，回放期间产生的新事件留在实时队列。
      yield* listEventsThrough(runId, afterSequence, watermark);
      if (record.status !== "starting" && record.status !== "running") return;

      for await (const event of queue) {
        if (event.sequence <= watermark) continue;
        yield event;
      }
    } finally {
      context.subscribers.delete(queue);
      queue.end();
    }
  }

  function* listEventsThrough(
    runId: string,
    afterSequence: number,
    watermark: number,
  ): Generator<RunEvent> {
    let cursor = afterSequence;
    while (cursor < watermark) {
      const rows = eventRepository.listAfter(
        runId,
        cursor,
        Math.min(MAX_PENDING_EVENTS, watermark - cursor),
      );
      if (rows.length === 0) return;
      for (const event of rows) {
        if (event.sequence > watermark) return;
        cursor = event.sequence;
        yield event;
      }
    }
  }

  function* listAllEventsAfter(
    runId: string,
    afterSequence: number,
  ): Generator<RunEvent> {
    let cursor = afterSequence;
    while (true) {
      const rows = eventRepository.listAfter(runId, cursor, MAX_PENDING_EVENTS);
      if (rows.length === 0) return;
      for (const event of rows) {
        cursor = event.sequence;
        yield event;
      }
      if (rows.length < MAX_PENDING_EVENTS) return;
    }
  }

  function get(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
  ): AgentRun {
    const record = requireScopedRun(access, sessionId, runId);
    return toAgentRun(record, readLiveSnapshot(record));
  }

  /**
   * 刷新页面后找回 runId 的入口。
   *
   * 只看主库 Run 行的 starting / running，不看 registry：进程重启后
   * `recoverInterrupted` 已经把非终态 Run 落成 interrupted，这里就返回 null。
   */
  function activeRun(
    access: RuntimeAccessContext,
    sessionId: string,
    lane: string,
  ): AgentRun | null {
    requireActiveSession(access, sessionId);
    const record = repository.findActiveInScope(sessionId, lane, access);
    if (!record) return null;
    return toAgentRun(record, readLiveSnapshot(record));
  }

  /**
   * 活跃快照只在 Run 非终态时返回，终态后为 null，客户端回落 transcript。
   *
   * 判据用 Run row 状态而不是 registry handle：finalizeRun 先更新主库终态、
   * 后 release registry，两步之间存在窗口，按 handle 判断会返回「终态 + 非空快照」
   * 的非法组合。
   */
  function readLiveSnapshot(record: AiAgentRunRecord) {
    if (record.status !== "starting" && record.status !== "running")
      return null;
    const state = liveSnapshots.get(record.id);
    if (!state) return null;
    return toAgentRunLiveSnapshot(state);
  }

  function abort(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
  ): AgentRun {
    const run = requireScopedRun(access, sessionId, runId);
    const handle = registry.get(runId);
    if (!handle) throw runNotActive();
    handle.abort();
    return toAgentRun(run);
  }

  function steer(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    text: string,
  ): AgentRun {
    const run = requireScopedRun(access, sessionId, runId);
    const handle = registry.get(runId);
    if (!handle) throw runNotActive();
    handle.steer(text);
    return toAgentRun(run);
  }

  function followUp(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    text: string,
  ): AgentRun {
    const run = requireScopedRun(access, sessionId, runId);
    const handle = registry.get(runId);
    if (!handle) throw runNotActive();
    handle.followUp(text);
    return toAgentRun(run);
  }

  async function recoverInterrupted(): Promise<RunRecoveryReport> {
    const runs = repository.listNonTerminal();
    const report: RunRecoveryReport = {
      scanned: runs.length,
      recoveredFromEntry: 0,
      interrupted: 0,
      corrupted: 0,
    };
    for (const run of runs) {
      const runId = run.id;
      if (registry.getBySessionLane(run.sessionId, run.lane)) continue;

      const session = sessionRepository.findForRecovery(run.sessionId);
      if (!session) {
        report.interrupted += 1;
        markInterrupted(run);
        continue;
      }
      const recoveryAccess: RuntimeAccessContext = {
        principal: {
          kind: session.principalKind as RuntimeAccessContext["principal"]["kind"],
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
      };
      if (!sessionRepository.findInScope(session.id, recoveryAccess)) {
        report.interrupted += 1;
        markInterrupted(run);
        continue;
      }

      let entries;
      try {
        entries = await sessionStore.findRunTerminalEntries({
          sessionId: run.sessionId,
          lane: run.lane,
          runId,
        });
      } catch (cause) {
        report.interrupted += 1;
        logger.error(
          {
            err: cause,
            runId,
            sessionId: run.sessionId,
            requestId: run.requestId,
          },
          "Run 恢复读取 terminal entry 失败",
        );
        markInterrupted(run);
        continue;
      }

      if (entries.length === 1) {
        const parsed = starterRunDataSchema.safeParse(entries[0]?.data);
        if (!parsed.success) {
          report.corrupted += 1;
          logger.error(
            {
              runId,
              sessionId: run.sessionId,
              requestId: run.requestId,
              reason: parsed.error.message,
            },
            "Run terminal entry 解析失败，标记 interrupted",
          );
          markInterrupted(run);
          continue;
        }
        const data = parsed.data;
        if (
          data.runId !== runId ||
          data.sessionId !== run.sessionId ||
          data.lane !== run.lane ||
          data.agentId !== run.agentId ||
          data.agentRevision !== run.agentRevision
        ) {
          report.corrupted += 1;
          logger.error(
            {
              runId,
              sessionId: run.sessionId,
              requestId: run.requestId,
            },
            "Run terminal entry 身份字段不匹配，标记 interrupted",
          );
          markInterrupted(run);
          continue;
        }
        if (
          repository.completeWithTerminalEvent({
            id: runId,
            status: data.status,
            finalEntryId: data.finalEntryId,
            errorCode: data.errorCode,
            finishedAt: new Date(data.finishedAt),
            event: terminalEventForRecord(
              run,
              data.status,
              data.finalEntryId,
              data.errorCode,
            ),
          })
        ) {
          report.recoveredFromEntry += 1;
        } else {
          // 已有终态（恢复函数同进程已修复），不再处理
        }
        continue;
      }

      if (entries.length > 1) {
        report.corrupted += 1;
        logger.error(
          {
            runId,
            sessionId: run.sessionId,
            requestId: run.requestId,
            entryCount: entries.length,
          },
          "Run 存在重复 terminal entry，视为损坏并标记 interrupted",
        );
        markInterrupted(run);
        continue;
      }

      report.interrupted += 1;
      logger.error(
        {
          runId,
          sessionId: run.sessionId,
          requestId: run.requestId,
          entryCount: entries.length,
        },
        "Run 缺少唯一 terminal entry，标记 interrupted",
      );
      markInterrupted(run);
    }
    return report;
  }

  function markInterrupted(run: AiAgentRunRecord): void {
    repository.completeWithTerminalEvent({
      id: run.id,
      status: "interrupted",
      finalEntryId: run.finalEntryId,
      errorCode: ApiErrorCodes.AI_RUN_INTERRUPTED,
      finishedAt: new Date(),
      event: terminalEventForRecord(
        run,
        "failed",
        run.finalEntryId,
        ApiErrorCodes.AI_RUN_INTERRUPTED,
      ),
    });
  }

  async function runToTerminal(
    context: RunContext,
    prepared: PreparedAgentExecution,
    pump: Promise<void>,
  ): Promise<void> {
    const { runId, sessionId, requestId } = context.execution;
    let terminal: ExecutorTerminalResult;
    try {
      const [result] = await Promise.all([prepared.result, pump]);
      terminal = result;
    } catch (cause) {
      prepared.controls.abort();
      logger.error(
        { err: cause, runId, sessionId, requestId },
        "Run 事件持久化失败，转入存储失败终态",
      );
      terminal = storageFailureTerminal();
    }
    await finalizeRun(context, terminal);
  }

  async function finalizeRun(
    context: RunContext,
    terminal: ExecutorTerminalResult,
  ): Promise<void> {
    const { runId, sessionId, lane, requestId } = context.execution;
    const finishedAt = new Date();
    // 终态事务前先把待合并的增量刷出，终态事件才能拿到最后一个 sequence。
    try {
      context.publisher.flush();
    } catch {
      // onStorageFailure 已经记录并标记，下面统一转存储失败终态。
    }
    if (context.storageFailed) {
      terminal = storageFailureTerminal();
    } else if (
      terminal.status === "completed" &&
      context.outputMode === "required" &&
      (!structuredOutputRepository ||
        structuredOutputRepository.listByRun(runId).length === 0)
    ) {
      terminal = {
        status: "failed",
        finalEntryId: terminal.finalEntryId,
        errorCode: ApiErrorCodes.AI_AGENT_CONFIG_INVALID,
      };
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
      });
    } catch (cause) {
      logger.error(
        { err: cause, runId, sessionId, requestId },
        "starter.run 写入失败",
      );
      await commitTerminal(context, {
        status: "failed",
        finalEntryId: terminal.finalEntryId,
        errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
      });
      return;
    }

    await commitTerminal(context, terminal);
  }

  async function commitTerminal(
    context: RunContext,
    terminal: ExecutorTerminalResult,
  ): Promise<void> {
    const { runId, sessionId, lane, requestId } = context.execution;
    const committed = repository.completeWithTerminalEvent({
      id: runId,
      status: terminal.status,
      finalEntryId: terminal.finalEntryId,
      errorCode: terminal.errorCode,
      finishedAt: new Date(),
      event: terminalEvent({ runId, sessionId, lane }, terminal),
    });
    if (committed) {
      context.publisher.publishPersisted(committed);
    } else {
      logger.error(
        { runId, sessionId, requestId },
        "Run 主库终态事务未提交，不发布 terminal event",
      );
    }
    context.telemetry.close({
      attributes: runSpanEndAttributes(terminal, committed !== false),
      ...(terminal.status === "completed" && committed !== false
        ? {}
        : { status: { status: "error" as const } }),
    });
    // Run 结束：清掉合并定时器，不留悬挂 timer。
    context.publisher.close();
    for (const subscriber of context.subscribers) subscriber.end();
    context.subscribers.clear();
    contexts.delete(runId);
    liveSnapshots.delete(runId);
    release(registry, runId, context.lease);
  }

  function requireActiveSession(
    access: RuntimeAccessContext,
    sessionId: string,
  ) {
    const record = sessionRepository.findInScope(sessionId, access);
    if (!record || record.archivedAt !== null) throw notFound();
    return record;
  }

  function requireScopedRun(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
  ) {
    const record = repository.findInScope(runId, sessionId, access);
    if (!record) throw notFound();
    return record;
  }

  function notFound(): AppError {
    return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "资源不存在", 404);
  }

  function runNotActive(): AppError {
    return new AppError(
      ApiErrorCodes.AI_RUN_NOT_ACTIVE,
      "Run 当前不在活动状态",
      409,
    );
  }

  return {
    startRun,
    get,
    activeRun,
    trace,
    timeline,
    sequenceForEvent,
    subscribe,
    abort,
    steer,
    followUp,
    recoverInterrupted,
  };
}

async function pumpExecutorEvents(
  prepared: PreparedAgentExecution,
  context: RunContext,
  publish: (context: RunContext, event: RunEventDraft) => void,
): Promise<void> {
  for await (const event of prepared.events) {
    publish(context, event);
  }
}

function storageFailureTerminal(): ExecutorTerminalResult {
  return {
    status: "failed",
    finalEntryId: null,
    errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
  };
}

/** Run span 的终态属性；事务未提交时标记为存储失败。 */
function runSpanEndAttributes(
  terminal: ExecutorTerminalResult,
  committed: boolean,
): AiSpanEndAttributes<"starter.ai.run"> {
  if (!committed) {
    return {
      "starter.ai.run.outcome": "failed",
      "starter.ai.error.code": ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
      "starter.ai.error.category": "storage",
    };
  }
  if (terminal.status === "completed") {
    return {
      "starter.ai.run.outcome": "completed",
      "starter.ai.run.completion_reason":
        terminal.completionReason ?? "model_finished",
    };
  }
  return {
    "starter.ai.run.outcome": terminal.status,
    "starter.ai.error.code":
      terminal.errorCode ?? ApiErrorCodes.AI_UPSTREAM_ERROR,
    "starter.ai.error.category": toAiErrorCategory(terminal.errorCode),
  };
}

function buildEvent<T extends RunEvent["type"]>(
  identity: { runId: string; sessionId: string; lane: string },
  type: T,
  data: Extract<RunEvent, { type: T }>["data"],
): RunEventDraft {
  return {
    runId: identity.runId,
    sessionId: identity.sessionId,
    lane: identity.lane,
    turnIndex: null,
    stepId: null,
    modelCallId: null,
    messageId: null,
    toolCallId: null,
    toolExecutionId: null,
    type,
    data,
  } as RunEventDraft;
}

function terminalEvent(
  identity: { runId: string; sessionId: string; lane: string },
  terminal: ExecutorTerminalResult,
): RunEventDraft {
  if (terminal.status === "completed") {
    return buildEvent(identity, "run.completed", {
      finalEntryId: terminal.finalEntryId,
      reason: terminal.completionReason ?? "model_finished",
    });
  }
  if (terminal.status === "aborted") {
    return buildEvent(identity, "run.aborted", {
      code: ApiErrorCodes.AI_REQUEST_ABORTED,
    });
  }
  return buildEvent(identity, "run.failed", {
    error: {
      code: terminal.errorCode ?? ApiErrorCodes.AI_UPSTREAM_ERROR,
      category: toAiErrorCategory(terminal.errorCode),
      retryable: isAiRetryableErrorCode(terminal.errorCode),
    },
    finalEntryId: terminal.finalEntryId,
  });
}

function terminalEventForRecord(
  run: AiAgentRunRecord,
  status: "completed" | "failed" | "aborted" | "interrupted",
  finalEntryId: string | null,
  errorCode: string | null,
): RunEventDraft {
  const identity = {
    runId: run.id,
    sessionId: run.sessionId,
    lane: run.lane,
  };
  if (status === "completed") {
    return terminalEvent(identity, {
      status,
      finalEntryId,
      errorCode: errorCode as ApiErrorCode | null,
      completionReason: "model_finished",
    });
  }
  if (status === "aborted") {
    return terminalEvent(identity, {
      status,
      finalEntryId,
      errorCode: errorCode as ApiErrorCode | null,
    });
  }
  return terminalEvent(identity, {
    status: "failed",
    finalEntryId,
    errorCode: errorCode as ApiErrorCode | null,
  });
}

function buildSnapshot(
  agentId: string,
  agentRevision: number,
  resolved: import("../agent/agent.service.js").ResolvedAgentDefinition,
): AgentRunSnapshot {
  return {
    schemaVersion: 2,
    agentId,
    agentRevision,
    model: resolved.model,
    systemPromptId: resolved.config.systemPromptId,
    skillIds: resolved.config.skillIds,
    toolRefs: resolved.config.toolRefs,
    outputContract: resolved.outputContract?.ref ?? null,
    outputMode: resolved.outputContract?.mode ?? resolved.config.outputMode,
    thinkingLevel: resolved.config.thinkingLevel,
    maxTurns: resolved.config.maxTurns,
  };
}

function release(
  registry: ActiveRunRegistry,
  runId: string,
  lease: ActiveRunLease,
): void {
  try {
    registry.release(runId);
    // attach 之前没有 runId handle，必须同时释放原始 lane lease。
    registry.release(lease);
  } catch {
    // release 幂等，失败只记录
  }
}

async function ensureLane(
  sessionStore: AgentSessionStore,
  sessionId: string,
  lane: string,
): Promise<void> {
  if (lane === "main") return;
  try {
    await sessionStore.createLane({ sessionId, lane });
  } catch (error) {
    if (isAlreadyExistsError(error)) return;
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Lane already exists") ||
      error.message.includes("already_exists"))
  );
}
