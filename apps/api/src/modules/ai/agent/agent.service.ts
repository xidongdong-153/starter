import type {
  AgentDefinitionConfig,
  AgentDefinitionDetail,
  AgentDefinitionListQuery,
  AgentDefinitionSummary,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
  UpdateAgentDefinitionStatusInput,
} from "@starter/contracts";
import {
  agentDefinitionConfigSchema,
  ApiErrorCodes,
  defaultAgentDefinitionConfig,
} from "@starter/contracts";

import type { RuntimeAccessContext } from "../principal.js";
import type {
  AiToolRegistry,
  RegisteredAiTool,
} from "../tool/tool-registry.js";
import { isAiToolAvailableInScope } from "../tool/tool-registry.js";
import type { AiPromptService } from "../prompt/prompt.service.js";
import type {
  AiSkillRecord,
  AiSkillRepository,
} from "../skill/skill.repository.js";
import { AppError } from "@api/shared/app-error.js";
import { generateId } from "@api/shared/id.js";

import { AiAgentDefinitionRevisionConflictError } from "./agent.repository.js";
import type {
  AiAgentDefinitionRecord,
  AiAgentDefinitionRepository,
} from "./agent.repository.js";
import {
  parseAgentDefinitionConfig,
  toAgentDefinitionDetail,
  toAgentDefinitionSummary,
} from "./agent.presenter.js";

export interface ResolvedAgentDefinition {
  id: string;
  revision: number;
  config: AgentDefinitionConfig;
  model: NonNullable<AgentDefinitionConfig["model"]>;
  systemPrompt: string;
  skills: Array<Pick<AiSkillRecord, "id" | "name" | "description">>;
  tools: RegisteredAiTool[];
  thinkingLevel: AgentDefinitionConfig["thinkingLevel"];
  maxTurns: number;
}

export interface AiAgentDefinitionService {
  listPublic: (query: AgentDefinitionListQuery) => {
    items: AgentDefinitionSummary[];
    total: number;
    page: number;
    pageSize: number;
  };
  getPublic: (id: string) => AgentDefinitionSummary;
  listAdmin: (query: AgentDefinitionListQuery) => {
    items: AgentDefinitionDetail[];
    total: number;
    page: number;
    pageSize: number;
  };
  getAdmin: (id: string) => AgentDefinitionDetail;
  create: (
    input: CreateAgentDefinitionInput,
    actorId: string,
  ) => Promise<AgentDefinitionDetail>;
  update: (
    id: string,
    input: UpdateAgentDefinitionInput,
    actorId: string,
  ) => Promise<AgentDefinitionDetail>;
  updateStatus: (
    id: string,
    input: UpdateAgentDefinitionStatusInput,
    actorId: string,
  ) => Promise<AgentDefinitionDetail>;
  resolve: (
    id: string,
    access: RuntimeAccessContext,
  ) => Promise<ResolvedAgentDefinition>;
  listTools: () => Array<{
    name: string;
    version: string;
    description: string;
    scope: "platform" | { tenantId: string; projectId: string };
  }>;
}

