import { AppError } from "@api/shared/app-error.js";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PermissionKeys, type Permission } from "@starter/contracts";
import { createRequireProductApp } from "@api/modules/ai/application/application.guard.js";
import { createAiApplicationService } from "@api/modules/ai/application/application.service.js";
import {
  createAppSecret,
  hashAppSecret,
} from "@api/modules/ai/application/application.crypto.js";
import type { AiAppCredentialRecord } from "@api/modules/ai/application/application.repository.js";
import {
  createPiToolAdapter,
  PiToolExecutionError,
} from "@api/infra/agent/pi-tool-adapter.js";
import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";
import type { PrincipalContext } from "@api/modules/ai/principal.js";
import type { RunExecutionContext } from "@api/infra/agent/run-execution-context.js";
import { testRunExecution } from "./run-execution.js";

function record(secret: string): AiAppCredentialRecord {
  const now = new Date();
  return {
    id: "01958c80-8df7-7ce2-8f90-123456789001",
    name: "Product",
    tenantId: "tenant-a",
    projectId: "project-a",
    secretHash: hashAppSecret(secret),
    secretPrefix: secret.slice(0, 12),
    status: "active",
    createdBy: "admin",
    updatedBy: "admin",
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    revokedAt: null,
  };
}

it("product app guard 从 credential 派生 scope，并拒绝缺失或不完整 subject", async () => {
  const generated = createAppSecret();
  let used = false;
  const appService = createAiApplicationService({
    repository: {
      list: () => [],
      findById: () => undefined,
      findActiveByPrefix: () => [record(generated.secret)],
      markUsed: () => {
        used = true;
      },
    } as never,
    logger: { info() {} } as never,
  });
  const app = new Hono();
  app.onError((error, context) =>
    context.text("error", error instanceof AppError ? error.status : 500),
  );
  app.use("/runtime", createRequireProductApp(appService));
  app.get("/runtime", (context) => {
    const principal = context.get("principal" as never) as {
      tenantId: string;
      projectId: string;
      externalUserId: string;
    };
    return context.json(principal);
  });

  const valid = await app.request("/runtime", {
    headers: {
      Authorization: `Bearer ${generated.secret}`,
      "X-AI-External-User-Id": "user-42",
      "X-AI-Subject-Type": "order",
      "X-AI-Subject-Id": "order-7",
    },
  });
  expect(valid.status).toBe(200);
  expect(await valid.json()).toMatchObject({
    tenantId: "tenant-a",
    projectId: "project-a",
    externalUserId: "user-42",
  });
  expect(used).toBe(true);

  const invalid = await app.request("/runtime", {
    headers: {
      Authorization: `Bearer ${generated.secret}`,
      "X-AI-External-User-Id": "user-42",
      "X-AI-Subject-Type": "order",
    },
  });
  expect(invalid.status).toBe(401);
});

function adapterOptions(
  principal: PrincipalContext = {
    kind: "product_app",
    principalId: "app-credential-1",
    tenantId: "tenant-a",
    projectId: "project-a",
    externalUserId: "user-42",
    appId: "app-credential-1",
  },
): {
  execution: RunExecutionContext;
  hasPermission: (userId: string, permission: Permission) => Promise<boolean>;
} {
  return {
    execution: testRunExecution({
      requestId: "product-request-1",
      principal,
      scope: {
        tenantId: principal.tenantId,
        projectId: principal.projectId,
        subjectType: null,
        subjectId: null,
      },
    }),
    hasPermission: vi.fn(
      async (_userId: string, _permission: Permission) => true,
    ),
  };
}

const starterUserPrincipal: PrincipalContext = {
  kind: "starter_user",
  principalId: "user-42",
  tenantId: "starter",
  projectId: "starter",
  externalUserId: "user-42",
  appId: null,
};

