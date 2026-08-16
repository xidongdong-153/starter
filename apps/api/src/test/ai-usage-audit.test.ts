import type { AiUsageAuditRepository } from "@api/modules/ai/ai-usage-audit.repository.js";
import type { AiGateway } from "@api/infra/ai/index.js";
import { expect, it, vi } from "vitest";

import { createAiUsageAuditRepository } from "@api/modules/ai/ai-usage-audit.repository.js";
import {
  createAiInvocationRunner,
  createAiUsageAuditService,
  resolveModelCallTimeout,
  resolveToolExecutionTimeout,
} from "@api/modules/ai/ai-usage-audit.service.js";

import { createTestApp } from "./helpers.js";

const usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: 0,
} as const;

it("启动恢复把未完成的模型调用和工具执行标记为 interrupted", () => {
  const { cleanup, runtime } = createTestApp();
  try {
    const repository = createAiUsageAuditRepository(runtime.db);
    const modelCallId = "019c4200-0010-7000-8000-000000000001";
    const toolExecutionId = "019c4200-0010-7000-8000-000000000002";
    const freshModelCallId = "019c4200-0010-7000-8000-000000000003";
    const freshToolExecutionId = "019c4200-0010-7000-8000-000000000004";
    const startedAt = new Date(Date.now() - 11_000);
    const freshStartedAt = new Date();
    repository.beginModelCall({
      id: modelCallId,
      requestId: "recovery-request",
      userId: "recovery-user",
      scenario: "model_test",
      conversationId: null,
      generationId: null,
      providerId: "openai",
      modelId: "gpt-test",
      startedAt,
      timeoutMs: 5000,
    });
    repository.beginToolExecution({
      id: toolExecutionId,
      aiCallId: modelCallId,
      toolName: "lookup",
      startedAt,
      timeoutMs: 5000,
    });
    repository.beginModelCall({
      id: freshModelCallId,
      requestId: "fresh-request",
      userId: "fresh-user",
      scenario: "model_test",
      conversationId: null,
      generationId: null,
      providerId: "openai",
      modelId: "gpt-test",
      startedAt: freshStartedAt,
      timeoutMs: 5000,
    });
    repository.beginToolExecution({
      id: freshToolExecutionId,
      aiCallId: freshModelCallId,
      toolName: "lookup",
      startedAt: freshStartedAt,
      timeoutMs: 5000,
    });

    createAiUsageAuditService(repository, runtime.logger);

    expect(repository.findModelCall(modelCallId)).toMatchObject({
      result: "interrupted",
      stopReason: "deferred",
      durationMs: null,
    });
    expect(repository.listToolExecutions(modelCallId)).toEqual([
      expect.objectContaining({
        id: toolExecutionId,
        status: "interrupted",
        durationMs: null,
      }),
    ]);
    expect(repository.findModelCall(freshModelCallId)).toMatchObject({
      result: "running",
      finishedAt: null,
    });
    expect(repository.listToolExecutions(freshModelCallId)).toEqual([
      expect.objectContaining({ status: "running", finishedAt: null }),
    ]);
  } finally {
    cleanup();
  }
});

it("finalize 只写一次并保留真实的 0 usage 和 0 成本", () => {
  const { cleanup, runtime } = createTestApp();
  try {
    const repository = createAiUsageAuditRepository(runtime.db);
    const id = "019c4200-0010-7000-8000-000000000005";
    const startedAt = new Date();
    repository.beginModelCall({
      id,
      requestId: "zero-request",
      userId: "zero-user",
      scenario: "model_test",
      conversationId: null,
      generationId: null,
      providerId: "openai",
      modelId: "gpt-test",
      startedAt,
      timeoutMs: 5000,
    });
    repository.finalizeModelCall({
      id,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 10),
      result: "succeeded",
      stopReason: "stop",
      errorCode: null,
      usage,
      cost: {
        currency: "USD",
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    });
    repository.finalizeModelCall({
      id,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 20),
      result: "upstream_failed",
      stopReason: "error",
      errorCode: "AI.UPSTREAM_ERROR",
      usage: { ...usage, totalTokens: 99 },
      cost: null,
    });

    expect(repository.findModelCall(id)).toMatchObject({
      result: "succeeded",
      durationMs: 10,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costInput: 0,
      costOutput: 0,
      costTotal: 0,
      costCurrency: "USD",
    });
  } finally {
    cleanup();
  }
});

