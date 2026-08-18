import type {
  AgentDefinitionConfig,
  AgentDefinitionDetail,
  AgentDefinitionSummary,
} from "@starter/contracts";
import { agentDefinitionConfigSchema, ApiErrorCodes } from "@starter/contracts";

import type { AiAgentDefinitionRecord } from "./agent.repository.js";
import { AppError } from "@api/shared/app-error.js";

export function toAgentDefinitionSummary(
  record: AiAgentDefinitionRecord,
): AgentDefinitionSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: toStatus(record.status),
    revision: record.revision,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toAgentDefinitionDetail(
  record: AiAgentDefinitionRecord,
): AgentDefinitionDetail {
  return {
    ...toAgentDefinitionSummary(record),
    config: parseAgentDefinitionConfig(record.configJson),
  };
}

export function parseAgentDefinitionConfig(
  configJson: string,
): AgentDefinitionConfig {
  let value: unknown;
  try {
    value = JSON.parse(configJson) as unknown;
  } catch {
    throw invalidStoredConfig();
  }

  const parsed = agentDefinitionConfigSchema.safeParse(value);
  if (!parsed.success) throw invalidStoredConfig();
  return parsed.data;
}

function toStatus(value: string): AgentDefinitionSummary["status"] {
  if (value === "draft" || value === "enabled" || value === "disabled") {
    return value;
  }
  throw invalidStoredConfig();
}

function invalidStoredConfig(): AppError {
  return new AppError(
    ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
    "Agent 配置数据无效",
    500,
  );
}
