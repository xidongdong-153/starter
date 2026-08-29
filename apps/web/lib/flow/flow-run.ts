/**
 * Flow 执行状态机：纯函数，驱动器（hooks/use-flow-run.ts）持有状态并调用这些迁移。
 * 节点运行态只存 React state，不持久化：刷新即弃，服务端 Session/transcript 是持久事实。
 */

export type FlowRunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted'

export type FlowStepStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted'

export interface FlowStepRunState {
  /** 对应链上步骤的节点 id，运行态按它映射回画布。 */
  nodeId: string
  status: FlowStepStatus
  runId: string | null
  output: string | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: number | null
  finishedAt: number | null
}

export interface FlowRunState {
  status: FlowRunStatus
  /** 本次运行使用的 Agent Session；没启动过为 null。 */
  sessionId: string | null
  /** 与链上步骤一一对应，顺序执行。 */
  steps: FlowStepRunState[]
}

function createStepState(nodeId: string): FlowStepRunState {
  return {
    nodeId,
    status: 'idle',
    runId: null,
    output: null,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
  }
}

export function createFlowRunState(nodeIds: string[]): FlowRunState {
  return { status: 'idle', sessionId: null, steps: nodeIds.map(createStepState) }
}

export function attachSession(state: FlowRunState, sessionId: string): FlowRunState {
  return { ...state, sessionId }
}

/** 步骤开始执行：置 running 并记录开始时间。 */
export function beginStep(state: FlowRunState, index: number): FlowRunState {
  return updateStep(state, index, (step) => ({
    ...step,
    status: 'running',
    errorCode: null,
    errorMessage: null,
    startedAt: Date.now(),
    finishedAt: null,
  }))
}

/** run.started 事件到达后补记 runId：停止按钮依赖它判断 abort 是否有目标。 */
export function attachStepRunId(state: FlowRunState, index: number, runId: string): FlowRunState {
  return updateStep(state, index, (step) => (step.runId === null ? { ...step, runId } : step))
}

export function completeStep(
  state: FlowRunState,
  index: number,
  result: { runId: string | null; output: string | null },
): FlowRunState {
  return updateStep(state, index, (step) => ({
    ...step,
    status: 'completed',
    runId: result.runId,
    output: result.output,
    finishedAt: Date.now(),
  }))
}

/** 步骤失败：fail fast，链整体置 failed，后续步骤保持 idle。 */
export function failStep(
  state: FlowRunState,
  index: number,
  result: { runId: string | null; errorCode: string | null; errorMessage: string | null },
): FlowRunState {
  return updateStep({ ...state, status: 'failed' }, index, (step) => ({
    ...step,
    status: 'failed',
    runId: result.runId,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    finishedAt: Date.now(),
  }))
}

/** 用户停止：当前步骤置 aborted，链整体置 aborted，后续步骤保持 idle。 */
export function abortStep(state: FlowRunState, index: number, runId: string | null): FlowRunState {
  return updateStep({ ...state, status: 'aborted' }, index, (step) => ({
    ...step,
    status: 'aborted',
    runId: runId ?? step.runId,
    finishedAt: Date.now(),
  }))
}

/** 全部步骤完成：链整体置 completed。 */
export function completeChain(state: FlowRunState): FlowRunState {
  return { ...state, status: 'completed' }
}

/**
 * 从失败/中止的步骤重试：index 及之后的步骤清回 idle，之前的产出保留复用。
 * 链状态由驱动器在重新推进时置回 running。
 */
export function retryFrom(state: FlowRunState, index: number): FlowRunState {
  return {
    ...state,
    steps: state.steps.map((step, stepIndex) => (stepIndex >= index ? createStepState(step.nodeId) : step)),
  }
}

/** lane：链上序号，与模板 steps.N 对齐，同 Session 内天然隔离。 */
export function flowStepLane(index: number): string {
  return `flow-${index}`
}

/**
 * 幂等键：正常推进用 `<flowRunId>-<i>`（防网络层重复提交）；
 * 从失败节点重试必须换新 key——API 语义是 failed Run 同 key 也返回旧 Run。
 */
export function flowStepIdempotencyKey(flowRunId: string, index: number, retryCount: number): string {
  const base = `${flowRunId}-${index}`
  return retryCount > 0 ? `${base}-r${retryCount}` : base
}

function updateStep(
  state: FlowRunState,
  index: number,
  update: (step: FlowStepRunState) => FlowStepRunState,
): FlowRunState {
  if (index < 0 || index >= state.steps.length) return state
  return { ...state, steps: state.steps.map((step, stepIndex) => (stepIndex === index ? update(step) : step)) }
}