it("模型和工具调用使用剩余 generation 时间计算 effective timeout", async () => {
  expect(resolveModelCallTimeout(60_000, 1200)).toBe(1200);
  expect(resolveModelCallTimeout(60_000, 90_000)).toBe(60_000);
  expect(resolveToolExecutionTimeout(undefined, 6000)).toBe(5000);
  expect(resolveToolExecutionTimeout(8000, 1200)).toBe(1200);

  let receivedTimeoutMs: number | undefined;
  const gateway: AiGateway = {
    async *stream(input) {
      receivedTimeoutMs = input.timeoutMs;
      yield {
        type: "completed",
        turnIndex: input.turnIndex,
        assistantMessage: { role: "assistant", blocks: [] },
        stopReason: "stop",
        usage,
        cost: null,
      };
    },
  };
  const repository = {
    recoverInterrupted: vi.fn(),
    beginModelCall: vi.fn(),
    finalizeModelCall: vi.fn(),
    beginToolExecution: vi.fn(),
    finalizeToolExecution: vi.fn(),
    findModelCall: vi.fn(),
    listModelCalls: vi.fn(() => ({ items: [], total: 0 })),
    listToolExecutions: vi.fn(() => []),
  } as unknown as AiUsageAuditRepository;
  const { cleanup, runtime } = createTestApp();
  try {
    const audit = createAiUsageAuditService(repository, runtime.logger);
    const runner = createAiInvocationRunner(gateway, audit);
    for await (const _event of runner.stream(
      {
        requestId: "timeout-request",
        userId: "timeout-user",
        scenario: "conversation",
        timeoutMs: 60_000,
        generationRemainingMs: 1200,
      },
      {
        model: { providerId: "openai", modelId: "gpt-test" },
        messages: [],
        turnIndex: 0,
      },
    )) {
      // Consume the stream so the terminal audit runs.
    }

    expect(receivedTimeoutMs).toBe(1200);
    expect(repository.beginModelCall).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 1200 }),
    );
  } finally {
    cleanup();
  }
});

it("没有 Gateway 终态时只 finalize 一次 interrupted", async () => {
  const gateway: AiGateway = {
    async *stream() {},
  };
  const repository = {
    recoverInterrupted: vi.fn(),
    beginModelCall: vi.fn(),
    finalizeModelCall: vi.fn(),
    beginToolExecution: vi.fn(),
    finalizeToolExecution: vi.fn(),
    findModelCall: vi.fn(),
    listModelCalls: vi.fn(() => ({ items: [], total: 0 })),
    listToolExecutions: vi.fn(() => []),
  } as unknown as AiUsageAuditRepository;
  const { cleanup, runtime } = createTestApp();
  try {
    const runner = createAiInvocationRunner(
      gateway,
      createAiUsageAuditService(repository, runtime.logger),
    );
    for await (const _event of runner.stream(
      {
        requestId: "interrupted-request",
        userId: "interrupted-user",
        scenario: "model_test",
        timeoutMs: 5000,
      },
      {
        model: { providerId: "openai", modelId: "gpt-test" },
        messages: [],
        turnIndex: 0,
      },
    )) {
      // Consume the stream so the missing terminal event is finalized.
    }

    expect(repository.finalizeModelCall).toHaveBeenCalledOnce();
    expect(repository.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "interrupted",
        stopReason: "deferred",
      }),
    );
  } finally {
    cleanup();
  }
});

it("审计 begin 和 finalize 失败都不改变 Gateway 事件流", async () => {
  const { cleanup, runtime } = createTestApp();
  try {
    const gateway: AiGateway = {
      async *stream(input) {
        yield {
          type: "completed",
          turnIndex: input.turnIndex,
          assistantMessage: { role: "assistant", blocks: [] },
          stopReason: "stop",
          usage,
          cost: {
            currency: "USD",
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        };
      },
    };

    const logError = vi
      .spyOn(runtime.logger, "error")
      .mockImplementation(() => undefined);

    for (const failure of ["begin", "finalize"] as const) {
      const beginModelCall = vi.fn(() => {
        if (failure === "begin") throw new Error("sensitive-begin-error");
      });
      const finalizeModelCall = vi.fn(() => {
        if (failure === "finalize") throw new Error("sensitive-finalize-error");
      });
      const brokenRepository = {
        recoverInterrupted: vi.fn(),
        beginModelCall,
        finalizeModelCall,
        beginToolExecution: vi.fn(),
        finalizeToolExecution: vi.fn(),
        findModelCall: vi.fn(),
        listModelCalls: vi.fn(() => ({ items: [], total: 0 })),
        listToolExecutions: vi.fn(() => []),
      } as unknown as AiUsageAuditRepository;
      const audit = createAiUsageAuditService(brokenRepository, runtime.logger);
      const runner = createAiInvocationRunner(gateway, audit);
      const events = [];

      for await (const event of runner.stream(
        {
          requestId: "safe-request",
          userId: "safe-user",
          scenario: "model_test",
          timeoutMs: 5000,
        },
        {
          model: { providerId: "openai", modelId: "gpt-test" },
          messages: [],
          turnIndex: 0,
        },
      )) {
        events.push(event);
      }

      expect(beginModelCall).toHaveBeenCalledOnce();
      expect(finalizeModelCall).toHaveBeenCalledTimes(
        failure === "begin" ? 0 : 1,
      );
      expect(events).toEqual([
        expect.objectContaining({ type: "completed", stopReason: "stop" }),
      ]);
    }

    const serializedLogs = JSON.stringify(logError.mock.calls);
    expect(serializedLogs).not.toContain("sensitive-begin-error");
    expect(serializedLogs).not.toContain("sensitive-finalize-error");
  } finally {
    cleanup();
  }
});
