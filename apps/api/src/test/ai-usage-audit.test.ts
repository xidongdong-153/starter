import type { AiUsageAuditRepository } from '@api/modules/ai/usage-audit/usage-audit.repository.js'
import type { AiGateway } from '@api/infra/ai/index.js'
import { describe, expect, it, vi } from 'vitest'

import { createAiUsageAuditRepository } from '@api/modules/ai/usage-audit/usage-audit.repository.js'
import {
  createAiInvocationRunner,
  createAiUsageAuditService,
  resolveModelCallTimeout,
  resolveToolExecutionTimeout,
} from '@api/modules/ai/usage-audit/usage-audit.service.js'

import { generateId } from '@api/shared/id.js'
import { createTestApp } from './helpers.js'

const usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: 0,
} as const

it('启动恢复把未完成的模型调用和工具执行标记为 interrupted', () => {
  const { cleanup, runtime } = createTestApp()
  try {
    const repository = createAiUsageAuditRepository(runtime.db)
    const modelCallId = '019c4200-0010-7000-8000-000000000001'
    const toolExecutionId = '019c4200-0010-7000-8000-000000000002'
    const freshModelCallId = '019c4200-0010-7000-8000-000000000003'
    const freshToolExecutionId = '019c4200-0010-7000-8000-000000000004'
    const startedAt = new Date(Date.now() - 11_000)
    const freshStartedAt = new Date()
    repository.beginModelCall({
      id: modelCallId,
      requestId: 'recovery-request',
      userId: 'recovery-user',
      scenario: 'model_test',
      runId: null,
      providerId: 'openai',
      modelId: 'gpt-test',
      startedAt,
      timeoutMs: 5000,
    })
    repository.beginToolExecution({
      id: toolExecutionId,
      modelCallId,
      toolName: 'lookup',
      toolVersion: '1.0.0',
      startedAt,
      timeoutMs: 5000,
    })
    repository.beginModelCall({
      id: freshModelCallId,
      requestId: 'fresh-request',
      userId: 'fresh-user',
      scenario: 'model_test',
      runId: null,
      providerId: 'openai',
      modelId: 'gpt-test',
      startedAt: freshStartedAt,
      timeoutMs: 5000,
    })
    repository.beginToolExecution({
      id: freshToolExecutionId,
      modelCallId: freshModelCallId,
      toolName: 'lookup',
      toolVersion: '1.0.0',
      startedAt: freshStartedAt,
      timeoutMs: 5000,
    })

    createAiUsageAuditService(repository, runtime.logger)

    expect(repository.findModelCall(modelCallId)).toMatchObject({
      result: 'interrupted',
      stopReason: 'deferred',
      durationMs: null,
    })
    expect(repository.listToolExecutions(modelCallId)).toEqual([
      expect.objectContaining({
        id: toolExecutionId,
        status: 'interrupted',
        durationMs: null,
      }),
    ])
    expect(repository.findModelCall(freshModelCallId)).toMatchObject({
      result: 'running',
      finishedAt: null,
    })
    expect(repository.listToolExecutions(freshModelCallId)).toEqual([
      expect.objectContaining({ status: 'running', finishedAt: null }),
    ])
  } finally {
    cleanup()
  }
})

it('finalize 只写一次并保留真实的 0 usage 和 0 成本', () => {
  const { cleanup, runtime } = createTestApp()
  try {
    const repository = createAiUsageAuditRepository(runtime.db)
    const id = '019c4200-0010-7000-8000-000000000005'
    const startedAt = new Date()
    repository.beginModelCall({
      id,
      requestId: 'zero-request',
      userId: 'zero-user',
      scenario: 'model_test',
      runId: null,
      providerId: 'openai',
      modelId: 'gpt-test',
      startedAt,
      timeoutMs: 5000,
    })
    repository.finalizeModelCall({
      id,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 10),
      result: 'succeeded',
      stopReason: 'stop',
      errorCode: null,
      usage,
      cost: {
        currency: 'USD',
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    })
    repository.finalizeModelCall({
      id,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 20),
      result: 'upstream_failed',
      stopReason: 'error',
      errorCode: 'AI.UPSTREAM_ERROR',
      usage: { ...usage, totalTokens: 99 },
      cost: null,
    })

    expect(repository.findModelCall(id)).toMatchObject({
      result: 'succeeded',
      durationMs: 10,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costInput: 0,
      costOutput: 0,
      costTotal: 0,
      costCurrency: 'USD',
    })
  } finally {
    cleanup()
  }
})

