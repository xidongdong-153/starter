import {
  anthropicMessagesCompatSchema,
  createCustomAiProviderSchema,
  customAiProviderDefinitionSchema,
  replaceCustomAiProviderModelsSchema,
  openAiCompletionsCompatSchema,
  openAiResponsesCompatSchema,
} from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  aiAgentDefinitions,
  aiEnabledModels,
  aiModelCatalogs,
  aiProviderConfigs,
  aiSettings,
  userAiPreferences,
} from "@api/infra/db/schema/index.js";
import {
  AiCustomProviderDefinitionInvalidError,
  AiCustomProviderExistsError,
  AiCustomProviderIdConflictError,
  AiCustomProviderRevisionConflictError,
  createAiCustomProviderRepository,
} from "@api/modules/ai/configuration/custom-provider.repository.js";

import { createTestApp, register } from "./helpers.js";

const model = {
  modelId: "local-chat",
  name: "Local Chat",
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  supportsImageInput: false,
  supportsReasoning: true,
  supportsTools: true,
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheWriteCost: 0,
};

function definition(providerId = "local-gateway") {
  return {
    providerId,
    name: "Local Gateway",
    protocol: "openai-completions" as const,
    baseUrl: "http://localhost:11434/v1/",
    compat: { supportsDeveloperRole: false },
    models: [model],
  };
}

it("custom Provider contracts 严格校验协议、compat、URL、模型和 secret 边界", () => {
  expect(customAiProviderDefinitionSchema.parse(definition())).toMatchObject({
    baseUrl: "http://localhost:11434/v1",
  });
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      protocol: "openai-responses",
      compat: { supportsToolSearch: true },
    }).success,
  ).toBe(true);
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      protocol: "anthropic-messages",
      compat: { supportsStrictTools: true },
    }).success,
  ).toBe(true);
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      apiKey: "must-not-enter-definition",
    }).success,
  ).toBe(false);
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      protocol: "unknown",
    }).success,
  ).toBe(false);
  expect(
    openAiCompletionsCompatSchema.safeParse({ unexpected: true }).success,
  ).toBe(false);
  expect(
    openAiResponsesCompatSchema.safeParse({ supportsToolSearch: true }).success,
  ).toBe(true);
  expect(
    anthropicMessagesCompatSchema.safeParse({ supportsStrictTools: true })
      .success,
  ).toBe(true);
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      baseUrl: "file:///tmp/provider",
    }).success,
  ).toBe(false);
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      baseUrl: "https://user:password@example.com/v1",
    }).success,
  ).toBe(false);
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      models: [model, model],
    }).success,
  ).toBe(false);
  expect(
    replaceCustomAiProviderModelsSchema.safeParse({
      expectedRevision: 1,
      models: [model, model],
    }).success,
  ).toBe(false);
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      models: Array.from({ length: 201 }, (_, index) => ({
        ...model,
        modelId: `model-${index}`,
      })),
    }).success,
  ).toBe(false);
  expect(
    customAiProviderDefinitionSchema.safeParse({
      ...definition(),
      models: [{ ...model, contextWindow: 10_000_001 }],
    }).success,
  ).toBe(false);

  const command = createCustomAiProviderSchema.parse({
    ...definition(),
    apiKey: "write-only-secret",
  });
  expect(command.apiKey).toBe("write-only-secret");
  expect(
    JSON.stringify(customAiProviderDefinitionSchema.parse(definition())),
  ).not.toContain("secret");
});

