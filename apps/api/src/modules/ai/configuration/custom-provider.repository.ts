import type { CustomAiProviderDefinition } from "@starter/contracts";
import { customAiProviderDefinitionSchema } from "@starter/contracts";
import { and, desc, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import { parseBoundedJson } from "@api/shared/bounded-json.js";

import {
  aiAgentDefinitions,
  aiCustomProviders,
  aiEnabledModels,
  aiModelCatalogs,
  aiProviderConfigs,
  aiSettings,
  userAiPreferences,
} from "../ai.schema.js";

type AiCustomProviderStorageRecord = typeof aiCustomProviders.$inferSelect;

export interface AiCustomProviderRecord extends Omit<
  AiCustomProviderStorageRecord,
  "definitionJson"
> {
  definition: CustomAiProviderDefinition;
}

export interface AiCustomProviderAgentReference {
  id: string;
  name: string;
}

export class AiCustomProviderExistsError extends Error {
  constructor() {
    super("Custom AI Provider already exists");
    this.name = "AiCustomProviderExistsError";
  }
}

export class AiCustomProviderIdConflictError extends Error {
  constructor() {
    super("Custom AI Provider ID conflicts with a built-in Provider");
    this.name = "AiCustomProviderIdConflictError";
  }
}

export class AiCustomProviderRevisionConflictError extends Error {
  constructor() {
    super("Custom AI Provider changed concurrently");
    this.name = "AiCustomProviderRevisionConflictError";
  }
}

export class AiCustomProviderDefinitionInvalidError extends Error {
  constructor(providerId: string, options?: ErrorOptions) {
    super(`Custom AI Provider definition is invalid: ${providerId}`, options);
    this.name = "AiCustomProviderDefinitionInvalidError";
  }
}

export interface AiCustomProviderRepository {
  create: (input: {
    definition: CustomAiProviderDefinition;
    actorId: string;
    now: Date;
  }) => AiCustomProviderRecord;
  list: () => AiCustomProviderRecord[];
  findById: (providerId: string) => AiCustomProviderRecord | undefined;
  update: (input: {
    definition: CustomAiProviderDefinition;
    expectedRevision: number;
    actorId: string;
    now: Date;
  }) => AiCustomProviderRecord | undefined;
  delete: (input: {
    providerId: string;
    expectedRevision: number;
    actorId: string;
    now: Date;
    assertNoAgentReferences: (
      references: readonly AiCustomProviderAgentReference[],
    ) => void;
  }) => boolean;
}

export function createAiCustomProviderRepository(
  db: AppDatabase,
  builtInProviderIds: ReadonlySet<string> | readonly string[],
): AiCustomProviderRepository {
  const reservedIds = new Set(builtInProviderIds);

  function create(input: {
    definition: CustomAiProviderDefinition;
    actorId: string;
    now: Date;
  }): AiCustomProviderRecord {
    const parsedDefinition = parseDefinition(
      input.definition.providerId,
      input.definition,
    );
    assertNotBuiltIn(parsedDefinition.providerId);
    if (findStorageById(parsedDefinition.providerId)) {
      throw new AiCustomProviderExistsError();
    }

    try {
      db.insert(aiCustomProviders)
        .values({
          providerId: parsedDefinition.providerId,
          definitionJson: JSON.stringify(parsedDefinition),
          revision: 1,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run();
    } catch (error) {
      if (isProviderIdConflict(error)) throw new AiCustomProviderExistsError();
      throw error;
    }

    return findById(parsedDefinition.providerId)!;
  }

  function list(): AiCustomProviderRecord[] {
    return db
      .select()
      .from(aiCustomProviders)
      .orderBy(desc(aiCustomProviders.updatedAt), aiCustomProviders.providerId)
      .all()
      .flatMap((row) => {
        try {
          return [toRecord(row)];
        } catch (error) {
          if (error instanceof AiCustomProviderDefinitionInvalidError)
            return [];
          throw error;
        }
      });
  }

  function findById(providerId: string): AiCustomProviderRecord | undefined {
    const row = findStorageById(providerId);
    return row ? toRecord(row) : undefined;
  }

  function update(input: {
    definition: CustomAiProviderDefinition;
    expectedRevision: number;
    actorId: string;
    now: Date;
  }): AiCustomProviderRecord | undefined {
    const providerId = input.definition.providerId;
    const parsedDefinition = parseDefinition(providerId, input.definition);
    assertNotBuiltIn(providerId);
    const result = db
      .update(aiCustomProviders)
      .set({
        definitionJson: JSON.stringify(parsedDefinition),
        revision: input.expectedRevision + 1,
        updatedBy: input.actorId,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(aiCustomProviders.providerId, providerId),
          eq(aiCustomProviders.revision, input.expectedRevision),
        ),
      )
      .run();
    if (result.changes === 0) {
      if (!findStorageById(providerId)) return undefined;
      throw new AiCustomProviderRevisionConflictError();
    }
    return findById(providerId);
  }

  function deleteProvider(input: {
    providerId: string;
    expectedRevision: number;
    actorId: string;
    now: Date;
    assertNoAgentReferences: (
      references: readonly AiCustomProviderAgentReference[],
    ) => void;
  }): boolean {
    assertNotBuiltIn(input.providerId);
    return db.transaction((tx) => {
      const current = tx
        .select({ revision: aiCustomProviders.revision })
        .from(aiCustomProviders)
        .where(eq(aiCustomProviders.providerId, input.providerId))
        .get();
      if (!current) return false;
      if (current.revision !== input.expectedRevision) {
        throw new AiCustomProviderRevisionConflictError();
      }

      const references = tx
        .select({ id: aiAgentDefinitions.id, name: aiAgentDefinitions.name })
        .from(aiAgentDefinitions)
        .where(
          sql`json_extract(${aiAgentDefinitions.configJson}, '$.model.providerId') = ${input.providerId}`,
        )
        .all();
      input.assertNoAgentReferences(references);

      tx.delete(aiEnabledModels)
        .where(eq(aiEnabledModels.providerId, input.providerId))
        .run();
      tx.update(aiSettings)
        .set({
          globalProviderId: null,
          globalModelId: null,
          updatedBy: input.actorId,
          updatedAt: input.now,
        })
        .where(eq(aiSettings.globalProviderId, input.providerId))
        .run();
      tx.delete(userAiPreferences)
        .where(eq(userAiPreferences.providerId, input.providerId))
        .run();
      tx.delete(aiModelCatalogs)
        .where(eq(aiModelCatalogs.providerId, input.providerId))
        .run();
      tx.delete(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, input.providerId))
        .run();
      tx.delete(aiCustomProviders)
        .where(
          and(
            eq(aiCustomProviders.providerId, input.providerId),
            eq(aiCustomProviders.revision, input.expectedRevision),
          ),
        )
        .run();
      return true;
    });
  }

  function findStorageById(
    providerId: string,
  ): AiCustomProviderStorageRecord | undefined {
    return db
      .select()
      .from(aiCustomProviders)
      .where(eq(aiCustomProviders.providerId, providerId))
      .get();
  }

  function assertNotBuiltIn(providerId: string): void {
    if (reservedIds.has(providerId)) {
      throw new AiCustomProviderIdConflictError();
    }
  }

  return { create, list, findById, update, delete: deleteProvider };
}

function isProviderIdConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("ai_custom_providers.provider_id") ||
      error.message.includes("UNIQUE constraint failed"))
  );
}

function parseDefinition(
  providerId: string,
  definition: unknown,
): CustomAiProviderDefinition {
  const parsed = customAiProviderDefinitionSchema.safeParse(definition);
  if (!parsed.success || parsed.data.providerId !== providerId) {
    throw new AiCustomProviderDefinitionInvalidError(providerId, {
      cause: parsed.success ? undefined : parsed.error,
    });
  }
  return parsed.data;
}

function toRecord(row: AiCustomProviderStorageRecord): AiCustomProviderRecord {
  let definition: unknown;
  try {
    definition = parseBoundedJson(row.definitionJson);
  } catch (error) {
    throw new AiCustomProviderDefinitionInvalidError(row.providerId, {
      cause: error,
    });
  }
  const parsedDefinition = parseDefinition(row.providerId, definition);
  const { definitionJson: _, ...record } = row;
  return { ...record, definition: parsedDefinition };
}
