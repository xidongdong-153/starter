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
    description: "lookup",
    inputSchema: z.object({}),
    timeoutMs: 1000,
    scope: { tenantId: "tenant-a", projectId: "project-a" },
    requiredPermission: null,
    async execute() {
      return { modelText: "ok", safeSummary: null };
    },
  } as const;
  const first = defineAiTool({ ...base, version: "1.0.0" });
  const second = defineAiTool({ ...base, version: "2.0.0" });
  expect(createAiToolRegistry([first, second]).list()).toHaveLength(2);
  expect(() => createAiToolRegistry([first, first])).toThrow("lookup@1.0.0");
  expect(() => defineAiTool({ ...base, version: "latest" })).toThrow(
    "版本无效",
  );
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
    userId: "unit-user",
    requestId: "unit-request",
    signal: new AbortController().signal,
  };

  const add = registry.find("add_numbers");
  expect(add).toBeDefined();
  const addResult = await add!.execute(context, { a: 2, b: 3 });
  expect(addResult.modelText).toBe("5");

  const random = registry.find("random_number");
  expect(random).toBeDefined();
  for (let i = 0; i < 20; i += 1) {
    const result = await random!.execute(context, { min: 1, max: 3 });
    expect(["1", "2", "3"]).toContain(result.modelText);
  }

  const time = registry.find("get_current_time");
  expect(time).toBeDefined();
  const timeResult = await time!.execute(context, {});
  expect(new Date(timeResult.modelText).toString()).not.toBe("Invalid Date");
});
