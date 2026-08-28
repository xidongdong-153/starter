import type {
  CreatePipelineDefinitionInput,
  PipelineDefinitionDetail,
  PipelineDefinitionListQuery,
  PipelineDefinitionSummaryList,
  PipelineStepDefinition,
  UpdatePipelineDefinitionInput,
  UpdatePipelineDefinitionStatusInput,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";

import { AppError } from "@api/shared/app-error.js";
import { generateId } from "@api/shared/id.js";

import type { AiAgentDefinitionRepository } from "../agent/agent.repository.js";
import {
  AiPipelineDefinitionNameConflictError,
  AiPipelineDefinitionRevisionConflictError,
} from "./definition.repository.js";
import type {
  AiPipelineDefinitionRecord,
  AiPipelineDefinitionRepository,
} from "./definition.repository.js";
import {
  toPipelineDefinitionDetail,
  toPipelineDefinitionSummary,
} from "./definition.presenter.js";
import { validateStepTemplates } from "./template.js";

/** 并发修订冲突时的乐观重试次数，对齐 AgentDefinition service。 */
const MAX_UPDATE_ATTEMPTS = 3;

export interface AiPipelineDefinitionService {
  /** admin 列表返回 summary（含步骤数）；完整步骤定义看 getAdmin。 */
  listAdmin: (
    query: PipelineDefinitionListQuery,
  ) => PipelineDefinitionSummaryList;
  getAdmin: (id: string) => PipelineDefinitionDetail;
  /** 运行面启动校验：定义不存在或非 enabled 一律 404，不暴露存在性。 */
  getEnabled: (id: string) => PipelineDefinitionDetail;
  create: (
    input: CreatePipelineDefinitionInput,
    actorId: string,
  ) => Promise<PipelineDefinitionDetail>;
  update: (
    id: string,
    input: UpdatePipelineDefinitionInput,
    actorId: string,
  ) => Promise<PipelineDefinitionDetail>;
  updateStatus: (
    id: string,
    input: UpdatePipelineDefinitionStatusInput,
    actorId: string,
  ) => Promise<PipelineDefinitionDetail>;
}

export function createAiPipelineDefinitionService(input: {
  repository: AiPipelineDefinitionRepository;
  /** 仅用于校验步骤 agentId 存在（引用任何状态的 Agent 均可，enabled 在启动时校验）。 */
  agentRepository: AiAgentDefinitionRepository;
}): AiPipelineDefinitionService {
  const { repository, agentRepository } = input;

  function listAdmin(
    query: PipelineDefinitionListQuery,
  ): PipelineDefinitionSummaryList {
    const result = repository.list(query);
    return {
      items: result.items.map(toPipelineDefinitionSummary),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  function getAdmin(id: string): PipelineDefinitionDetail {
    return toPipelineDefinitionDetail(requireRecord(id));
  }

  function getEnabled(id: string): PipelineDefinitionDetail {
    const record = repository.findById(id);
    if (!record || record.status !== "enabled") throw notFound();
    return toPipelineDefinitionDetail(record);
  }

  async function create(
    input: CreatePipelineDefinitionInput,
    actorId: string,
  ): Promise<PipelineDefinitionDetail> {
    validateSteps(input.steps);
    try {
      const record = repository.create({
        id: generateId(),
        name: input.name,
        description: input.description ?? "",
        stepsJson: JSON.stringify(input.steps),
        createdBy: actorId,
        updatedBy: actorId,
        now: new Date(),
      });
      return toPipelineDefinitionDetail(record);
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
  }

  async function update(
    id: string,
    input: UpdatePipelineDefinitionInput,
    actorId: string,
  ): Promise<PipelineDefinitionDetail> {
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const current = requireRecord(id);
      if (input.steps !== undefined) validateSteps(input.steps);
      try {
        const record = repository.update({
          id,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.steps !== undefined
            ? { stepsJson: JSON.stringify(input.steps) }
            : {}),
          expectedRevision: current.revision,
          expectedStatus: current.status,
          revision: current.revision + 1,
          updatedBy: actorId,
          now: new Date(),
        });
        if (!record) throw notFound();
        return toPipelineDefinitionDetail(record);
      } catch (error) {
        if (error instanceof AiPipelineDefinitionRevisionConflictError) {
          if (attempt < MAX_UPDATE_ATTEMPTS - 1) continue;
          throw new AppError(
            ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
            "Pipeline 更新冲突，请重试",
            500,
          );
        }
        throw normalizeRepositoryError(error);
      }
    }

    throw new AppError(
      ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      "Pipeline 更新冲突，请重试",
      500,
    );
  }

  async function updateStatus(
    id: string,
    input: UpdatePipelineDefinitionStatusInput,
    actorId: string,
  ): Promise<PipelineDefinitionDetail> {
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const current = requireRecord(id);
      try {
        const record = repository.updateStatus({
          id,
          status: input.status,
          expectedRevision: current.revision,
          expectedStatus: current.status,
          revision: current.revision + 1,
          updatedBy: actorId,
          now: new Date(),
        });
        if (!record) throw notFound();
        return toPipelineDefinitionDetail(record);
      } catch (error) {
        if (error instanceof AiPipelineDefinitionRevisionConflictError) {
          if (attempt < MAX_UPDATE_ATTEMPTS - 1) continue;
          throw new AppError(
            ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
            "Pipeline 状态更新冲突，请重试",
            500,
          );
        }
        throw normalizeRepositoryError(error);
      }
    }

    throw new AppError(
      ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      "Pipeline 状态更新冲突，请重试",
      500,
    );
  }

  /** 步骤定义校验：模板静态校验 + 每步 agentId 必须指向已存在的 AgentDefinition。 */
  function validateSteps(steps: readonly PipelineStepDefinition[]): void {
    const issue = validateStepTemplates(steps);
    if (issue) {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        issue.allowedMaxIndex >= 0
          ? `步骤 ${issue.stepIndex} 的 inputTemplate 引用了 ${issue.variable}：只允许引用更早步骤的产出（最大序号 ${issue.allowedMaxIndex}）`
          : `步骤 ${issue.stepIndex} 的 inputTemplate 引用了 ${issue.variable}：第一个步骤没有可引用的前序步骤`,
        400,
      );
    }
    for (const [index, step] of steps.entries()) {
      if (!agentRepository.findById(step.agentId)) {
        throw new AppError(
          ApiErrorCodes.COMMON_INVALID_REQUEST,
          `步骤 ${index} 引用的 Agent 不存在`,
          400,
        );
      }
    }
  }

  function requireRecord(id: string): AiPipelineDefinitionRecord {
    const record = repository.findById(id);
    if (!record) throw notFound();
    return record;
  }

  function notFound(): AppError {
    return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "Pipeline 不存在", 404);
  }

  function normalizeRepositoryError(error: unknown): unknown {
    if (error instanceof AiPipelineDefinitionNameConflictError) {
      return new AppError(
        ApiErrorCodes.AI_PIPELINE_NAME_CONFLICT,
        "Pipeline 名称已存在",
        409,
      );
    }
    return error;
  }

  return {
    listAdmin,
    getAdmin,
    getEnabled,
    create,
    update,
    updateStatus,
  };
}
