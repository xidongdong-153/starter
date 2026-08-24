import { PermissionKeys } from "@starter/contracts";
import { z } from "zod";

import { defineAiTool, type RegisteredAiTool } from "./tool-registry.js";

/**
 * 仅用于测试/验证的 AI 工具集。
 *
 * 由 `AI_TEST_TOOLS_ENABLED` 环境变量控制是否注册（dev 默认开，生产不配即关）。
 * 这些工具用于验证 tool 注册、编排、权限、超时、审计全链路，不属于业务工具。
 */
export function createTestAiTools(): RegisteredAiTool[] {
  return [
    defineAiTool({
      name: "echo",
      version: "1.0.0",
      description: "回显给定的文本参数，用于验证工具参数传递。",
      inputSchema: z.object({
        text: z.string().min(1).max(1000),
      }),
      timeoutMs: 5000,
      scope: "platform",
      requiredPermission: null,
      async execute(_context, input) {
        return {
          modelText: `echo: ${input.text}`,
          safeSummary: `已回显 ${input.text.length} 字符`,
        };
      },
    }),
    defineAiTool({
      name: "get_current_time",
      version: "1.0.0",
      description: "返回当前时间的 ISO 8601 字符串，无参数。",
      inputSchema: z.object({}),
      timeoutMs: 5000,
      scope: "platform",
      requiredPermission: null,
      async execute() {
        return {
          modelText: new Date().toISOString(),
          safeSummary: "返回当前时间",
        };
      },
    }),
    defineAiTool({
      name: "add_numbers",
      version: "1.0.0",
      description: "计算两个数字的和，用于验证数值参数。",
      inputSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      timeoutMs: 5000,
      scope: "platform",
      requiredPermission: null,
      async execute(_context, input) {
        return {
          modelText: String(input.a + input.b),
          safeSummary: `计算结果 ${input.a + input.b}`,
        };
      },
    }),
    defineAiTool({
      name: "random_number",
      version: "1.0.0",
      description: "返回 [min, max] 闭区间内的随机整数，用于验证范围参数。",
      inputSchema: z
        .object({
          min: z.number().int(),
          max: z.number().int(),
        })
        .refine((value) => value.min <= value.max, {
          message: "min 不能大于 max",
          path: ["min"],
        }),
      timeoutMs: 5000,
      scope: "platform",
      requiredPermission: null,
      async execute(_context, input) {
        const span = input.max - input.min + 1;
        const value = input.min + Math.floor(Math.random() * span);
        return {
          modelText: String(value),
          safeSummary: `随机数 ${value}`,
        };
      },
    }),
    defineAiTool({
      name: "fail_tool",
      version: "1.0.0",
      description: "固定抛错，用于验证工具失败路径与审计。",
      inputSchema: z.object({}),
      timeoutMs: 5000,
      scope: "platform",
      requiredPermission: null,
      async execute() {
        throw new Error("fail_tool 故意失败");
      },
    }),
    defineAiTool({
      name: "slow_tool",
      version: "1.0.0",
      description:
        "等待指定秒数后返回，每秒上报一次进度，用于验证超时、取消和进度路径。",
      inputSchema: z.object({
        seconds: z.number().int().min(1).max(10),
      }),
      timeoutMs: 3000,
      scope: "platform",
      requiredPermission: null,
      async execute(_context, input) {
        for (let elapsed = 1; elapsed <= input.seconds; elapsed += 1) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 1000);
            _context.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
              },
              { once: true },
            );
          });
          _context.reportProgress(`已等待 ${elapsed}/${input.seconds} 秒`);
        }
        return {
          modelText: `waited ${input.seconds}s`,
          safeSummary: `等待了 ${input.seconds} 秒`,
        };
      },
    }),
    defineAiTool({
      name: "admin_secret",
      version: "1.0.0",
      description: "需要 ai:config:manage 权限才能调用，用于验证权限拒绝路径。",
      inputSchema: z.object({}),
      timeoutMs: 5000,
      scope: "platform",
      requiredPermission: PermissionKeys.AI_CONFIG_MANAGE,
      async execute() {
        return {
          modelText: "admin-secret-value",
          safeSummary: "返回管理员可见的固定值",
        };
      },
    }),
  ];
}
