import type { Permission } from "@starter/contracts";
import { PermissionKeys } from "@starter/contracts";
import { z, type ZodType } from "zod";
import type {
  PrincipalContext,
  ResourceScope,
} from "@api/modules/ai/principal.js";

export interface AiToolExecutionContext {
  principal?: PrincipalContext;
  scope?: ResourceScope;
  userId: string;
  requestId: string;
  signal: AbortSignal;
  reportProgress?: (safeSummary: string) => void;
}

export interface AiToolResult {
  modelText: string;
  safeSummary: string | null;
}

export type AiToolScope = "platform" | { tenantId: string; projectId: string };

export interface AiToolDefinitionInput<TInput> {
  name: string;
  version?: string;
  description: string;
  inputSchema: ZodType<TInput>;
  timeoutMs: number;
  scope?: AiToolScope;
  requiredPermission: Permission | null;
  execute: (
    context: AiToolExecutionContext,
    input: TInput,
  ) => Promise<AiToolResult>;
}

export interface RegisteredAiTool {
  name: string;
  version: string;
  description: string;
  inputSchema: ZodType<unknown>;
  timeoutMs: number;
  scope: AiToolScope;
  requiredPermission: Permission | null;
  execute: (
    context: AiToolExecutionContext,
    input: unknown,
  ) => Promise<AiToolResult>;
}

export interface AiToolRegistry {
  list: () => readonly RegisteredAiTool[];
  find: (name: string, version?: string) => RegisteredAiTool | undefined;
}

export function defineAiTool<TInput>(
  input: AiToolDefinitionInput<TInput>,
): RegisteredAiTool {
  validateToolDefinition({
    ...input,
    version: input.version ?? "1.0.0",
    scope: input.scope ?? "platform",
  });
  return Object.freeze({
    name: input.name,
    version: input.version ?? "1.0.0",
    description: input.description,
    inputSchema: input.inputSchema as ZodType<unknown>,
    timeoutMs: input.timeoutMs,
    scope: input.scope ?? "platform",
    requiredPermission: input.requiredPermission,
    execute: (context: AiToolExecutionContext, value: unknown) =>
      input.execute(context, value as TInput),
  });
}

export function createAiToolRegistry(
  tools: readonly RegisteredAiTool[],
): AiToolRegistry {
  const byKey = new Map<string, RegisteredAiTool>();
  for (const tool of tools) {
    validateToolDefinition(tool);
    const key = `${tool.name}@${tool.version}`;
    if (byKey.has(key)) throw new Error(`重复的 AI 工具版本: ${key}`);
    byKey.set(key, Object.freeze({ ...tool }));
  }
  return Object.freeze({
    list: () => [...byKey.values()],
    find: (name: string, version?: string) => {
      if (version) return byKey.get(`${name}@${version}`);
      return [...byKey.values()].find((tool) => tool.name === name);
    },
  });
}

export function isAiToolAvailableInScope(
  tool: RegisteredAiTool,
  scope: ResourceScope,
): boolean {
  return (
    tool.scope === "platform" ||
    (tool.scope.tenantId === scope.tenantId &&
      tool.scope.projectId === scope.projectId)
  );
}

function validateToolDefinition(
  tool: Pick<
    RegisteredAiTool,
    | "name"
    | "version"
    | "description"
    | "inputSchema"
    | "timeoutMs"
    | "scope"
    | "requiredPermission"
  >,
): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(tool.name)) {
    throw new Error(`AI 工具名称无效: ${tool.name}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(tool.version)) {
    throw new Error(`AI 工具版本无效: ${tool.name}`);
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
    tool.scope !== "platform" &&
    (!tool.scope.tenantId || !tool.scope.projectId)
  ) {
    throw new Error(`AI 工具范围无效: ${tool.name}`);
  }
  if (
    tool.requiredPermission !== null &&
    !Object.values(PermissionKeys).includes(tool.requiredPermission)
  ) {
    throw new Error(`AI 工具权限无效: ${tool.name}`);
  }
  const schema = z.toJSONSchema(tool.inputSchema, { target: "draft-7" });
  if (schema.type !== "object")
    throw new Error(`AI 工具参数必须是 object schema: ${tool.name}`);
}