export function createAiAgentDefinitionService(input: {
  repository: AiAgentDefinitionRepository;
  resolveModel: (
    model: NonNullable<AgentDefinitionConfig["model"]>,
  ) => Promise<NonNullable<AgentDefinitionConfig["model"]>>;
  promptService: AiPromptService;
  skillRepository: AiSkillRepository;
  toolRegistry: AiToolRegistry;
}): AiAgentDefinitionService {
  const {
    repository,
    resolveModel,
    promptService,
    skillRepository,
    toolRegistry,
  } = input;

  function listPublic(query: AgentDefinitionListQuery) {
    const result = repository.list({ ...query, status: "enabled" });
    return {
      items: result.items.map(toAgentDefinitionSummary),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  function getPublic(id: string): AgentDefinitionSummary {
    const record = requireRecord(id);
    if (record.status !== "enabled") throw notFound();
    return toAgentDefinitionSummary(record);
  }

  function listAdmin(query: AgentDefinitionListQuery) {
    const result = repository.list(query);
    return {
      items: result.items.map(toAgentDefinitionDetail),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  function getAdmin(id: string): AgentDefinitionDetail {
    return toAgentDefinitionDetail(requireRecord(id));
  }

  async function create(
    input: CreateAgentDefinitionInput,
    actorId: string,
  ): Promise<AgentDefinitionDetail> {
    const config = normalizeConfig(
      input.config ?? defaultAgentDefinitionConfig,
    );
    await validateConfig(config, false);
    try {
      const record = repository.create({
        id: generateId(),
        name: input.name,
        description: input.description ?? "",
        configJson: JSON.stringify(config),
        createdBy: actorId,
        updatedBy: actorId,
        now: new Date(),
      });
      return toAgentDefinitionDetail(record);
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
  }

  async function update(
    id: string,
    input: UpdateAgentDefinitionInput,
    actorId: string,
  ): Promise<AgentDefinitionDetail> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = requireRecord(id);
      const currentConfig = parseAgentDefinitionConfig(current.configJson);
      const nextConfig = input.config
        ? normalizeConfig(input.config)
        : currentConfig;
      const configChanged = !sameConfig(currentConfig, nextConfig);
      if (input.config && configChanged)
        await validateConfig(nextConfig, current.status === "enabled");

      try {
        const record = repository.update({
          id,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(configChanged ? { configJson: JSON.stringify(nextConfig) } : {}),
          expectedRevision: current.revision,
          expectedStatus: current.status,
          revision: current.revision + (configChanged ? 1 : 0),
          updatedBy: actorId,
          now: new Date(),
        });
        if (!record) throw notFound();
        return toAgentDefinitionDetail(record);
      } catch (error) {
        if (error instanceof AiAgentDefinitionRevisionConflictError) {
          if (attempt < 2) continue;
          throw new AppError(
            ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
            "Agent 更新冲突，请重试",
            500,
          );
        }
        throw normalizeRepositoryError(error);
      }
    }

    throw new AppError(
      ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      "Agent 更新冲突，请重试",
      500,
    );
  }

  async function updateStatus(
    id: string,
    input: UpdateAgentDefinitionStatusInput,
    actorId: string,
  ): Promise<AgentDefinitionDetail> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = requireRecord(id);
      if (input.status === "enabled") {
        await validateConfig(
          parseAgentDefinitionConfig(current.configJson),
          true,
        );
      }
      try {
        const record = repository.updateStatus({
          id,
          status: input.status,
          expectedRevision: current.revision,
          expectedStatus: current.status,
          updatedBy: actorId,
          now: new Date(),
        });
        if (!record) throw notFound();
        return toAgentDefinitionDetail(record);
      } catch (error) {
        if (error instanceof AiAgentDefinitionRevisionConflictError) {
          if (attempt < 2) continue;
          throw new AppError(
            ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
            "Agent 状态更新冲突，请重试",
            500,
          );
        }
        throw error;
      }
    }

    throw new AppError(
      ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      "Agent 状态更新冲突，请重试",
      500,
    );
  }

  async function resolve(
    id: string,
    access: RuntimeAccessContext,
  ): Promise<ResolvedAgentDefinition> {
    const record = requireRecord(id);
    if (record.status !== "enabled") {
      throw new AppError(
        ApiErrorCodes.AI_AGENT_NOT_ENABLED,
        "Agent 当前未启用",
        409,
      );
    }
    const config = parseAgentDefinitionConfig(record.configJson);
    await validateConfig(config, true);
    const model = config.model;
    const systemPromptId = config.systemPromptId;
    if (!model || !systemPromptId) throw invalidConfig();
    const systemPrompt =
      promptService.resolveSystemPromptContent(systemPromptId);
    if (!systemPrompt) throw invalidConfig();
    const skills = config.skillIds.map((id) => {
      const skill = skillRepository.findSkillById(id);
      if (!skill || !skill.enabled) throw invalidConfig();
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
      };
    });
    const tools = config.toolNames.map((name) => {
      const tool = toolRegistry.find(name);
      if (!tool || !isAiToolAvailableInScope(tool, access.scope)) {
        throw invalidConfig("tool");
      }
      return tool;
    });

    return {
      id: record.id,
      revision: record.revision,
      config,
      model,
      systemPrompt,
      skills,
      tools,
      thinkingLevel: config.thinkingLevel,
      maxTurns: config.maxTurns,
    };
  }

  async function validateConfig(
    config: AgentDefinitionConfig,
    requireExecutable: boolean,
  ): Promise<void> {
    if (config.model) {
      try {
        await resolveModel(config.model);
      } catch (error) {
        if (error instanceof AppError) throw invalidConfig("model");
        throw error;
      }
    } else if (requireExecutable) {
      throw invalidConfig("model");
    }

    if (config.systemPromptId) {
      try {
        promptService.assertSystemPromptAvailable(config.systemPromptId);
      } catch (error) {
        if (error instanceof AppError) throw invalidConfig("systemPrompt");
        throw error;
      }
    } else if (requireExecutable) {
      throw invalidConfig("systemPrompt");
    }

    for (const skillId of config.skillIds) {
      const skill = skillRepository.findSkillById(skillId);
      if (!skill || !skill.enabled) throw invalidConfig("skill");
    }
    for (const toolName of config.toolNames) {
      if (!toolRegistry.list().some((tool) => tool.name === toolName)) {
        throw invalidConfig("tool");
      }
    }
  }

  function requireRecord(id: string): AiAgentDefinitionRecord {
    const record = repository.findById(id);
    if (!record) throw notFound();
    return record;
  }

  function listTools(): Array<{
    name: string;
    version: string;
    description: string;
    scope: "platform" | { tenantId: string; projectId: string };
  }> {
    return toolRegistry.list().map(({ name, version, description, scope }) => ({
      name,
      version,
      description,
      scope,
    }));
  }

  return {
    listPublic,
    getPublic,
    listAdmin,
    getAdmin,
    create,
    update,
    updateStatus,
    resolve,
    listTools,
  };
}

