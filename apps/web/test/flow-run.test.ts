import { expect, it } from 'vitest'
import {
  abortStep,
  attachSession,
  attachStepRunId,
  beginStep,
  completeChain,
  completeStep,
  createFlowRunState,
  failStep,
  flowStepIdempotencyKey,
  flowStepLane,
  retryFrom,
} from '@web/lib/flow/flow-run'

it('createFlowRunState 初始为 idle 且步骤全部 idle，带 nodeId', () => {
  const state = createFlowRunState(['a', 'b', 'c'])
  expect(state.status).toBe('idle')
  expect(state.sessionId).toBeNull()
  expect(state.steps.map((step) => step.nodeId)).toEqual(['a', 'b', 'c'])
  expect(state.steps.map((step) => step.status)).toEqual(['idle', 'idle', 'idle'])
})

it('beginStep 置 running 并记录开始时间', () => {
  const state = beginStep(createFlowRunState(['a', 'b']), 0)
  expect(state.steps[0]?.status).toBe('running')
  expect(state.steps[0]?.startedAt).not.toBeNull()
  expect(state.steps[1]?.status).toBe('idle')
})

it('completeStep 记录产出和 runId', () => {
  const state = completeStep(beginStep(createFlowRunState(['a', 'b']), 0), 0, {
    runId: 'run-1',
    output: '产出文本',
  })
  expect(state.steps[0]?.status).toBe('completed')
  expect(state.steps[0]?.output).toBe('产出文本')
  expect(state.steps[0]?.runId).toBe('run-1')
  expect(state.steps[0]?.finishedAt).not.toBeNull()
})

it('failStep 置链 failed 且保留后续步骤 idle（fail fast）', () => {
  let state = createFlowRunState(['a', 'b', 'c'])
  state = completeStep(beginStep(state, 0), 0, { runId: 'run-0', output: 'a' })
  state = beginStep(state, 1)
  state = failStep(state, 1, { runId: 'run-1', errorCode: 'AI.UPSTREAM_FAILED', errorMessage: null })
  expect(state.status).toBe('failed')
  expect(state.steps[0]?.status).toBe('completed')
  expect(state.steps[0]?.output).toBe('a')
  expect(state.steps[1]?.status).toBe('failed')
  expect(state.steps[1]?.errorCode).toBe('AI.UPSTREAM_FAILED')
  expect(state.steps[2]?.status).toBe('idle')
})

it('abortStep 置链 aborted，当前步骤 aborted，后续不启动', () => {
  let state = createFlowRunState(['a', 'b'])
  state = completeStep(beginStep(state, 0), 0, { runId: 'run-0', output: 'a' })
  state = beginStep(state, 1)
  state = abortStep(state, 1, 'run-1')
  expect(state.status).toBe('aborted')
  expect(state.steps[0]?.status).toBe('completed')
  expect(state.steps[1]?.status).toBe('aborted')
})

it('retryFrom 清失败步骤及下游，保留上游产出', () => {
  let state = createFlowRunState(['a', 'b', 'c'])
  state = completeStep(beginStep(state, 0), 0, { runId: 'run-0', output: 'a' })
  state = beginStep(state, 1)
  state = failStep(state, 1, { runId: 'run-1', errorCode: 'AI.UPSTREAM_FAILED', errorMessage: null })

  const retried = retryFrom(state, 1)
  expect(retried.steps[0]?.status).toBe('completed')
  expect(retried.steps[0]?.output).toBe('a')
  expect(retried.steps[1]?.status).toBe('idle')
  expect(retried.steps[1]?.runId).toBeNull()
  expect(retried.steps[2]?.status).toBe('idle')
})

it('attachStepRunId 只在 runId 为空时补记，不覆盖已有值', () => {
  const state = attachStepRunId(beginStep(createFlowRunState(['a']), 0), 0, 'run-1')
  expect(state.steps[0]?.runId).toBe('run-1')
  const overwritten = attachStepRunId(state, 0, 'run-2')
  expect(overwritten.steps[0]?.runId).toBe('run-1')
})

it('completeChain 置链 completed', () => {
  const state = completeChain(createFlowRunState(['a']))
  expect(state.status).toBe('completed')
})

it('attachSession 记录本次运行的 Session', () => {
  const state = attachSession(createFlowRunState(['a']), 'session-1')
  expect(state.sessionId).toBe('session-1')
})

it('flowStepLane 用链上序号', () => {
  expect(flowStepLane(0)).toBe('flow-0')
  expect(flowStepLane(12)).toBe('flow-12')
})

it('flowStepIdempotencyKey 首次为 flowRunId-序号', () => {
  expect(flowStepIdempotencyKey('abc', 0, 0)).toBe('abc-0')
})

it('flowStepIdempotencyKey 重试追加 -r 次数换新 key', () => {
  expect(flowStepIdempotencyKey('abc', 1, 1)).toBe('abc-1-r1')
  expect(flowStepIdempotencyKey('abc', 1, 2)).toBe('abc-1-r2')
  expect(flowStepIdempotencyKey('abc', 1, 1)).not.toBe(flowStepIdempotencyKey('abc', 1, 0))
})

it('flowStepIdempotencyKey 满足 API 的 8-128 字符约束', () => {
  const uuid = '01958c80-8df7-7ce2-8f90-1234567890a1'
  expect(flowStepIdempotencyKey(uuid, 0, 0).length).toBeGreaterThanOrEqual(8)
  expect(flowStepIdempotencyKey(uuid, 99, 99).length).toBeLessThanOrEqual(128)
})