it('模型和工具调用使用剩余 generation 时间计算 effective timeout', async () => {
  expect(resolveModelCallTimeout(60_000, 1200)).toBe(1200)
  expect(resolveModelCallTimeout(60_000, 90_000)).toBe(60_000)
  expect(resolveToolExecutionTimeout(undefined, 6000)).toBe(5000)
  expect(resolveToolExecutionTimeout(8000, 1200)).toBe(1200)

  let receivedTimeoutMs: number | undefined
  const gateway: AiGateway = {
    async *stream(input) {
      receivedTimeoutMs = input.timeoutMs
      yield {
        type: 'completed',
        turnIndex: input.turnIndex,
        assistantMessage: { role: 'assistant', blocks: [] },
        stopReason: 'stop',
        usage,
        cost: null,
      }
    },
  }
  const repository = {
    recoverInterrupted: vi.fn(),
    beginModelCall: vi.fn(),
    finalizeModelCall: vi.fn(),
    beginToolExecution: vi.fn(),
    finalizeToolExecution: vi.fn(),
    findModelCall: vi.fn(),
    listModelCalls: vi.fn(() => ({ items: [], total: 0 })),
    listToolExecutions: vi.fn(() => []),
  } as unknown as AiUsageAuditRepository
  const { cleanup, runtime } = createTestApp()
  try {
    const audit = createAiUsageAuditService(repository, runtime.logger)
    const runner = createAiInvocationRunner(gateway, audit)
    for await (const _event of runner.stream(
      {
        requestId: 'timeout-request',
        userId: 'timeout-user',
        scenario: 'model_test',
        timeoutMs: 60_000,
        generationRemainingMs: 1200,
      },
      {
        model: { providerId: 'openai', modelId: 'gpt-test' },
        messages: [],
        turnIndex: 0,
      },
    )) {
      // Consume the stream so the terminal audit runs.
    }

    expect(receivedTimeoutMs).toBe(1200)
    expect(repository.beginModelCall).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 1200 }))
  } finally {
    cleanup()
  }
})

it('没有 Gateway 终态时只 finalize 一次 interrupted', async () => {
  const gateway: AiGateway = {
    async *stream() {},
  }
  const repository = {
    recoverInterrupted: vi.fn(),
    beginModelCall: vi.fn(),
    finalizeModelCall: vi.fn(),
    beginToolExecution: vi.fn(),
    finalizeToolExecution: vi.fn(),
    findModelCall: vi.fn(),
    listModelCalls: vi.fn(() => ({ items: [], total: 0 })),
    listToolExecutions: vi.fn(() => []),
  } as unknown as AiUsageAuditRepository
  const { cleanup, runtime } = createTestApp()
  try {
    const runner = createAiInvocationRunner(gateway, createAiUsageAuditService(repository, runtime.logger))
    for await (const _event of runner.stream(
      {
        requestId: 'interrupted-request',
        userId: 'interrupted-user',
        scenario: 'model_test',
        timeoutMs: 5000,
      },
      {
        model: { providerId: 'openai', modelId: 'gpt-test' },
        messages: [],
        turnIndex: 0,
      },
    )) {
      // Consume the stream so the missing terminal event is finalized.
    }

    expect(repository.finalizeModelCall).toHaveBeenCalledOnce()
    expect(repository.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'interrupted',
        stopReason: 'deferred',
      }),
    )
  } finally {
    cleanup()
  }
})

