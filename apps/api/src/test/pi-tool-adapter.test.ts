import { PermissionKeys, type Permission } from "@starter/contracts";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  createPiToolAdapter,
  PiToolExecutionError,
} from "@api/infra/agent/pi-tool-adapter.js";
import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";

function createAudit() {
  const handle = { id: "audit-tool-1", startedAt: new Date() };
  return {
    beginToolExecution: vi.fn(() => handle),
    finalizeToolExecution: vi.fn(),
  };
}

function options(audit: ReturnType<typeof createAudit>, allowed = true) {
  return {
    principal: {
      kind: "starter_user" as const,
      principalId: "user-1",
      tenantId: "starter",
      projectId: "starter",
      externalUserId: "user-1",
      appId: null,
    },
    scope: {
      tenantId: "starter",
      projectId: "starter",
      subjectType: null,
      subjectId: null,
    },
    userId: "user-1",
    requestId: "request-1",
    hasPermission: vi.fn(
      async (_userId: string, _permission: Permission) => allowed,
    ),
    getModelCallId: () => "model-call-1",
    audit,
  };
}

describe("pi tool adapter", () => {
  it("只把 Zod object schema 转为模型参数，执行时再次 parse 并完成一次审计", async () => {
    const audit = createAudit();
    const execute = vi.fn(async () => ({
      modelText: "result",
      safeSummary: "done",
    }));
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "lookup",
        version: "1.0.0",
        description: "Look up a value",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 1000,
        scope: "platform",
        requiredPermission: null,
        execute,
      }),
    ]);
    const adapter = createPiToolAdapter(registry.list(), options(audit));
    const tool = adapter.tools[0];
    if (!tool) throw new Error("tool missing");

    expect(tool.parameters).toMatchObject({ type: "object" });
    const result = await tool.execute(
      "tool-call-1",
      { value: "input" },
      new AbortController().signal,
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ principalId: "user-1" }),
        requestId: "request-1",
      }),
      { value: "input" },
    );
    expect(result).toMatchObject({
      content: [{ type: "text", text: "result" }],
      details: {
        status: "succeeded",
        safeSummary: "done",
      },
    });
    expect(audit.beginToolExecution).toHaveBeenCalledOnce();
    expect(audit.beginToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "request-1" }),
    );
    expect(audit.finalizeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-tool-1" }),
      "succeeded",
      null,
    );
  });

  it("工具的 reportProgress 通过 Pi onUpdate 上报，只带脱敏摘要", async () => {
    const audit = createAudit();
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "progressive",
        version: "1.0.0",
        description: "Reports progress",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 1000,
        scope: "platform",
        requiredPermission: null,
        execute: async (context) => {
          context.reportProgress("第 1 步完成");
          context.reportProgress("");
          context.reportProgress("第 2 步完成");
          return { modelText: "result", safeSummary: "done" };
        },
      }),
    ]);
    const adapter = createPiToolAdapter(registry.list(), options(audit));
    const tool = adapter.tools[0];
    if (!tool) throw new Error("tool missing");

    const updates: unknown[] = [];
    await tool.execute(
      "tool-call-progress",
      { value: "input" },
      new AbortController().signal,
      (partial) => updates.push(partial),
    );

    // 空摘要被忽略，只上报两条
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      content: [],
      details: { safeSummary: "第 1 步完成", modelText: "" },
    });
    expect(updates[1]).toMatchObject({
      details: { safeSummary: "第 2 步完成" },
    });
    // 进度不产生额外审计，仍是一次 begin + 一次 finalize
    expect(audit.beginToolExecution).toHaveBeenCalledOnce();
    expect(audit.finalizeToolExecution).toHaveBeenCalledOnce();
  });

  it("再次 parse、检查权限，并把拒绝原因转换为安全 tool result", async () => {
    const audit = createAudit();
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "protected",
        version: "1.0.0",
        description: "Protected action",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 1000,
        scope: "platform",
        requiredPermission: PermissionKeys.AI_CONFIG_MANAGE,
        execute: async () => ({ modelText: "secret", safeSummary: null }),
      }),
    ]);
    const adapter = createPiToolAdapter(registry.list(), options(audit, false));
    const tool = adapter.tools[0];
    if (!tool) throw new Error("tool missing");

    await expect(
      tool.execute(
        "tool-call-2",
        { value: "input" },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(PiToolExecutionError);
    const override = await adapter.afterToolCall({
      toolCall: {
        type: "toolCall",
        id: "tool-call-2",
        name: "protected",
        arguments: { value: "input" },
      },
    } as never);

    expect(override).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Permission denied for this tool." }],
      details: {
        status: "forbidden",
        errorCode: "AI.TOOL_FORBIDDEN",
      },
    });
    expect(audit.finalizeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-tool-1" }),
      "forbidden",
      "AI.TOOL_FORBIDDEN",
    );
  });

  it("工具超时结束审计并交回模型，不终止当前 Run", async () => {
    const audit = createAudit();
    const onTerminalFailure = vi.fn();
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "slow",
        version: "1.0.0",
        description: "Slow action",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 100,
        scope: "platform",
        requiredPermission: null,
        execute: async () =>
          new Promise(() => {
            // intentionally unresolved; adapter timeout owns cancellation
          }),
      }),
    ]);
    const adapter = createPiToolAdapter(registry.list(), {
      ...options(audit),
      onTerminalFailure,
    });
    const tool = adapter.tools[0];
    if (!tool) throw new Error("tool missing");

    await expect(
      tool.execute(
        "tool-call-3",
        { value: "input" },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(PiToolExecutionError);

    // 工具自身超时不终止 Run，模型要能拿到失败原因继续回复
    expect(onTerminalFailure).not.toHaveBeenCalled();
    expect(audit.finalizeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-tool-1" }),
      "timed_out",
      "AI.TOOL_TIMED_OUT",
    );

    // afterToolCall 把失败转成带超时时长的 tool result，terminate 为 false
    const override = await adapter.afterToolCall({
      toolCall: {
        type: "toolCall",
        id: "tool-call-3",
        name: "slow",
        arguments: { value: "input" },
      },
    } as never);
    expect(override).toMatchObject({
      isError: true,
      terminate: false,
      content: [{ type: "text", text: "The tool timed out after 100ms." }],
      details: { status: "timed_out", errorCode: "AI.TOOL_TIMED_OUT" },
    });
  });

  it("用户取消仍然终止当前 Run", async () => {
    const audit = createAudit();
    const onTerminalFailure = vi.fn();
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "cancellable",
        version: "1.0.0",
        description: "Cancellable action",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 5000,
        scope: "platform",
        requiredPermission: null,
        execute: async () =>
          new Promise(() => {
            // never settles; caller abort owns cancellation
          }),
      }),
    ]);
    const adapter = createPiToolAdapter(registry.list(), {
      ...options(audit),
      onTerminalFailure,
    });
    const tool = adapter.tools[0];
    if (!tool) throw new Error("tool missing");

    const controller = new AbortController();
    const pending = tool.execute(
      "tool-call-4",
      { value: "input" },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(PiToolExecutionError);

    expect(onTerminalFailure).toHaveBeenCalledWith("cancelled");
    expect(audit.finalizeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-tool-1" }),
      "cancelled",
      "AI.TOOL_CANCELLED",
    );
  });
});

