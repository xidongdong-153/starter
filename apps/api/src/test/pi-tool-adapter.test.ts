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
        description: "Look up a value",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 1000,
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
      expect.objectContaining({ userId: "user-1", requestId: "request-1" }),
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

  it("再次 parse、检查权限，并把拒绝原因转换为安全 tool result", async () => {
    const audit = createAudit();
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "protected",
        description: "Protected action",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 1000,
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

  it("工具超时会结束审计并通知 executor 终止当前 Run", async () => {
    const audit = createAudit();
    const onTerminalFailure = vi.fn();
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "slow",
        description: "Slow action",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 100,
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

    expect(onTerminalFailure).toHaveBeenCalledWith("timed_out");
    expect(audit.finalizeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-tool-1" }),
      "timed_out",
      "AI.TOOL_TIMED_OUT",
    );
  });
});