it("custom Provider repository 支持 CRUD、CAS、内置 ID 冲突和删除引用清理", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const actor = await register(app, "custom-provider-owner@example.com");
    const actorId = actor.user.id;
    const repository = createAiCustomProviderRepository(runtime.db, ["openai"]);
    const now = new Date();
    const created = repository.create({
      definition: definition(),
      actorId,
      now,
    });
    expect(created).toMatchObject({
      providerId: "local-gateway",
      definition: { ...definition(), baseUrl: "http://localhost:11434/v1" },
    });
    expect(created.definition.baseUrl).toBe("http://localhost:11434/v1");
    expect(repository.list()).toHaveLength(1);
    expect(repository.findById("local-gateway")?.definition.models).toEqual([
      model,
    ]);
    expect(() =>
      repository.create({ definition: definition(), actorId, now }),
    ).toThrow(AiCustomProviderExistsError);
    expect(() =>
      repository.create({ definition: definition("openai"), actorId, now }),
    ).toThrow(AiCustomProviderIdConflictError);
    expect(() =>
      repository.create({
        definition: { ...definition(), protocol: "bad" } as never,
        actorId,
        now,
      }),
    ).toThrow(AiCustomProviderDefinitionInvalidError);

    const updated = repository.update({
      definition: { ...definition(), name: "Updated Gateway" },
      expectedRevision: 1,
      actorId,
      now: new Date(now.getTime() + 1),
    });
    expect(updated).toMatchObject({
      revision: 2,
      definition: { name: "Updated Gateway" },
    });
    expect(() =>
      repository.update({
        definition: definition(),
        expectedRevision: 1,
        actorId,
        now,
      }),
    ).toThrow(AiCustomProviderRevisionConflictError);

    runtime.db
      .insert(aiProviderConfigs)
      .values({
        providerId: "local-gateway",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    runtime.db
      .insert(aiModelCatalogs)
      .values({
        providerId: "local-gateway",
        modelsJson: JSON.stringify([model]),
        updatedAt: now,
      })
      .run();
    runtime.db
      .insert(aiEnabledModels)
      .values({
        providerId: "local-gateway",
        modelId: model.modelId,
        enabledAt: now,
      })
      .run();
    runtime.db
      .insert(aiSettings)
      .values({
        id: "global",
        globalProviderId: "local-gateway",
        globalModelId: model.modelId,
        updatedAt: now,
      })
      .run();

    runtime.db
      .insert(userAiPreferences)
      .values({
        userId: actorId,
        providerId: "local-gateway",
        modelId: model.modelId,
        updatedAt: now,
      })
      .run();

    const references: { id: string; name: string }[] = [];
    expect(
      repository.delete({
        providerId: "local-gateway",
        expectedRevision: 2,
        actorId,
        now: new Date(),
        assertNoAgentReferences(found) {
          references.push(...found);
        },
      }),
    ).toBe(true);
    expect(references).toEqual([]);
    expect(repository.findById("local-gateway")).toBeUndefined();
    expect(
      runtime.db
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, "local-gateway"))
        .all(),
    ).toEqual([]);
    expect(
      runtime.db
        .select()
        .from(aiModelCatalogs)
        .where(eq(aiModelCatalogs.providerId, "local-gateway"))
        .all(),
    ).toEqual([]);
    expect(
      runtime.db
        .select()
        .from(aiEnabledModels)
        .where(eq(aiEnabledModels.providerId, "local-gateway"))
        .all(),
    ).toEqual([]);
    expect(
      runtime.db
        .select()
        .from(userAiPreferences)
        .where(eq(userAiPreferences.userId, actorId))
        .all(),
    ).toEqual([]);
    expect(
      runtime.db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.id, "global"))
        .get(),
    ).toMatchObject({ globalProviderId: null, globalModelId: null });

    runtime.database.sqlite.pragma("ignore_check_constraints = ON");
    runtime.database.sqlite
      .prepare(
        `INSERT INTO ai_custom_providers
          (provider_id, definition_json, revision, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`,
      )
      .run("broken-provider", "{", now.getTime(), now.getTime());
    runtime.database.sqlite.pragma("ignore_check_constraints = OFF");
    const brokenList = repository.list();
    expect(brokenList).toEqual([]);
    expect(() => repository.findById("broken-provider")).toThrow(
      AiCustomProviderDefinitionInvalidError,
    );
  } finally {
    cleanup();
  }
});

it("custom Provider 删除时 Agent 引用检查失败会回滚事务", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const actor = await register(app, "custom-provider-reference@example.com");
    const actorId = actor.user.id;
    const repository = createAiCustomProviderRepository(runtime.db, []);
    const now = new Date();
    repository.create({ definition: definition(), actorId, now });
    runtime.db
      .insert(aiAgentDefinitions)
      .values({
        id: "referencing-agent",
        name: "Referencing Agent",
        configJson: JSON.stringify({
          schemaVersion: 2,
          model: {
            providerId: "local-gateway",
            modelId: model.modelId,
          },
          systemPromptId: null,
          skillIds: [],
          toolRefs: [],
          thinkingLevel: "off",
          maxTurns: 8,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    runtime.db
      .insert(aiEnabledModels)
      .values({
        providerId: "local-gateway",
        modelId: model.modelId,
        enabledAt: now,
      })
      .run();

    expect(() =>
      repository.delete({
        providerId: "local-gateway",
        expectedRevision: 1,
        actorId,
        now,
        assertNoAgentReferences(references) {
          expect(references).toEqual([
            { id: "referencing-agent", name: "Referencing Agent" },
          ]);
          throw new Error("AI.CUSTOM_PROVIDER_IN_USE");
        },
      }),
    ).toThrow("AI.CUSTOM_PROVIDER_IN_USE");
    expect(repository.findById("local-gateway")).toBeDefined();
    expect(
      runtime.db
        .select()
        .from(aiEnabledModels)
        .where(eq(aiEnabledModels.providerId, "local-gateway"))
        .all(),
    ).toHaveLength(1);
  } finally {
    cleanup();
  }
});
