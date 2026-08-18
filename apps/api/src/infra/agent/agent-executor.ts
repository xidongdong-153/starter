import {
  Agent,
  DEFAULT_COMPACTION_SETTINGS,
  buildSessionContext,
  compact,
  convertToLlm,
  estimateContextTokens,
  prepareCompaction,
  shouldCompact,
} from "@earendil-works/pi-agent-core";
import type {
  AgentMessage,
  CompactionSettings,
  Entry,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
  Usage,
} from "@earendil-works/pi-ai";
import type {
  AgentDefinitionConfig,
  AiCost,
  AiModelCallResult,
  AiModelCallStopReason,
  AiModelRef,
  AiUsage,
  ApiErrorCode,
  HarnessEvent,
  Permission,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";

import type { AiToolRegistry } from "@api/modules/ai/tool/tool-registry.js";
import { createPiNativeStreamFn } from "@api/infra/ai/pi-native-stream.js";
import type {
  PiModelCallAudit,
  PiStreamFailure,
} from "@api/infra/ai/pi-native-stream.js";
import { generateId } from "@api/shared/id.js";

import type { AttachableActiveRunControls } from "./active-run-registry.js";
import type {
  AgentSessionHandle,
  AgentSessionStore,
} from "./pi-session-store.js";
import {
  AsyncEventQueue,
  PiEventMapper,
  type EventSequencer,
} from "./pi-event-mapper.js";
import {
  createPiToolAdapter,
  type PiToolExecutionAudit,
} from "./pi-tool-adapter.js";

export interface ResolvedAgentExecutorConfig {
  model: AiModelRef;
  systemPrompt?: string;
  thinkingLevel?: AgentDefinitionConfig["thinkingLevel"];
  maxTurns: number;
  toolNames?: readonly string[];
}

export interface AgentExecutorInput {
  runId: string;
  sessionId: string;
  lane: string;
  userId: string;
  requestId: string;
  input: string;
  signal?: AbortSignal;
  sequencer: EventSequencer;
  config: ResolvedAgentExecutorConfig;
}

export type ExecutorTerminalStatus = "completed" | "failed" | "aborted";

export interface ExecutorTerminalResult {
  status: ExecutorTerminalStatus;
  finalEntryId: string | null;
  errorCode: ApiErrorCode | null;
}

export interface PreparedAgentExecution {
  readonly controls: AttachableActiveRunControls;
  readonly events: AsyncIterable<HarnessEvent>;
  readonly eventStream: AsyncIterable<HarnessEvent>;
  readonly result: Promise<ExecutorTerminalResult>;
  readonly terminalResult: Promise<ExecutorTerminalResult>;
  readonly start: () => Promise<void>;
}

export interface PiAgentExecutorOptions {
  sessionStore: AgentSessionStore;
  models?: Models;
  resolveModel?: (model: AiModelRef) => Model<Api> | undefined;
  streamFn?: StreamFn;
  tools?: AiToolRegistry;
  hasPermission?: (userId: string, permission: Permission) => Promise<boolean>;
  getProviderRequestEnv?: (providerId: string) => Record<string, string>;
  audit?: PiModelCallAudit;
  toolAudit?: PiToolExecutionAudit;
  requestTimeoutMs?: number;
  maxRunMs?: number;
  compaction?: Partial<CompactionSettings>;
}

export class AgentExecutorError extends Error {
  constructor(readonly kind: "not_attached" | "already_started") {
    super(`Pi Agent executor error: ${kind}`);
    this.name = "AgentExecutorError";
  }
}

export class PiAgentExecutor {
  constructor(private readonly options: PiAgentExecutorOptions) {}

  prepare(input: AgentExecutorInput): PreparedAgentExecution {
    const events = new AsyncEventQueue<HarnessEvent>();
    let attached = false;
    let started = false;
    let agent: Agent | undefined;
    let session: AgentSessionHandle | undefined;
    let unsubscribe: (() => void) | undefined;
    let callerAbortListener: (() => void) | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineAt: number | undefined;
    let abortRequested = false;
    let turns = 0;
    let currentModelCallId: string | null = null;
    let latestModelFailure: PiStreamFailure | undefined;
    let terminalOverride: ExecutorTerminalResult | undefined;
    const pendingSteers: string[] = [];
    const pendingFollowUps: string[] = [];
    const transcript: Entry[] = [];
    let resolveResult!: (result: ExecutorTerminalResult) => void;
    const result = new Promise<ExecutorTerminalResult>((resolve) => {
      resolveResult = resolve;
    });

    const controls: AttachableActiveRunControls = {
      attach() {
        if (attached) throw new AgentExecutorError("already_started");
        attached = true;
      },
      isAttached() {
        return attached;
      },
      abort() {
        abortRequested = true;
        agent?.abort();
      },
      steer(text) {
        if (agent) agent.steer(userMessage(text));
        else pendingSteers.push(text);
      },
      followUp(text) {
        if (agent) agent.followUp(userMessage(text));
        else pendingFollowUps.push(text);
      },
    };

    const start = async (): Promise<void> => {
      if (started) throw new AgentExecutorError("already_started");
      if (!attached) throw new AgentExecutorError("not_attached");
      started = true;
      callerAbortListener = () => {
        abortRequested = true;
        agent?.abort();
      };
      input.signal?.addEventListener("abort", callerAbortListener, {
        once: true,
      });
      if (input.signal?.aborted) abortRequested = true;
      try {
        if (abortRequested) {
          resolveResult({
            status: "aborted",
            finalEntryId: null,
            errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
          });
          return;
        }
        try {
          session = await this.options.sessionStore.openSession(
            input.sessionId,
          );
          transcript.push(
            ...(await session.readTranscript({ lane: input.lane })),
          );
        } catch {
          if (!abortRequested) {
            terminalOverride = {
              status: "failed",
              finalEntryId: null,
              errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
            };
          }
          throw new Error("Agent Session 读取失败");
        }
        if (abortRequested) {
          resolveResult({
            status: "aborted",
            finalEntryId: null,
            errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
          });
          return;
        }

        const maxRunMs = this.options.maxRunMs ?? 120_000;
        deadlineAt = Date.now() + maxRunMs;
        const config = input.config;
        const modelRef = config.model;
        const model = resolveModel(this.options, modelRef);
        if (!model) {
          terminalOverride = {
            status: "failed",
            finalEntryId: null,
            errorCode: ApiErrorCodes.AI_MODEL_NOT_FOUND,
          };
          resolveResult(terminalOverride);
          return;
        }
        const compactionSettings = resolveCompactionSettings(
          this.options.compaction,
        );
        let mapper!: PiEventMapper;
        const toolAdapter = createPiToolAdapter(
          selectTools(this.options.tools, config.toolNames),
          {
            userId: input.userId,
            requestId: input.requestId,
            hasPermission: this.options.hasPermission ?? (async () => false),
            getModelCallId: () => currentModelCallId,
            getRemainingRunMs: () => remainingRunMs(deadlineAt),
            audit: this.options.toolAudit,
            onTerminalFailure: (reason) => {
              if (terminalOverride) return;
              terminalOverride = {
                status: reason === "cancelled" ? "aborted" : "failed",
                finalEntryId: mapper.lastAssistantEntryId,
                errorCode:
                  reason === "timed_out"
                    ? ApiErrorCodes.AI_TOOL_TIMED_OUT
                    : ApiErrorCodes.AI_REQUEST_ABORTED,
              };
              agent?.abort();
            },
          },
        );

        mapper = new PiEventMapper({
          session,
          sessionId: input.sessionId,
          runId: input.runId,
          lane: input.lane,
          sequencer: input.sequencer,
          getAssistantErrorCode: () =>
            terminalOverride?.errorCode ??
            latestModelFailure?.errorCode ??
            null,
          onEntryAppended: (entry) => transcript.push(entry),
          onToolExecutionStart: (toolInput) =>
            toolAdapter.onToolExecutionStart(toolInput),
          onToolExecutionEnd: (toolInput) =>
            toolAdapter.onToolExecutionEnd(toolInput),
        });

        const streamFn =
          this.options.streamFn ??
          this.createStreamFn(
            input,
            modelRef,
            () => {
              currentModelCallId = null;
            },
            (id) => {
              currentModelCallId = id;
            },
            (failure) => {
              latestModelFailure = failure;
            },
          );
        const auditedModels = this.options.models
          ? createAuditedModels(
              this.options.models,
              this.options.audit,
              input,
              modelRef,
              this.options.requestTimeoutMs ?? 60_000,
            )
          : undefined;
        let initialMessages: AgentMessage[];
        try {
          initialMessages = buildSessionContext(transcript).messages;
        } catch {
          if (!abortRequested) {
            terminalOverride = {
              status: "failed",
              finalEntryId: null,
              errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
            };
          }
          throw new Error("Agent Session context 读取失败");
        }
        agent = new Agent({
          initialState: {
            systemPrompt: config.systemPrompt ?? "",
            model,
            thinkingLevel: config.thinkingLevel ?? "off",
            messages: initialMessages,
            tools: [...toolAdapter.tools],
          },
          convertToLlm: (messages) =>
            convertToLlm(sanitizeToolErrors(messages)),
          streamFn,
          sessionId: input.sessionId,
          toolExecution: "parallel",
          afterToolCall: toolAdapter.afterToolCall,
          shouldStopAfterTurn: async () => {
            turns += 1;
            return turns >= config.maxTurns;
          },
          transformContext: async (messages, signal) => {
            return compactIfNeeded({
              messages,
              transcript,
              session,
              lane: input.lane,
              model,
              models: auditedModels,
              settings: compactionSettings,
              thinkingLevel: config.thinkingLevel ?? "off",
              signal,
              onFailure: (errorCode) => {
                terminalOverride = {
                  status: "failed",
                  finalEntryId: mapper.lastAssistantEntryId,
                  errorCode,
                };
              },
            });
          },
        });

        unsubscribe = agent.subscribe(async (event, signal) => {
          try {
            const mapped = await mapper.map(event, signal);
            for (const mappedEvent of mapped) events.push(mappedEvent);
          } catch {
            terminalOverride = {
              status: "failed",
              finalEntryId: mapper.lastAssistantEntryId,
              errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
            };
            throw new Error("Agent Session 写入失败");
          }
        });

        deadlineTimer = setTimeout(
          () => {
            terminalOverride = {
              status: "failed",
              finalEntryId: mapper.lastAssistantEntryId,
              errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
            };
            agent?.abort();
          },
          Math.max(1, (deadlineAt ?? Date.now()) - Date.now()),
        );

        for (const text of pendingSteers) agent.steer(userMessage(text));
        for (const text of pendingFollowUps) agent.followUp(userMessage(text));
        pendingSteers.length = 0;
        pendingFollowUps.length = 0;

        if (abortRequested) {
          resolveResult({
            status: "aborted",
            finalEntryId: null,
            errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
          });
          return;
        }

        const prompt = agent.prompt(input.input);
        if (abortRequested) agent.abort();
        await prompt;
        const terminal = resolveTerminalResult(
          mapper,
          abortRequested || input.signal?.aborted === true,
          terminalOverride,
          latestModelFailure,
        );
        resolveResult(terminal);
      } catch {
        const terminal =
          terminalOverride ??
          ({
            status: abortRequested ? "aborted" : "failed",
            finalEntryId: null,
            errorCode: abortRequested
              ? ApiErrorCodes.AI_REQUEST_ABORTED
              : ApiErrorCodes.AI_UPSTREAM_ERROR,
          } satisfies ExecutorTerminalResult);
        resolveResult(terminal);
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        if (callerAbortListener) {
          input.signal?.removeEventListener("abort", callerAbortListener);
        }
        unsubscribe?.();
        events.end();
      }
    };

    return {
      controls,
      events,
      eventStream: events,
      result,
      terminalResult: result,
      start,
    };
  }

  private createStreamFn(
    input: AgentExecutorInput,
    modelRef: AiModelRef,
    onReset: () => void,
    onStarted: (id: string | null) => void,
    onFailure: (failure: PiStreamFailure) => void,
  ): StreamFn {
    if (!this.options.models) {
      throw new Error("Pi Agent executor 需要 models 或 streamFn");
    }
    return createPiNativeStreamFn({
      models: this.options.models,
      timeoutMs: this.options.requestTimeoutMs ?? 60_000,
      runId: input.runId,
      userId: input.userId,
      requestId: input.requestId,
      sessionId: input.sessionId,
      getProviderRequestEnv: this.options.getProviderRequestEnv,
      audit: this.options.audit,
      onModelCallStarted: (id) => {
        onReset();
        onStarted(id);
      },
      onFailure,
    }) as StreamFn;
  }
}

export function createPiAgentExecutor(
  options: PiAgentExecutorOptions,
): PiAgentExecutor {
  return new PiAgentExecutor(options);
}

function resolveModel(
  options: PiAgentExecutorOptions,
  modelRef: AiModelRef,
): Model<Api> | undefined {
  try {
    return (
      options.resolveModel?.(modelRef) ??
      options.models?.getModel(modelRef.providerId, modelRef.modelId)
    );
  } catch {
    return undefined;
  }
}

function selectTools(
  registry: AiToolRegistry | undefined,
  names: readonly string[] | undefined,
) {
  if (!registry) return [];
  const tools = registry.list();
  if (names === undefined) return tools;
  const allowed = new Set(names);
  return tools.filter((tool) => allowed.has(tool.name));
}

function userMessage(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function resolveCompactionSettings(
  settings: Partial<CompactionSettings> | undefined,
): CompactionSettings {
  return {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...settings,
  };
}

async function compactIfNeeded(input: {
  messages: AgentMessage[];
  transcript: import("@earendil-works/pi-agent-core").Entry[];
  session: AgentSessionHandle | undefined;
  lane: string;
  model: Model<Api>;
  models: Models | undefined;
  settings: CompactionSettings;
  thinkingLevel: AgentDefinitionConfig["thinkingLevel"];
  signal?: AbortSignal;
  onFailure: (errorCode: ApiErrorCode) => void;
}): Promise<AgentMessage[]> {
  if (
    !input.models ||
    !input.session ||
    !shouldCompact(
      estimateContextTokens(input.messages).tokens,
      input.model.contextWindow,
      input.settings,
    )
  ) {
    return input.messages;
  }

  const preparation = prepareCompaction(input.transcript, input.settings);
  if (!preparation.ok) {
    input.onFailure(ApiErrorCodes.AI_UPSTREAM_ERROR);
    throw new Error("Pi compaction 准备失败");
  }
  if (!preparation.value) return input.messages;

  const compacted = await compact(
    preparation.value,
    input.models,
    input.model,
    undefined,
    input.signal,
    input.thinkingLevel,
  );
  if (!compacted.ok) {
    input.onFailure(ApiErrorCodes.AI_UPSTREAM_ERROR);
    throw new Error("Pi compaction 摘要生成失败");
  }

  try {
    const entry = await input.session.appendCompaction(input.lane, {
      type: "compaction",
      id: generateId(),
      summary: compacted.value.summary,
      retainedTail: compacted.value.retainedTail,
      tokensBefore: compacted.value.tokensBefore,
      ...(compacted.value.details === undefined
        ? {}
        : { details: compacted.value.details }),
      ...(compacted.value.usage === undefined
        ? {}
        : { usage: compacted.value.usage }),
    });
    input.transcript.push(entry);
    return buildSessionContext(input.transcript).messages;
  } catch {
    input.onFailure(ApiErrorCodes.AI_SESSION_STORAGE_FAILED);
    throw new Error("Pi compaction entry 写入失败");
  }
}

function resolveTerminalResult(
  mapper: PiEventMapper,
  abortRequested: boolean,
  override: ExecutorTerminalResult | undefined,
  failure: PiStreamFailure | undefined,
): ExecutorTerminalResult {
  if (override) {
    return {
      ...override,
      finalEntryId: override.finalEntryId ?? mapper.lastAssistantEntryId,
    };
  }
  if (failure?.kind === "timeout") {
    return {
      status: "failed",
      finalEntryId: mapper.lastAssistantEntryId,
      errorCode: failure.errorCode,
    };
  }
  const message = mapper.lastAssistantMessage;
  if (
    abortRequested ||
    failure?.kind === "aborted" ||
    (message?.role === "assistant" && message.stopReason === "aborted")
  ) {
    return {
      status: "aborted",
      finalEntryId: mapper.lastAssistantEntryId,
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
    };
  }
  if (message?.role === "assistant" && message.stopReason === "error") {
    return {
      status: "failed",
      finalEntryId: mapper.lastAssistantEntryId,
      errorCode: failure?.errorCode ?? ApiErrorCodes.AI_UPSTREAM_ERROR,
    };
  }
  return {
    status: "completed",
    finalEntryId: mapper.lastAssistantEntryId,
    errorCode: null,
  };
}

function remainingRunMs(deadlineAt: number | undefined): number | undefined {
  return deadlineAt === undefined
    ? undefined
    : Math.max(0, deadlineAt - Date.now());
}

function createAuditedModels(
  models: Models,
  audit: PiModelCallAudit | undefined,
  input: AgentExecutorInput,
  modelRef: AiModelRef,
  timeoutMs: number,
): Models {
  if (!audit) return models;
  return new Proxy(models, {
    get(target, property) {
      if (property === "completeSimple") {
        return async (
          model: Model<Api>,
          context: Context,
          options: SimpleStreamOptions = {},
        ): Promise<AssistantMessage> => {
          const startedAt = new Date();
          const effectiveTimeoutMs = Math.max(
            1,
            Math.min(options.timeoutMs ?? timeoutMs, timeoutMs),
          );
          let modelCallId: string | null = null;
          let finalized = false;
          const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);
          const cause: { kind: "aborted" | "timeout" | null } = {
            kind: options.signal?.aborted ? "aborted" : null,
          };
          const onInputAbort = () => {
            cause.kind ??= "aborted";
          };
          const onTimeout = () => {
            cause.kind ??= "timeout";
          };
          options.signal?.addEventListener("abort", onInputAbort, {
            once: true,
          });
          timeoutSignal.addEventListener("abort", onTimeout, { once: true });
          const signal = options.signal
            ? AbortSignal.any([options.signal, timeoutSignal])
            : timeoutSignal;
          const finalize = (
            resultValue: Exclude<AiModelCallResult, "running">,
            stopReason: AiModelCallStopReason,
            errorCode: string | null,
            usage: AiUsage,
            cost: AiCost | null,
          ) => {
            if (!modelCallId || finalized) return;
            finalized = true;
            try {
              audit.finalizeModelCall({
                id: modelCallId,
                requestId: input.requestId,
                startedAt,
                finishedAt: new Date(),
                result: resultValue,
                stopReason,
                errorCode,
                usage,
                cost,
              });
            } catch {
              // 审计是 best-effort，不能改变 compaction 结果。
            }
          };
          try {
            try {
              modelCallId = audit.beginModelCall({
                runId: input.runId,
                userId: input.userId,
                requestId: input.requestId,
                model: modelRef,
                timeoutMs: effectiveTimeoutMs,
                startedAt,
              });
            } catch {
              modelCallId = null;
            }
            const result = await target.completeSimple(model, context, {
              ...options,
              signal,
              timeoutMs: effectiveTimeoutMs,
            });
            const outcome = classifyCompleteSimpleResult(result, cause.kind);
            finalize(
              outcome.result,
              outcome.stopReason,
              outcome.errorCode,
              toAiUsage(result.usage),
              toAiCost(result.usage),
            );
            return result;
          } catch (error) {
            const kind =
              cause.kind ??
              (timeoutSignal.aborted
                ? "timeout"
                : options.signal?.aborted
                  ? "aborted"
                  : null);
            finalize(
              kind === "timeout"
                ? "timed_out"
                : kind === "aborted"
                  ? "cancelled"
                  : "upstream_failed",
              kind === "timeout" || kind === "aborted" ? "aborted" : "error",
              kind === "timeout"
                ? ApiErrorCodes.AI_UPSTREAM_TIMEOUT
                : kind === "aborted"
                  ? ApiErrorCodes.AI_REQUEST_ABORTED
                  : ApiErrorCodes.AI_UPSTREAM_ERROR,
              emptyUsage(),
              null,
            );
            throw error;
          } finally {
            options.signal?.removeEventListener("abort", onInputAbort);
            timeoutSignal.removeEventListener("abort", onTimeout);
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Models;
}

function classifyCompleteSimpleResult(
  message: AssistantMessage,
  cause: "aborted" | "timeout" | null,
): {
  result: Exclude<AiModelCallResult, "running">;
  stopReason: AiModelCallStopReason;
  errorCode: string | null;
} {
  if (cause === "timeout") {
    return {
      result: "timed_out",
      stopReason: "aborted",
      errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
    };
  }
  if (cause === "aborted" || message.stopReason === "aborted") {
    return {
      result: "cancelled",
      stopReason: "aborted",
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
    };
  }
  if (message.stopReason === "error") {
    return {
      result: "upstream_failed",
      stopReason: "error",
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
    };
  }
  if (message.stopReason === "deferred") {
    return {
      result: "upstream_failed",
      stopReason: "deferred",
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
    };
  }
  return {
    result: "succeeded",
    stopReason: normalizeModelStopReason(message),
    errorCode: null,
  };
}

function normalizeModelStopReason(
  message: AssistantMessage,
): AiModelCallStopReason {
  if (message.stopReason === "length") return "length";
  if (message.stopReason === "toolUse") return "tool_use";
  if (message.stopReason === "aborted") return "aborted";
  if (message.stopReason === "error") return "error";
  if (message.stopReason === "deferred") return "deferred";
  return "stop";
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
  };
}

function toAiCost(usage: Usage): AiCost | null {
  const input = numberOrNull(usage.cost?.input);
  const output = numberOrNull(usage.cost?.output);
  const cacheRead = numberOrNull(usage.cost?.cacheRead);
  const cacheWrite = numberOrNull(usage.cost?.cacheWrite);
  const total = numberOrNull(usage.cost?.total);
  if (
    input === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null ||
    total === null
  ) {
    return null;
  }
  return { currency: "USD", input, output, cacheRead, cacheWrite, total };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function sanitizeToolErrors(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (
      message.role !== "toolResult" ||
      !message.isError ||
      hasSafeToolDetails(message.details)
    ) {
      return message;
    }
    return {
      ...message,
      content: [{ type: "text", text: "The tool failed." }],
    };
  });
}

function hasSafeToolDetails(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.status === "succeeded" ||
    value.status === "not_found" ||
    value.status === "invalid_arguments" ||
    value.status === "forbidden" ||
    value.status === "failed" ||
    value.status === "timed_out" ||
    value.status === "cancelled" ||
    value.status === "interrupted"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  };
}
