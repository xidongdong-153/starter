import { and, desc, eq, sql } from "drizzle-orm";

import type { PipelineDefinitionStatus } from "@starter/contracts";

import type { AppDatabase } from "@api/infra/db/client.js";
import { aiPipelineDefinitions } from "@api/modules/ai/ai.schema.js";

export type AiPipelineDefinitionRecord =
  typeof aiPipelineDefinitions.$inferSelect;

export class AiPipelineDefinitionNameConflictError extends Error {
  constructor() {
    super("AI pipeline definition name already exists");
    this.name = "AiPipelineDefinitionNameConflictError";
  }
}

export class AiPipelineDefinitionRevisionConflictError extends Error {
  constructor() {
    super("AI pipeline definition changed concurrently");
    this.name = "AiPipelineDefinitionRevisionConflictError";
  }
}

export interface AiPipelineDefinitionListInput {
  status?: PipelineDefinitionStatus;
  page: number;
  pageSize: number;
}

export interface AiPipelineDefinitionListResult {
  items: AiPipelineDefinitionRecord[];
  total: number;
}

export interface AiPipelineDefinitionRepository {
  create: (input: {
    id: string;
    name: string;
    description: string;
    stepsJson: string;
    createdBy: string;
    updatedBy: string;
    now: Date;
  }) => AiPipelineDefinitionRecord;
  findById: (id: string) => AiPipelineDefinitionRecord | undefined;
  list: (
    input: AiPipelineDefinitionListInput,
  ) => AiPipelineDefinitionListResult;
  update: (input: {
    id: string;
    name?: string;
    description?: string;
    stepsJson?: string;
    expectedRevision: number;
    expectedStatus: string;
    revision: number;
    updatedBy: string;
    now: Date;
  }) => AiPipelineDefinitionRecord | undefined;
  updateStatus: (input: {
    id: string;
    status: PipelineDefinitionStatus;
    expectedRevision: number;
    expectedStatus: string;
    revision: number;
    updatedBy: string;
    now: Date;
  }) => AiPipelineDefinitionRecord | undefined;
}

export function createAiPipelineDefinitionRepository(
  db: AppDatabase,
): AiPipelineDefinitionRepository {
  function create(input: {
    id: string;
    name: string;
    description: string;
    stepsJson: string;
    createdBy: string;
    updatedBy: string;
    now: Date;
  }): AiPipelineDefinitionRecord {
    try {
      db.insert(aiPipelineDefinitions)
        .values({
          id: input.id,
          name: input.name,
          description: input.description,
          status: "draft",
          revision: 1,
          stepsJson: input.stepsJson,
          createdBy: input.createdBy,
          updatedBy: input.updatedBy,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run();
    } catch (error) {
      if (isNameConflict(error)) {
        throw new AiPipelineDefinitionNameConflictError();
      }
      throw error;
    }

    return findById(input.id)!;
  }

  function findById(id: string): AiPipelineDefinitionRecord | undefined {
    return db
      .select()
      .from(aiPipelineDefinitions)
      .where(eq(aiPipelineDefinitions.id, id))
      .get();
  }

  function list(
    input: AiPipelineDefinitionListInput,
  ): AiPipelineDefinitionListResult {
    const condition = input.status
      ? eq(aiPipelineDefinitions.status, input.status)
      : undefined;
    const countRow = db
      .select({ count: sql<number>`count(*)` })
      .from(aiPipelineDefinitions)
      .where(condition)
      .get();
    const total = countRow ? countRow.count : 0;
    const items = db
      .select()
      .from(aiPipelineDefinitions)
      .where(condition)
      .orderBy(
        desc(aiPipelineDefinitions.updatedAt),
        desc(aiPipelineDefinitions.id),
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .all();

    return { items, total };
  }

  function update(input: {
    id: string;
    name?: string;
    description?: string;
    stepsJson?: string;
    expectedRevision: number;
    expectedStatus: string;
    revision: number;
    updatedBy: string;
    now: Date;
  }): AiPipelineDefinitionRecord | undefined {
    try {
      const result = db
        .update(aiPipelineDefinitions)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.stepsJson !== undefined
            ? { stepsJson: input.stepsJson }
            : {}),
          revision: input.revision,
          updatedBy: input.updatedBy,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(aiPipelineDefinitions.id, input.id),
            eq(aiPipelineDefinitions.revision, input.expectedRevision),
            eq(aiPipelineDefinitions.status, input.expectedStatus),
          ),
        )
        .run();
      if (result.changes === 0) {
        if (!findById(input.id)) return undefined;
        throw new AiPipelineDefinitionRevisionConflictError();
      }
    } catch (error) {
      if (isNameConflict(error)) {
        throw new AiPipelineDefinitionNameConflictError();
      }
      throw error;
    }

    return findById(input.id);
  }

  function updateStatus(input: {
    id: string;
    status: PipelineDefinitionStatus;
    expectedRevision: number;
    expectedStatus: string;
    revision: number;
    updatedBy: string;
    now: Date;
  }): AiPipelineDefinitionRecord | undefined {
    const result = db
      .update(aiPipelineDefinitions)
      .set({
        status: input.status,
        revision: input.revision,
        updatedBy: input.updatedBy,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(aiPipelineDefinitions.id, input.id),
          eq(aiPipelineDefinitions.revision, input.expectedRevision),
          eq(aiPipelineDefinitions.status, input.expectedStatus),
        ),
      )
      .run();
    if (result.changes === 0) {
      if (!findById(input.id)) return undefined;
      throw new AiPipelineDefinitionRevisionConflictError();
    }
    return findById(input.id);
  }

  return { create, findById, list, update, updateStatus };
}

function isNameConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("ai_pipeline_definitions.name")
  );
}