function normalizeConfig(config: AgentDefinitionConfig): AgentDefinitionConfig {
  const parsed = agentDefinitionConfigSchema.safeParse(config);
  if (!parsed.success) throw invalidConfig();
  return {
    ...parsed.data,
    skillIds: [...parsed.data.skillIds].sort(),
    toolNames: [...parsed.data.toolNames].sort(),
  };
}

function sameConfig(
  left: AgentDefinitionConfig,
  right: AgentDefinitionConfig,
): boolean {
  const normalizedLeft = normalizeConfig(left);
  const normalizedRight = normalizeConfig(right);
  const modelsEqual =
    normalizedLeft.model === null || normalizedRight.model === null
      ? normalizedLeft.model === normalizedRight.model
      : normalizedLeft.model.providerId === normalizedRight.model.providerId &&
        normalizedLeft.model.modelId === normalizedRight.model.modelId;

  return (
    normalizedLeft.schemaVersion === normalizedRight.schemaVersion &&
    modelsEqual &&
    normalizedLeft.systemPromptId === normalizedRight.systemPromptId &&
    sameStringArray(normalizedLeft.skillIds, normalizedRight.skillIds) &&
    sameStringArray(normalizedLeft.toolNames, normalizedRight.toolNames) &&
    normalizedLeft.thinkingLevel === normalizedRight.thinkingLevel &&
    normalizedLeft.maxTurns === normalizedRight.maxTurns
  );
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function invalidConfig(resource?: string): AppError {
  return new AppError(
    ApiErrorCodes.AI_AGENT_CONFIG_INVALID,
    "Agent 配置引用无效或资源未启用",
    400,
    resource ? { resource } : undefined,
  );
}

function notFound(): AppError {
  return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "Agent 不存在", 404);
}

function normalizeRepositoryError(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AiAgentDefinitionNameConflictError"
  ) {
    return new AppError(
      ApiErrorCodes.AI_AGENT_NAME_CONFLICT,
      "Agent 名称已存在",
      409,
    );
  }
  return error;
}