function registerProtectedTool() {
  return createAiToolRegistry([
    defineAiTool({
      name: "admin_secret",
      version: "1.0.0",
      description: "Requires ai:config:manage",
      inputSchema: z.object({}),
      timeoutMs: 5000,
      scope: "platform",
      requiredPermission: PermissionKeys.AI_CONFIG_MANAGE,
      async execute() {
        return { modelText: "admin-secret-value", safeSummary: null };
      },
    }),
  ]);
}

describe("product_app tool permission boundary", () => {
  it("product_app 调用带要求的 Tool 直接 forbidden，伪造 Starter 用户 external ID 也不查 user_roles", async () => {
    const options = adapterOptions();
    // 即使 hasPermission 对任意 Starter 用户都返回 true（模拟伪造身份能命中角色表），
    // product_app 主体也必须被拒绝，且根本不允许查询 Starter 用户角色。
    const adapter = createPiToolAdapter(
      registerProtectedTool().list(),
      options,
    );
    const tool = adapter.tools[0];
    if (!tool) throw new Error("tool missing");

    await expect(
      tool.execute("product-tool-call", {}, new AbortController().signal),
    ).rejects.toBeInstanceOf(PiToolExecutionError);
    const override = await adapter.afterToolCall({
      toolCall: {
        type: "toolCall",
        id: "product-tool-call",
        name: "admin_secret",
        arguments: {},
      },
    } as never);
    expect(override).toMatchObject({
      isError: true,
      details: {
        status: "forbidden",
        errorCode: "AI.TOOL_FORBIDDEN",
      },
    });
    // 关键断言：Product App 权限查询从未触碰 Starter user_roles
    expect(options.hasPermission).not.toHaveBeenCalled();
  });

  it("starter_user 权限查询抛错时按 forbidden 处理，不降级允许", async () => {
    const options = adapterOptions(starterUserPrincipal);
    options.hasPermission = vi.fn(async () => {
      throw new Error("user_roles query exploded");
    });
    const adapter = createPiToolAdapter(
      registerProtectedTool().list(),
      options,
    );
    const tool = adapter.tools[0];
    if (!tool) throw new Error("tool missing");

    await expect(
      tool.execute("starter-tool-call", {}, new AbortController().signal),
    ).rejects.toBeInstanceOf(PiToolExecutionError);
    const override = await adapter.afterToolCall({
      toolCall: {
        type: "toolCall",
        id: "starter-tool-call",
        name: "admin_secret",
        arguments: {},
      },
    } as never);
    expect(override).toMatchObject({
      details: { status: "forbidden", errorCode: "AI.TOOL_FORBIDDEN" },
    });
  });

  it("超过 16000 字符或不可序列化的参数按 invalid_arguments 处理", async () => {
    const bigArgs = { value: "x".repeat(16_001) };
    const circularArgs: { self?: unknown } = {};
    circularArgs.self = circularArgs;
    for (const args of [bigArgs, circularArgs]) {
      const options = adapterOptions(starterUserPrincipal);
      const adapter = createPiToolAdapter(
        registerProtectedTool().list(),
        options,
      );
      const tool = adapter.tools[0];
      if (!tool) throw new Error("tool missing");
      await expect(
        tool.execute("oversize-tool-call", args, new AbortController().signal),
      ).rejects.toBeInstanceOf(PiToolExecutionError);
      const override = await adapter.afterToolCall({
        toolCall: {
          type: "toolCall",
          id: "oversize-tool-call",
          name: "admin_secret",
          arguments: args,
        },
      } as never);
      expect(override).toMatchObject({
        details: {
          status: "invalid_arguments",
          errorCode: "AI.TOOL_INVALID_ARGUMENTS",
        },
      });
      // 参数值与原始异常不得出现在任何失败输出中
      expect(JSON.stringify(override)).not.toContain("x".repeat(8));
      expect(JSON.stringify(override)).not.toContain("circular");
      expect(options.hasPermission).not.toHaveBeenCalled();
    }
  });
});
