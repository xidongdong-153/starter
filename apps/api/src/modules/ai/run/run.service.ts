import type { Logger } from "pino";
import type {
  AgentRun,
  AgentRunSnapshot,
  HarnessEvent,
  StartAgentRunInput,
} from "@starter/contracts";
import { ApiErrorCodes, starterRunDataSchema } from "@starter/contracts";

import type {
  ActiveRunLease,
  ActiveRunRegistry,
  AgentSessionStore,
  EventSequencer,
  PiAgentExecutor,
  PreparedAgentExecution,
} from "@api/infra/agent/index.js";
import {
  ActiveRunRegistryError,
  createEventSequencer,
} from "@api/infra/agent/index.js";
import type { ExecutorTerminalResult } from "@api/infra/agent/agent-executor.js";
import { AppError } from "@api/shared/app-error.js";
import { generateId } from "@api/shared/id.js";
import type { RuntimeAccessContext } from "@api/modules/ai/principal.js";

import type { AiAgentDefinitionService } from "../agent/agent.service.js";
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
import { AsyncEventQueue } from "@api/infra/agent/pi-event-mapper.js";

/** 对外 SSE 订阅队列的有界缓冲；超限时关闭 transport，不阻塞 Agent loop。 */
const MAX_PENDING_EVENTS = 1024;

export interface StartRunResult {
  runId: string;
  events: AsyncIterable<HarnessEvent>;
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
  recoverInterrupted: () => Promise<RunRecoveryReport>;
}

interface RunContext {
  runId: string;
  sessionId: string;
  lane: string;
  agentId: string;
  agentRevision: number;
  requestId: string;
  lease: ActiveRunLease;
  sequencer: EventSequencer;
  events: AsyncEventQueue<HarnessEvent>;
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

  /** 活跃 Run 的进程内快照，Run 终态后立即移除。 */
  const liveSnapshots = new Map<string, RunLiveSnapshotState>();

  /** 事件进入对外队列的唯一入口：先折叠进快照，再推给订阅方。 */
  function publish(context: RunContext, event: HarnessEvent): void {
    applyRunEvent(context.live, event);
    context.events.push(event);
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

    const events = new AsyncEventQueue<HarnessEvent>(MAX_PENDING_EVENTS);
    const sequencer = createEventSequencer();
    const context: RunContext = {
      runId,
      sessionId,
      lane,
      agentId: resolved.id,
      agentRevision: resolved.revision,
      requestId,
      lease,
      sequencer,
      events,
      live: createRunLiveSnapshot(resolved.maxTurns),
    };
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
      throw new AppError(
        ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
        "创建 Agent Run 失败",
        500,
      );
    }