it('审计 begin 和 finalize 失败都不改变 Gateway 事件流', async () => {
  const { cleanup, runtime } = createTestApp()
  try {
    const gateway: AiGateway = {
      async *stream(input) {
        yield {
          type: 'completed',
          turnIndex: input.turnIndex,
          assistantMessage: { role: 'assistant', blocks: [] },
          stopReason: 'stop',
          usage,
          cost: {
            currency: 'USD',
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        }
      },
    }

    const logError = vi.spyOn(runtime.logger, 'error').mockImplementation(() => undefined)

    for (const failure of ['begin', 'finalize'] as const) {
      const beginModelCall = vi.fn(() => {
        if (failure === 'begin') throw new Error('sensitive-begin-error')
      })
      const finalizeModelCall = vi.fn(() => {
        if (failure === 'finalize') throw new Error('sensitive-finalize-error')
      })
      const brokenRepository = {
        recoverInterrupted: vi.fn(),
        beginModelCall,
        finalizeModelCall,
        beginToolExecution: vi.fn(),
        finalizeToolExecution: vi.fn(),
        findModelCall: vi.fn(),
        listModelCalls: vi.fn(() => ({ items: [], total: 0 })),
        listToolExecutions: vi.fn(() => []),
      } as unknown as AiUsageAuditRepository
      const audit = createAiUsageAuditService(brokenRepository, runtime.logger)
      const runner = createAiInvocationRunner(gateway, audit)
      const events = []

      for await (const event of runner.stream(
        {
          requestId: 'safe-request',
          userId: 'safe-user',
          scenario: 'model_test',
          timeoutMs: 5000,
        },
        {
          model: { providerId: 'openai', modelId: 'gpt-test' },
          messages: [],
          turnIndex: 0,
        },
      )) {
        events.push(event)
      }

      expect(beginModelCall).toHaveBeenCalledOnce()
      expect(finalizeModelCall).toHaveBeenCalledTimes(failure === 'begin' ? 0 : 1)
      expect(events).toEqual([expect.objectContaining({ type: 'completed', stopReason: 'stop' })])
    }

    const serializedLogs = JSON.stringify(logError.mock.calls)
    expect(serializedLogs).not.toContain('sensitive-begin-error')
    expect(serializedLogs).not.toContain('sensitive-finalize-error')
  } finally {
    cleanup()
  }
})

describe('agent run audit ports', () => {
  it('只写 runId，不混入旧 conversation/generation 关联，并保持 Tool 审计接口一次 finalize', () => {
    const { cleanup, runtime } = createTestApp()
    try {
      const repository = {
        recoverInterrupted: vi.fn(),
        beginModelCall: vi.fn(),
        finalizeModelCall: vi.fn(),
        beginToolExecution: vi.fn(),
        finalizeToolExecution: vi.fn(),
        findModelCall: vi.fn(),
        listModelCalls: vi.fn(() => ({ items: [], total: 0 })),
        listToolExecutions: vi.fn(() => []),
      } as unknown as AiUsageAuditRepository
      const audit = createAiUsageAuditService(repository, runtime.logger)
      const modelPort = audit.createAgentModelCallAudit()
      const startedAt = new Date()
      const modelCallId = modelPort.beginModelCall({
        id: generateId(),
        runId: 'run-1',
        userId: 'user-1',
        requestId: 'request-1',
        model: { providerId: 'openai', modelId: 'gpt-test' },
        timeoutMs: 1000,
        startedAt,
      })
      expect(modelCallId).toBeTruthy()
      expect(repository.beginModelCall).toHaveBeenCalledWith(
        expect.objectContaining({
          scenario: 'agent_run',
          runId: 'run-1',
        }),
      )
      modelPort.finalizeModelCall({
        id: modelCallId ?? 'missing',
        requestId: 'request-1',
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 1),
        result: 'succeeded',
        stopReason: 'stop',
        errorCode: null,
        usage,
        cost: null,
      })
      expect(repository.finalizeModelCall).toHaveBeenCalledOnce()

      const toolPort = audit.createAgentToolExecutionAudit()
      const toolHandle = toolPort.beginToolExecution({
        id: generateId(),
        idempotencyToken: 'idem-tool-1',
        modelCallId,
        toolName: 'lookup',
        toolVersion: '1.0.0',
        timeoutMs: 100,
      })
      toolPort.finalizeToolExecution(toolHandle, 'succeeded', null)
      expect(repository.beginToolExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          modelCallId,
          toolName: 'lookup',
          toolVersion: '1.0.0',
        }),
      )
      expect(repository.finalizeToolExecution).toHaveBeenCalledOnce()
    } finally {
      cleanup()
    }
  })
})

