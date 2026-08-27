import type { RunEvent } from "@starter/contracts";

import type { RunEventDraft } from "@api/modules/ai/run/run-event.repository.js";
import type { ResolvedAiOutputContract } from "@api/modules/ai/output/output-contract-registry.js";
import type {
  PrincipalContext,
  ResourceScope,
} from "@api/modules/ai/principal.js";
import { generateId } from "@api/shared/id.js";

export type RunStepKind = "assistant" | "compaction" | "branch_summary";

export type RunStepState = {
  readonly id: string;
  readonly kind: RunStepKind;
  readonly attempt: number;
};

export type RunToolState = {
  readonly callId: string;
  readonly executionId: string;
};

/** 产品事件 envelope 的关联槽位；只由执行上下文填写，消费方不自行拼造。 */
export interface RunEventAssociations {
  turnIndex: number | null;
  stepId: string | null;
  modelCallId: string | null;
  messageId: string | null;
  toolCallId: string | null;
  toolExecutionId: string | null;
}

/** 事件自带的关联输入：message 和 Tool 事件必须显式给出自己的 ID。 */
export interface RunEventAssociationInput {
  messageId?: string | null;
  toolCallId?: string | null;
}

/**
 * 一次 Run 的关联上下文。
 *
 * Run Service 创建它并向下传给 Executor、PiEventMapper、原生模型流和 Tool adapter，
 * 每个 ID 只在自己的生命周期开始处生成一次：
 *
 * - `runId` 在 Run row 创建前由 Run Service 生成。
 * - `turnId` 在 Pi `turn_start` 时由 `beginTurn` 生成。
 * - `step.id` 在每次模型执行 attempt 或 compaction 开始前由 `beginStep` 生成。
 * - `modelCallId` 在 Provider 请求开始前由原生模型流生成。
 * - `tool.executionId` 在 Tool 审计 begin 前由 Tool adapter 生成，
 *   `tool.callId` 直接用 Pi 的调用 ID。
 */
export interface RunExecutionContext {
  readonly runId: string;
  readonly sessionId: string;
  readonly lane: string;
  readonly requestId: string;
  readonly principal: PrincipalContext;
  readonly scope: ResourceScope;
  readonly agentId: string;
  readonly agentRevision: number;
  readonly outputContract: ResolvedAiOutputContract | null;
  /** 审计用的调用者 ID，由 principal 推导，不单独传参。 */
  readonly userId: string;
  readonly turnIndex: number | null;
  readonly turnId: string | null;
  readonly step: RunStepState | null;
  readonly modelCallId: string | null;
  /** 最近开始的 Tool；Pi 并行执行 Tool 时按 `associations({ toolCallId })` 逐个取 executionId。 */
  readonly tool: RunToolState | null;
  /** 开始一个 Turn，返回新生成的 turnId。 */
  beginTurn: (turnIndex: number) => string;
  /** 结束当前 Turn，返回被关闭的 turnId；`turnIndex` 保留给 turn 终态事件使用。 */
  endTurn: () => string | null;
  /** 开始一个 Step，返回新生成的 stepId。 */
  beginStep: (kind: RunStepKind, attempt: number) => string;
  /** 结束当前 Step，返回被关闭的 Step，并清空 Model Call 与 Tool 关联。 */
  endStep: () => RunStepState | null;
  setModelCall: (modelCallId: string) => void;
  /** Tool 开始时登记 callId -> executionId，事件 envelope 按 callId 取 executionId。 */
  setTool: (callId: string, executionId: string) => void;
  associations: (input?: RunEventAssociationInput) => RunEventAssociations;
}

export function createRunExecutionContext(input: {
  runId: string;
  sessionId: string;
  lane: string;
  requestId: string;
  principal: PrincipalContext;
  scope: ResourceScope;
  agentId: string;
  agentRevision: number;
  outputContract?: ResolvedAiOutputContract | null;
}): RunExecutionContext {
  const state = {
    turnIndex: null as number | null,
    turnId: null as string | null,
    step: null as RunStepState | null,
    modelCallId: null as string | null,
    tool: null as RunToolState | null,
  };
  /** toolCallId -> toolExecutionId，覆盖同一 Step 内并行执行的多个 Tool。 */
  const toolExecutions = new Map<string, string>();

  return {
    runId: input.runId,
    sessionId: input.sessionId,
    lane: input.lane,
    requestId: input.requestId,
    principal: input.principal,
    scope: input.scope,
    agentId: input.agentId,
    agentRevision: input.agentRevision,
    outputContract: input.outputContract ?? null,
    userId: input.principal.externalUserId ?? input.principal.principalId,
    get turnIndex() {
      return state.turnIndex;
    },
    get turnId() {
      return state.turnId;
    },
    get step() {
      return state.step;
    },
    get modelCallId() {
      return state.modelCallId;
    },
    get tool() {
      return state.tool;
    },
    beginTurn(turnIndex) {
      state.turnIndex = turnIndex;
      state.turnId = generateId();
      return state.turnId;
    },
    endTurn() {
      const turnId = state.turnId;
      state.turnId = null;
      return turnId;
    },
    beginStep(kind, attempt) {
      state.step = { id: generateId(), kind, attempt };
      return state.step.id;
    },
    endStep() {
      const step = state.step;
      state.step = null;
      state.modelCallId = null;
      state.tool = null;
      toolExecutions.clear();
      return step;
    },
    setModelCall(modelCallId) {
      state.modelCallId = modelCallId;
    },
    setTool(callId, executionId) {
      toolExecutions.set(callId, executionId);
      state.tool = { callId, executionId };
    },
    associations: (associationInput = {}) => {
      const toolCallId = associationInput.toolCallId ?? null;
      return {
        turnIndex: state.turnIndex,
        stepId: state.step?.id ?? null,
        modelCallId: state.modelCallId,
        messageId: associationInput.messageId ?? null,
        toolCallId,
        toolExecutionId: toolCallId
          ? (toolExecutions.get(toolCallId) ?? null)
          : null,
      };
    },
  };
}

/**
 * 用执行上下文的关联槽位组装一个产品事件草稿。
 * `sequence`、`eventId` 和 `occurredAt` 由 Run Event Publisher 分配，生产者不填。
 */
export function createRunEventDraft<T extends RunEvent["type"]>(
  execution: RunExecutionContext,
  type: T,
  data: Extract<RunEvent, { type: T }>["data"],
  associations: RunEventAssociationInput & { stepId?: string } = {},
): RunEventDraft {
  const { stepId, ...associationInput } = associations;
  return {
    runId: execution.runId,
    sessionId: execution.sessionId,
    lane: execution.lane,
    ...execution.associations(associationInput),
    ...(stepId === undefined ? {} : { stepId }),
    type,
    data,
  } as RunEventDraft;
}