describe("pi tool adapter sensitive marker isolation", () => {
  it("原始异常、arguments 和 secret marker 不进入审计或失败输出", async () => {
    const audit = createAudit();
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "leaky",
        version: "1.0.0",
        description: "Throw with a marker",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 1000,
        scope: "platform",
        requiredPermission: null,
        execute: async () => {
          throw new Error("TOOL_ERROR_SECRET_MARKER");
        },
      }),
    ]);
    const adapter = createPiToolAdapter(registry.list(), options(audit));
    const tool = adapter.tools[0];
    if (!tool) throw new Error("tool missing");

    await expect(
      tool.execute(
        "tool-call-marker",
        { value: "TOOL_ARGUMENT_SECRET_MARKER" },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(PiToolExecutionError);

    const override = await adapter.afterToolCall({
      toolCall: {
        type: "toolCall",
        id: "tool-call-marker",
        name: "leaky",
        arguments: { value: "TOOL_ARGUMENT_SECRET_MARKER" },
      },
    } as never);

    const serialized = JSON.stringify({ override, audit });
    expect(serialized).not.toContain("TOOL_ERROR_SECRET_MARKER");
    expect(serialized).not.toContain("TOOL_ARGUMENT_SECRET_MARKER");
    expect(override).toMatchObject({
      isError: true,
      details: { status: "failed", errorCode: "AI.TOOL_FAILED" },
    });
    expect(audit.beginToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "leaky", toolVersion: "1.0.0" }),
    );
    expect(audit.finalizeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-tool-1" }),
      "failed",
      "AI.TOOL_FAILED",
    );
  });
});