describe('audit projection 字段白名单', () => {
  it('model call 与 tool execution projection 带全部执行关联，不含正文和 secret', () => {
    const { cleanup, runtime } = createTestApp()
    try {
      const repository = createAiUsageAuditRepository(runtime.db)
      const service = createAiUsageAuditService(repository, runtime.logger)
      const ids = seedRunLifecycle(runtime)
      const modelCallId = '019c4200-0020-7000-8000-000000000001'
      const startedAt = new Date()
      repository.beginModelCall({
        id: modelCallId,
        requestId: 'projection-request',
        userId: 'user-1',
        scenario: 'agent_run',
        runId: ids.runId,
        turnId: ids.turnId,
        stepId: ids.stepId,
        providerId: 'openai',
        modelId: 'gpt-test',
        api: 'openai-completions',
        startedAt,
        timeoutMs: 5000,
      })
      repository.finalizeModelCall({
        id: modelCallId,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 20),
        result: 'upstream_failed',
        stopReason: 'error',
        errorCode: 'AI.UPSTREAM_ERROR',
        usage,
        cost: null,
        ttftMs: 5,
        chunkCount: 7,
        responseModel: 'gpt-test-2024',
        responseId: 'resp-9',
        httpStatus: 500,
      })
      const toolHandle = service.beginToolExecution({
        id: generateId(),
        idempotencyToken: 'idem-projection-tool',
        modelCallId,
        requestId: 'projection-request',
        runId: ids.runId,
        turnId: ids.turnId,
        stepId: ids.stepId,
        toolCallId: 'call_abc',
        toolName: 'lookup',
        toolVersion: '1.0.0',
        timeoutMs: 100,
      })
      service.finalizeToolExecution(toolHandle, 'failed', 'AI.TOOL_FAILED')

      const detail = service.getModelCall(modelCallId)
      expect(Object.keys(detail ?? {}).sort()).toEqual(
        [
          'api',
          'appId',
          'chunkCount',
          'cost',
          'durationMs',
          'errorCategory',
          'errorCode',
          'externalUserId',
          'finishedAt',
          'httpStatus',
          'id',
          'modelId',
          'principalKind',
          'projectId',
          'providerId',
          'requestId',
          'responseId',
          'responseModel',
          'result',
          'runId',
          'scenario',
          'startedAt',
          'stepId',
          'stopReason',
          'tenantId',
          'timeoutMs',
          'toolExecutions',
          'ttftMs',
          'turnId',
          'usage',
          'userId',
        ].sort(),
      )
      expect(detail).toMatchObject({
        runId: ids.runId,
        turnId: ids.turnId,
        stepId: ids.stepId,
        api: 'openai-completions',
        ttftMs: 5,
        chunkCount: 7,
        responseModel: 'gpt-test-2024',
        responseId: 'resp-9',
        httpStatus: 500,
        errorCategory: 'upstream',
      })

      const tool = detail?.toolExecutions[0]
      expect(Object.keys(tool ?? {}).sort()).toEqual(
        [
          'durationMs',
          'errorCategory',
          'errorCode',
          'finishedAt',
          'id',
          'modelCallId',
          'runId',
          'startedAt',
          'status',
          'stepId',
          'timeoutMs',
          'toolCallId',
          'toolExecutionId',
          'toolName',
          'toolVersion',
          'turnId',
        ].sort(),
      )
      expect(tool).toMatchObject({
        runId: ids.runId,
        turnId: ids.turnId,
        stepId: ids.stepId,
        modelCallId,
        toolCallId: 'call_abc',
        toolExecutionId: toolHandle?.id,
        errorCategory: 'tool',
      })

      const serialized = JSON.stringify(detail)
      for (const forbidden of ['arguments', 'safeSummary', 'modelText', 'prompt', 'response":', 'secret']) {
        expect(serialized).not.toContain(forbidden)
      }
    } finally {
      cleanup()
    }
  })
})

function seedRunLifecycle(runtime: ReturnType<typeof createTestApp>['runtime']) {
  const now = Date.now()
  const ids = {
    agentId: '019c4200-0030-7000-8000-000000000001',
    sessionId: '019c4200-0030-7000-8000-000000000002',
    runId: '019c4200-0030-7000-8000-000000000003',
    turnId: '019c4200-0030-7000-8000-000000000004',
    stepId: '019c4200-0030-7000-8000-000000000005',
  }
  const sqlite = runtime.database.sqlite
  sqlite
    .prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('user-1', 'User', 'projection@example.com', 0, now, now)
  sqlite
    .prepare(
      `INSERT INTO ai_agent_definitions (id, name, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ids.agentId, 'Agent', '{"schemaVersion":2}', now, now)
  sqlite
    .prepare(
      `INSERT INTO ai_agent_sessions (id, owner_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ids.sessionId, 'user-1', 'Session', now, now)
  sqlite
    .prepare(
      `INSERT INTO ai_agent_runs
        (id, session_id, agent_id, lane, status, agent_revision,
         snapshot_json, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ids.runId, ids.sessionId, ids.agentId, 'main', 'running', 1, '{"schemaVersion":2}', 'projection-request', now)
  sqlite
    .prepare(
      `INSERT INTO ai_run_turns (id, run_id, turn_index, started_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(ids.turnId, ids.runId, 1, now)
  sqlite
    .prepare(
      `INSERT INTO ai_run_steps (id, run_id, turn_id, kind, attempt, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ids.stepId, ids.runId, ids.turnId, 'assistant', 1, now)
  return ids
}
