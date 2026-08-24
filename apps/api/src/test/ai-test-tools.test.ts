import { expect, it } from "vitest";

import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";
import { createTestAiTools } from "@api/modules/ai/tool/test-tools.js";
import { z } from "zod";

import { createTestApp } from "./helpers.js";

it("测试工具集注册：7 个工具名称与 schema 全部合法", () => {
  const tools = createTestAiTools();
  expect(tools).toHaveLength(7);
  const registry = createAiToolRegistry(tools);
  expect(registry.list().map((tool) => tool.name)).toEqual([
    "echo",
    "get_current_time",
    "add_numbers",
    "random_number",
    "fail_tool",
    "slow_tool",
    "admin_secret",
  ]);
  expect(registry.list().every((tool) => tool.version === "1.0.0")).toBe(true);
  expect(registry.list().every((tool) => tool.scope === "platform")).toBe(true);
});

it("registry 按 name@version 唯一并校验 scope", () => {
  const base = {
    name: "lookup",
    version: "1.0.0",
    description: "lookup",
    inputSchema: z.object({}),
    timeoutMs: 1000,
    scope: { tenantId: "tenant-a", projectId: "project-a" },
    requiredPermission: null,
    async execute() {
      return { modelText: "ok", safeSummary: null };
    },
  } as const;
  const first = defineAiTool(base);
  const second = defineAiTool({ ...base, version: "2.0.0" });
  const registry = createAiToolRegistry([first, second]);
  expect(registry.list()).toHaveLength(2);
  expect(() => createAiToolRegistry([first, first])).toThrow("lookup@1.0.0");
  expect(() => defineAiTool({ ...base, version: "latest" })).toThrow(
    "版本无效",
  );

  // 精确版本查找：同名两个版本互不干扰，无版本参数已从类型中移除
  expect(registry.find({ name: "lookup", version: "1.0.0" })?.version).toBe(
    "1.0.0",
  );
  expect(registry.find({ name: "lookup", version: "2.0.0" })?.version).toBe(
    "2.0.0",
  );
  expect(registry.find({ name: "lookup", version: "3.0.0" })).toBeUndefined();
  expect(registry.require({ name: "lookup", version: "1.0.0" }).version).toBe(
    "1.0.0",
  );
  expect(() => registry.require({ name: "lookup", version: "9.0.0" })).toThrow(
    "lookup@9.0.0",
  );
});

it("listPublic 只投影公开元数据，不含 schema 和 handler", () => {
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      version: "1.0.0",
      description: "lookup",
      inputSchema: z.object({}),
      timeoutMs: 1000,
      scope: { tenantId: "tenant-a", projectId: "project-a" },
      requiredPermission: null,
      async execute() {
        return { modelText: "ok", safeSummary: null };
      },
    }),
  ]);
  expect(registry.listPublic()).toEqual([
    {
      name: "lookup",
      version: "1.0.0",
      description: "lookup",
      scope: { tenantId: "tenant-a", projectId: "project-a" },
    },
  ]);
  const projected = registry.listPublic()[0] as Record<string, unknown>;
  expect("inputSchema" in projected).toBe(false);
  expect("execute" in projected).toBe(false);
  // listPublic 每次返回新数组，外部修改不影响 registry
  expect(registry.listPublic()).not.toBe(registry.listPublic());
});

it("env 开关启用时 runtime 注册测试工具，不配置时为空", () => {
  const enabled = createTestApp({ AI_TEST_TOOLS_ENABLED: "true" });
  try {
    expect(enabled.runtime.aiTools.list()).toHaveLength(7);
  } finally {
    enabled.cleanup();
  }

  const disabled = createTestApp();
  try {
    expect(disabled.runtime.aiTools.list()).toEqual([]);
  } finally {
    disabled.cleanup();
  }
});

it("add_numbers 与 random_number 直接执行结果正确", async () => {
  const registry = createAiToolRegistry(createTestAiTools());
  const context = {
    principal: {
      kind: "starter_user" as const,
      principalId: "unit-user",
      tenantId: "starter",
      projectId: "starter",
      externalUserId: "unit-user",
      appId: null,
    },
    scope: {
      tenantId: "starter",
      projectId: "starter",
      subjectType: null,
      subjectId: null,
    },
    requestId: "unit-request",
    signal: new AbortController().signal,
    reportProgress: () => undefined,
  };

  const add = registry.find({ name: "add_numbers", version: "1.0.0" });
  expect(add).toBeDefined();
  const addResult = await add!.execute(context, { a: 2, b: 3 });
  expect(addResult.modelText).toBe("5");

  const random = registry.find({ name: "random_number", version: "1.0.0" });
  expect(random).toBeDefined();
  for (let i = 0; i < 20; i += 1) {
    const result = await random!.execute(context, { min: 1, max: 3 });
    expect(["1", "2", "3"]).toContain(result.modelText);
  }

  const time = registry.find({ name: "get_current_time", version: "1.0.0" });
  expect(time).toBeDefined();
  const timeResult = await time!.execute(context, {});
  expect(new Date(timeResult.modelText).toString()).not.toBe("Invalid Date");
});
