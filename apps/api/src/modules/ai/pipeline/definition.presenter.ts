import type {
  PipelineDefinitionDetail,
  PipelineDefinitionStatus,
  PipelineDefinitionSummary,
  PipelineStepDefinition,
} from "@starter/contracts";
import {
  PIPELINE_MAX_STEPS,
  pipelineStepDefinitionSchema,
} from "@starter/contracts";
import { z } from "zod";

import { parseStoredJson } from "@api/shared/stored-json.js";

import type { AiPipelineDefinitionRecord } from "./definition.repository.js";

const stepsSchema = z
  .array(pipelineStepDefinitionSchema)
  .min(1)
  .max(PIPELINE_MAX_STEPS);

export function parsePipelineSteps(
  stepsJson: string,
): PipelineStepDefinition[] {
  return parseStoredJson({
    column: "ai_pipeline_definitions.steps_json",
    json: stepsJson,
    schema: stepsSchema,
  });
}

export function toPipelineDefinitionSummary(
  record: AiPipelineDefinitionRecord,
): PipelineDefinitionSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status as PipelineDefinitionStatus,
    revision: record.revision,
    stepCount: parsePipelineSteps(record.stepsJson).length,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toPipelineDefinitionDetail(
  record: AiPipelineDefinitionRecord,
): PipelineDefinitionDetail {
  return {
    ...toPipelineDefinitionSummary(record),
    steps: parsePipelineSteps(record.stepsJson),
  };
}