    let prepared: PreparedAgentExecution;
    try {
      prepared = executor.prepare({
        runId,
        sessionId,
        lane,
        principal: access.principal,
        scope: access.scope,
        userId: access.principal.externalUserId ?? access.principal.principalId,
        requestId,
        input: startInput.input.input,
        sequencer,
        config: {
          model: resolved.model,
          systemPrompt: resolved.systemPrompt,
          thinkingLevel: resolved.thinkingLevel,
          maxTurns: resolved.maxTurns,
          tools: resolved.tools,
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

    // 正常路径：run.started 是 sequence 1 的第一个事件
    publish(
      context,
      buildEvent(context, "run.started", {
        agentId: resolved.id,
        agentRevision: resolved.revision,
        model: resolved.model,
      }),
    );

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

  function get(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
  ): AgentRun {
    const record = requireScopedRun(access, sessionId, runId);
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
          repository.updateTerminal({
            id: runId,
            status: data.status,
            finalEntryId: data.finalEntryId,
            errorCode: data.errorCode,
            finishedAt: new Date(data.finishedAt),
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
    repository.updateTerminal({
      id: run.id,
      status: "interrupted",
      finalEntryId: run.finalEntryId,
      errorCode: ApiErrorCodes.AI_RUN_INTERRUPTED,
      finishedAt: new Date(),
    });
  }

  async function runToTerminal(
    context: RunContext,
    prepared: PreparedAgentExecution,
    pump: Promise<void>,
  ): Promise<void> {
    let terminal: ExecutorTerminalResult;
    try {
      terminal = await prepared.result;
    } catch {
      terminal = {
        status: "failed",
        finalEntryId: null,
        errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      };
    }
    await pump;
    await finalizeRun(context, terminal);
  }

  async function finalizeRun(
    context: RunContext,
    terminal: ExecutorTerminalResult,
  ): Promise<void> {
    const { runId, sessionId, lane, requestId, events } = context;
    const finishedAt = new Date();
    try {
      await sessionStore.appendRunTerminalEntry({
        sessionId,
        lane,
        data: toStarterRunData({
          runId,
          sessionId,
          lane,
          agentId: context.agentId,
          agentRevision: context.agentRevision,
          status: terminal.status,
          finalEntryId: terminal.finalEntryId,
          errorCode: terminal.errorCode,
          finishedAt,
        }),
      });
    } catch (cause) {
      logger.error(
        { err: cause, runId, sessionId, requestId },
        "starter.run.v1 写入失败",
      );
      // 以 AI.SESSION_STORAGE_FAILED 写主库 failed 并发布 run.failed
      const mainUpdated = repository.updateTerminal({
        id: runId,
        status: "failed",
        finalEntryId: terminal.finalEntryId,
        errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
        finishedAt,
      });
      if (!mainUpdated) {
        logger.error(
          { runId, sessionId, requestId },
          "Run 主库终态更新失败，关闭 transport 并 release",
        );
      } else {
        publish(
          context,
          buildEvent(context, "run.failed", {
            status: "failed",
            finalEntryId: terminal.finalEntryId,
            error: {
              code: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
              message: "Run 终态持久化失败",
              retryable: false,
            },
          }),
        );
      }
      events.end();
      liveSnapshots.delete(runId);
      release(registry, runId, context.lease);
      return;
    }

    const updated = repository.updateTerminal({
      id: runId,
      status: terminal.status,
      finalEntryId: terminal.finalEntryId,
      errorCode: terminal.errorCode,
      finishedAt,
    });
    if (updated) {
      publish(context, terminalEvent(context, terminal));
    } else {
      logger.error(
        { runId, sessionId, requestId },
        "Run 主库终态更新失败，不发布 terminal event 并 release",
      );
    }
    events.end();
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
    abort,
    steer,
    followUp,
    recoverInterrupted,
  };
}

async function pumpExecutorEvents(
  prepared: PreparedAgentExecution,
  context: RunContext,
  publish: (context: RunContext, event: HarnessEvent) => void,
): Promise<void> {
  try {
    for await (const event of prepared.events) {
      publish(context, event);
    }
  } catch {
    // executor 事件流异常不影响 Run 终态；terminal 由 result 决定。
  }
}

function buildEvent<T extends HarnessEvent["type"]>(
  context: RunContext,
  type: T,
  data: Extract<HarnessEvent, { type: T }>["data"],
): Extract<HarnessEvent, { type: T }> {
  return {
    version: 1,
    eventId: generateId(),
    sequence: context.sequencer.next(),
    sessionId: context.sessionId,
    runId: context.runId,
    lane: context.lane,
    createdAt: new Date().toISOString(),
    type,
    data,
  } as Extract<HarnessEvent, { type: T }>;
}

function terminalEvent(
  context: RunContext,
  terminal: ExecutorTerminalResult,
): HarnessEvent {
  const base = {
    version: 1,
    eventId: generateId(),
    sequence: context.sequencer.next(),
    sessionId: context.sessionId,
    runId: context.runId,
    lane: context.lane,
    createdAt: new Date().toISOString(),
  } as const;
  if (terminal.status === "completed") {
    return {
      ...base,
      type: "run.completed",
      data: {
        status: "completed",
        finalEntryId: terminal.finalEntryId!,
        reason: terminal.completionReason ?? "model_finished",
      },
    };
  }
  if (terminal.status === "aborted") {
    return {
      ...base,
      type: "run.aborted",
      data: {
        status: "aborted",
        finalEntryId: terminal.finalEntryId,
        errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
      },
    };
  }
  return {
    ...base,
    type: "run.failed",
    data: {
      status: "failed",
      finalEntryId: terminal.finalEntryId,
      error: {
        code: terminal.errorCode ?? ApiErrorCodes.AI_UPSTREAM_ERROR,
        message: errorMessage(terminal.errorCode),
        retryable: errorRetryable(terminal.errorCode),
      },
    },
  };
}

function errorMessage(errorCode: string | null): string {
  switch (errorCode) {
    case ApiErrorCodes.AI_PROVIDER_AUTH_FAILED:
      return "模型服务认证失败";
    case ApiErrorCodes.AI_MODEL_NOT_FOUND:
      return "模型不可用";
    case ApiErrorCodes.AI_UPSTREAM_TIMEOUT:
      return "模型请求超时";
    case ApiErrorCodes.AI_SESSION_STORAGE_FAILED:
      return "会话存储读写失败";
    case ApiErrorCodes.AI_TOOL_FAILED:
    case ApiErrorCodes.AI_TOOL_TIMED_OUT:
      return "工具执行失败";
    case ApiErrorCodes.AI_REQUEST_ABORTED:
      return "请求已取消";
    default:
      return "模型请求失败";
  }
}

function errorRetryable(errorCode: string | null): boolean {
  return (
    errorCode === ApiErrorCodes.AI_UPSTREAM_ERROR ||
    errorCode === ApiErrorCodes.AI_UPSTREAM_TIMEOUT ||
    errorCode === ApiErrorCodes.AI_PROVIDER_AUTH_FAILED
  );
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
