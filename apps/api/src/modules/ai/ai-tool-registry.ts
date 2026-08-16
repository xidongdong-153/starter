import type { Permission } from "@starter/contracts";
import { PermissionKeys } from "@starter/contracts";
import { z, type ZodType } from "zod";

export interface AiToolExecutionContext {
  userId: string;
  requestId: string;
  signal: AbortSignal;
}

export interface AiToolResult {
  modelText: string;
  safeSummary: string | null;
}

export interface AiToolDefinitionInput<TInput> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  timeoutMs: number;
  requiredPermission: Permission | null;
  execute: (
    context: AiToolExecutionContext,
    input: TInput,
  ) => Promise<AiToolResult>;
}

export interface RegisteredAiTool {
  name: string;
  description: string;
  inputSchema: ZodType<unknown>;
  timeoutMs: number;
  requiredPermission: Permission | null;
  execute: (
    context: AiToolExecutionContext,
    input: unknown,
  ) => Promise<AiToolResult>;
}

export interface AiToolRegistry {
  list: () => readonly RegisteredAiTool[];
  find: (name: string) => RegisteredAiTool | undefined;
}

export function defineAiTool<TInput>(
  input: AiToolDefinitionInput<TInput>,
): RegisteredAiTool {
  validateToolDefinition(input);
  return Object.freeze({
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema as ZodType<unknown>,
    timeoutMs: input.timeoutMs,
    requiredPermission: input.requiredPermission,
    execute: (context: AiToolExecutionContext, value: unknown) =>
      input.execute(context, value as TInput),
  });
}

export function createAiToolRegistry(
  tools: readonly RegisteredAiTool[],
): AiToolRegistry {
  const byName = new Map<string, RegisteredAiTool>();
  for (const tool of tools) {
    validateToolDefinition(tool);
    if (byName.has(tool.name)) {
      throw new Error(`重复的 AI 工具名称: ${tool.name}`);
    }
    byName.set(tool.name, Object.freeze({ ...tool }));
  }
  return Object.freeze({
    list: () => [...byName.values()],
    find: (name: string) => byName.get(name),
  });
}

function validateToolDefinition(
  tool: Pick<
    RegisteredAiTool,
    "name" | "description" | "inputSchema" | "timeoutMs" | "requiredPermission"
  >,
): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(tool.name)) {
    throw new Error(`AI 工具名称无效: ${tool.name}`);
  }
  if (tool.description.trim().length === 0 || tool.description.length > 1000) {
    throw new Error(`AI 工具描述无效: ${tool.name}`);
  }
  if (
    !Number.isInteger(tool.timeoutMs) ||
    tool.timeoutMs < 100 ||
    tool.timeoutMs > 30_000
  ) {
    throw new Error(`AI 工具超时无效: ${tool.name}`);
  }
  if (
    tool.requiredPermission !== null &&
    !Object.values(PermissionKeys).includes(tool.requiredPermission)
  ) {
    throw new Error(`AI 工具权限无效: ${tool.name}`);
  }
  const schema = z.toJSONSchema(tool.inputSchema, { target: "draft-7" });
  if (schema.type !== "object") {
    throw new Error(`AI 工具参数必须是 object schema: ${tool.name}`);
  }
}
