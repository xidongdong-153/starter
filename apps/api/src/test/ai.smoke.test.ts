import type { AddressInfo } from "node:net";
import { createServer } from "node:http";

import type {
  AdminAiModelsResponse,
  AdminAiProvider,
  AiTestStreamEvent,
  AiUserModel,
  AiUserPreference,
} from "@starter/contracts";
import { aiTestStreamEventSchema, ApiErrorCodes } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import type { AiGateway } from "@api/infra/ai/index.js";
import {
  AiGatewayError,
  createAiCrypto,
  createAiRuntime,
} from "@api/infra/ai/index.js";
import {
  aiEnabledModels,
  aiModelCalls,
  aiProviderConfigs,
  aiSettings,
} from "@api/infra/db/schema/index.js";
import { parseEnv } from "@api/shared/env.js";
import { createAuthorizationRepository } from "@api/modules/authorization/index.js";

import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

const systemContext = {
  actorType: "system",
  actorId: "test:ai",
  requestId: null,
} as const;

function parseAiTestStream(body: string): AiTestStreamEvent[] {
  return body
    .trim()
    .split(/\r?\n\r?\n/)
    .map((frame) => {
      const lines = frame.split(/\r?\n/);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^event: /);
      expect(lines[1]).toMatch(/^data: /);

      const eventName = lines[0]?.slice("event: ".length);
      const data = lines[1]?.slice("data: ".length) ?? "";
      const event = aiTestStreamEventSchema.parse(JSON.parse(data) as unknown);
      expect(event.type).toBe(eventName);
      return event;
    });
}

const fakeGateway: AiGateway = {
  async *stream(input) {
    const firstMessage = input.messages[0];
    const firstBlock =
      firstMessage?.role === "user" ? firstMessage.content[0] : undefined;
    const prompt = firstBlock?.type === "text" ? firstBlock.text : undefined;
    if (prompt === "timeout") throw new AiGatewayError("timeout");
    if (prompt === "auth") throw new AiGatewayError("auth");
    if (prompt === "upstream") throw new AiGatewayError("upstream");
    if (prompt === "aborted") throw new AiGatewayError("aborted");
    if (prompt === "tool_use") {
      yield {
        type: "tool_call_completed",
        id: "unexpected-call",
        name: "unexpected_tool",
        arguments: { value: "must not leak" },
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      yield {
        type: "completed",
        turnIndex: input.turnIndex,
        assistantMessage: {
          role: "assistant",
          blocks: [
            {
              type: "tool_call",
              id: "unexpected-call",
              name: "unexpected_tool",
              arguments: { value: "must not leak" },
              turnIndex: input.turnIndex,
              contentIndex: 0,
              blockId: `${input.turnIndex}:0`,
            },
          ],
        },
        stopReason: "tool_use",
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: null,
          reasoningTokens: null,
          totalTokens: 5,
        },
        cost: null,
      };
      return;
    }
    yield {
      type: "text_delta",
      text: "fake answer",
      turnIndex: input.turnIndex,
      contentIndex: 0,
      blockId: `${input.turnIndex}:0`,
    };
    yield {
      type: "completed",
      turnIndex: input.turnIndex,
      assistantMessage: {
        role: "assistant",
        blocks: [
          {
            type: "text",
            text: "fake answer",
            turnIndex: input.turnIndex,
            contentIndex: 0,
            blockId: `${input.turnIndex}:0`,
          },
        ],
      },
      stopReason: "stop",
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        totalTokens: 5,
      },
      cost: null,
    };
  },
};

const expectedProviderIds = [
  "amazon-bedrock",
  "ant-ling",
  "anthropic",
  "azure-openai-responses",
  "baseten",
  "cerebras",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "deepseek",
  "fireworks",
  "github-copilot",
  "google",
  "google-vertex",
  "groq",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
  "mistral",
  "moonshotai",
  "moonshotai-cn",
  "nvidia",
  "openai",
  "openai-codex",
  "opencode",
  "opencode-go",
  "openrouter",
  "qwen-token-plan",
  "qwen-token-plan-cn",
  "qwen-token-plan-individual",
  "radius",
  "together",
  "vercel-ai-gateway",
  "xai",
  "xiaomi",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-sgp",
  "zai",
  "zai-coding-cn",
] as const;

it("拒绝非规范 base64 的 AI 凭据主密钥", () => {
  expect(() =>
    parseEnv({
      BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
      AI_CREDENTIAL_ENCRYPTION_KEY:
        "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=ignored",
    }),
  ).toThrow("AI_CREDENTIAL_ENCRYPTION_KEY");
});

it("custom Provider check 将认证失败和上游失败映射为不同安全错误码", async () => {
  let status = 500;
  const upstream = await startCheckServer(() => status);
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "custom-check-admin@example.com");
    expect(
      createAuthorizationRepository(runtime.db).bootstrapAdminByEmail(
        "custom-check-admin@example.com",
        systemContext,
      ).kind,
    ).toBe("ok");

    const createResponse = await app.request("/api/ai/admin/custom-providers", {
      method: "POST",
      headers: { cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "custom-check-provider",
        name: "Custom Check Provider",
        protocol: "openai-completions",
        baseUrl: upstream.url,
        compat: {},
        models: [
          {
            modelId: "check-model",
            name: "Check Model",
            contextWindow: 8_000,
            maxOutputTokens: 1_024,
            supportsImageInput: false,
            supportsReasoning: false,
            supportsTools: false,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
          },
        ],
        apiKey: "custom-check-secret",
      }),
    });
    expect(createResponse.status).toBe(200);
    const created = await readSuccess<{ revision: number }>(createResponse);

    const upstreamFailure = await app.request(
      "/api/ai/admin/custom-providers/custom-check-provider/check",
      {
        method: "POST",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: created.data.revision }),
      },
    );
    expect(upstreamFailure.status).toBe(503);
    expect((await readFailure(upstreamFailure)).error.code).toBe(
      ApiErrorCodes.AI_CUSTOM_PROVIDER_CHECK_FAILED,
    );

    status = 401;
    const authFailure = await app.request(
      "/api/ai/admin/custom-providers/custom-check-provider/check",
      {
        method: "POST",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: created.data.revision }),
      },
    );
    expect(authFailure.status).toBe(503);
    expect((await readFailure(authFailure)).error.code).toBe(
      ApiErrorCodes.AI_PROVIDER_AUTH_FAILED,
    );
  } finally {
    cleanup();
    await upstream.close();
  }
});

async function startCheckServer(
  getStatus: () => number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(getStatus(), { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "check-upstream-secret" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

it("固定 Provider registry 精确覆盖 pi-ai 0.84.1 的 40 个文本 Provider", () => {
  const { cleanup, runtime } = createTestApp();
  try {
    expect(runtime.ai.providers.map((provider) => provider.id).sort()).toEqual(
      [...expectedProviderIds].sort(),
    );
  } finally {
    cleanup();
  }
});

it("自定义 Provider 创建失败时不保留 definition", async () => {
  const { app, cleanup, runtime } = createTestApp({
    AI_CREDENTIAL_ENCRYPTION_KEY: "",
  });
  try {
    const admin = await register(app, "custom-provider-admin@example.com");
    expect(
      createAuthorizationRepository(runtime.db).bootstrapAdminByEmail(
        "custom-provider-admin@example.com",
        systemContext,
      ).kind,
    ).toBe("ok");

    const response = await app.request("/api/ai/admin/custom-providers", {
      method: "POST",
      headers: { cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "rollback-provider",
        name: "Rollback Provider",
        protocol: "openai-completions",
        baseUrl: "http://localhost:11434/v1",
        compat: {},
        models: [
          {
            modelId: "rollback-model",
            name: "Rollback Model",
            contextWindow: 32_000,
            maxOutputTokens: 4_000,
            supportsImageInput: false,
            supportsReasoning: false,
            supportsTools: false,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
          },
        ],
        apiKey: "secret-that-must-not-persist",
      }),
    });
    expect(response.status).toBe(503);
    expect((await readFailure(response)).error.code).toBe(
      ApiErrorCodes.AI_CREDENTIAL_KEY_UNAVAILABLE,
    );

    const read = await app.request(
      "/api/ai/admin/custom-providers/rollback-provider",
      { headers: { cookie: admin.cookie } },
    );
    expect(read.status).toBe(404);
  } finally {
    cleanup();
  }
});

it("缺少主密钥时已有密文 Provider 进入 error 并被停用", async () => {
  const { cleanup, runtime } = createTestApp();
  try {
    const crypto = createAiCrypto(
      "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    );
    const encrypted = crypto.encrypt({
      credential: { type: "api_key", key: "stored-secret" },
      runtimeSettings: {},
    });
    const now = new Date();
    runtime.db
      .insert(aiProviderConfigs)
      .values({
        providerId: "openai",
        enabled: true,
        credentialType: "api_key",
        credentialHint: "****cret",
        ...encrypted,
        rowVersion: 1,
        configRevision: 1,
        checkedConfigRevision: 1,
        authStatus: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    runtime.db
      .insert(aiSettings)
      .values({
        id: "global",
        globalProviderId: "openai",
        globalModelId: runtime.ai.listModels("openai")[0]!.modelId,
        updatedAt: now,
      })
      .run();

    const lockedRuntime = createAiRuntime(
      runtime.db,
      createAiCrypto(undefined),
    );
    await lockedRuntime.ensureReady();
    expect(
      runtime.db
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, "openai"))
        .get(),
    ).toMatchObject({
      enabled: false,
      authStatus: "error",
      lastCheckErrorCode: "credential_key_unavailable",
    });
    expect(lockedRuntime.listAvailableModels("openai")).toEqual([]);
    expect(
      runtime.db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.id, "global"))
        .get(),
    ).toMatchObject({ globalProviderId: null, globalModelId: null });
  } finally {
    cleanup();
  }
});

it("credential 限制会过滤 GitHub Copilot 的可用模型", async () => {
  const { cleanup, runtime } = createTestApp();
  try {
    const catalog = runtime.ai.listModels("github-copilot");
    expect(catalog.length).toBeGreaterThan(1);
    const allowedModelId = catalog[0]!.modelId;
    const crypto = createAiCrypto(
      "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    );
    const encrypted = crypto.encrypt({
      credential: {
        type: "oauth",
        access: "oauth-access",
        refresh: "oauth-refresh",
        expires: Date.now() + 60_000,
        availableModelIds: [allowedModelId],
      },
      runtimeSettings: {},
    });
    const now = new Date();
    runtime.db
      .insert(aiProviderConfigs)
      .values({
        providerId: "github-copilot",
        enabled: true,
        credentialType: "oauth",
        ...encrypted,
        rowVersion: 1,
        configRevision: 1,
        checkedConfigRevision: 1,
        authStatus: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const filteredRuntime = createAiRuntime(runtime.db, crypto);
    await filteredRuntime.ensureReady();
    expect(filteredRuntime.listModels("github-copilot").length).toBe(
      catalog.length,
    );
    expect(filteredRuntime.listAvailableModels("github-copilot")).toEqual([
      expect.objectContaining({ modelId: allowedModelId }),
    ]);
  } finally {
    cleanup();
  }
});

it("custom Provider 模型测试复用统一 SSE 和 model_test 审计", async () => {
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: fakeGateway },
  );
  try {
    const admin = await register(app, "custom-model-test-admin@example.com");
    const user = await register(app, "custom-model-test-user@example.com");
    expect(
      createAuthorizationRepository(runtime.db).bootstrapAdminByEmail(
        "custom-model-test-admin@example.com",
        systemContext,
      ).kind,
    ).toBe("ok");

    const providerId = "custom-model-test";
    const modelId = "custom-chat";
    const created = await app.request("/api/ai/admin/custom-providers", {
      method: "POST",
      headers: { cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId,
        name: "Custom Model Test",
        protocol: "openai-completions",
        baseUrl: "http://localhost:11434/v1",
        compat: {},
        models: [
          {
            modelId,
            name: "Custom Chat",
            contextWindow: 8_000,
            maxOutputTokens: 1_024,
            supportsImageInput: false,
            supportsReasoning: false,
            supportsTools: false,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
          },
        ],
        apiKey: "custom-model-test-secret",
      }),
    });
    expect(created.status).toBe(200);

    const config = runtime.db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.providerId, providerId))
      .get()!;
    runtime.db
      .update(aiProviderConfigs)
      .set({
        enabled: true,
        authStatus: "ready",
        authSource: "stored_api_key",
        checkedConfigRevision: config.configRevision,
      })
      .where(eq(aiProviderConfigs.providerId, providerId))
      .run();
    runtime.db
      .insert(aiEnabledModels)
      .values({ providerId, modelId, enabledAt: new Date() })
      .run();

    const response = await app.request("/api/ai/test", {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: { providerId, modelId },
        prompt: "custom model prompt",
      }),
    });
    expect(response.status).toBe(200);
    const events = parseAiTestStream(await response.text());
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_delta",
      "done",
    ]);
    expect(events[0]).toMatchObject({
      model: { providerId, modelId },
    });

    const calls = runtime.db.select().from(aiModelCalls).all();
    expect(calls).toEqual([
      expect.objectContaining({
        scenario: "model_test",
        providerId,
        modelId,
        result: "succeeded",
      }),
    ]);
    expect(JSON.stringify(calls)).not.toContain("custom model prompt");
    expect(JSON.stringify(calls)).not.toContain("custom-model-test-secret");
  } finally {
    cleanup();
  }
});

it("配置、模型白名单、用户偏好和 SSE 使用同一套 AI 服务端规则", async () => {
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: fakeGateway },
  );
  try {
    const admin = await register(app, "ai-admin@example.com");
    const user = await register(app, "ai-user@example.com");
    const authorization = createAuthorizationRepository(runtime.db);
    expect(
      authorization.bootstrapAdminByEmail("ai-admin@example.com", systemContext)
        .kind,
    ).toBe("ok");

    const anonymous = await app.request("/api/ai/admin/providers");
    expect(anonymous.status).toBe(401);

    const denied = await app.request("/api/ai/admin/providers", {
      headers: { cookie: user.cookie },
    });
    expect(denied.status).toBe(403);
    expect((await readFailure(denied)).error.code).toBe(
      ApiErrorCodes.AUTH_FORBIDDEN,
    );

    const deniedConfig = await app.request(
      "/api/ai/admin/providers/openai/config",
      {
        method: "PUT",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "denied-secret", settings: {} }),
      },
    );
    expect(deniedConfig.status).toBe(403);

    const noDefault = await app.request("/api/ai/test", {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "no model" }),
    });
    expect(noDefault.status).toBe(503);
    expect((await readFailure(noDefault)).error.code).toBe(
      ApiErrorCodes.AI_NO_AVAILABLE_MODEL,
    );

    const providersResponse = await app.request("/api/ai/admin/providers", {
      headers: { cookie: admin.cookie },
    });
    expect(providersResponse.status).toBe(200);
    const providers = (await readSuccess<AdminAiProvider[]>(providersResponse))
      .data;
    expect(providers).toHaveLength(40);
    expect(providers.map((provider) => provider.providerId)).toContain(
      "openai",
    );
    expect(providers.map((provider) => provider.providerId)).not.toContain(
      "openrouter-images",
    );
    const vertexProvider = providers.find(
      (provider) => provider.providerId === "google-vertex",
    );
    expect(vertexProvider?.configFields.map((field) => field.key)).toEqual([
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_CLOUD_LOCATION",
    ]);

    const invalidAzureConfig = await app.request(
      "/api/ai/admin/providers/azure-openai-responses/config",
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: "azure-secret",
          settings: {
            AZURE_OPENAI_BASE_URL: "https://example.openai.azure.com",
            AZURE_OPENAI_DEPLOYMENT_NAME_MAP: "not-json",
          },
        }),
      },
    );
    expect(invalidAzureConfig.status).toBe(400);
    expect((await readFailure(invalidAzureConfig)).error.code).toBe(
      ApiErrorCodes.AI_CONFIG_INVALID,
    );

    const vertexKey = "vertex-secret-value";
    const vertexSettings = {
      GOOGLE_CLOUD_PROJECT: "test-project",
      GOOGLE_CLOUD_LOCATION: "us-central1",
    };
    const vertexConfigResponse = await app.request(
      "/api/ai/admin/providers/google-vertex/config",
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: vertexKey, settings: vertexSettings }),
      },
    );
    expect(vertexConfigResponse.status).toBe(200);
    const vertexConfig = (
      await readSuccess<AdminAiProvider>(vertexConfigResponse)
    ).data;
    expect(vertexConfig.configuredSettings).toEqual(vertexSettings);
    expect(JSON.stringify(vertexConfig)).not.toContain(vertexKey);
    expect(runtime.ai.getProviderRequestEnv("google-vertex")).toEqual(
      vertexSettings,
    );

    const fakeKey = "sk-test-plain-secret-value";
    const configResponse = await app.request(
      "/api/ai/admin/providers/openai/config",
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: fakeKey, settings: {} }),
      },
    );
    expect(configResponse.status).toBe(200);
    const configured = (await readSuccess<AdminAiProvider>(configResponse))
      .data;
    expect(configured).toMatchObject({
      providerId: "openai",
      enabled: false,
      authStatus: "needs_check",
      activeCredentialType: "api_key",
      credentialMask: "****alue",
    });
    expect(JSON.stringify(configured)).not.toContain(fakeKey);

    const stored = runtime.db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.providerId, "openai"))
      .get()!;
    expect(stored.payloadCiphertext).not.toContain(fakeKey);

    const checkResponse = await app.request(
      "/api/ai/admin/providers/openai/check",
      {
        method: "POST",
        headers: { cookie: admin.cookie },
      },
    );
    expect(checkResponse.status).toBe(200);
    expect(
      (await readSuccess<AdminAiProvider>(checkResponse)).data,
    ).toMatchObject({
      authStatus: "ready",
      authSource: "stored_api_key",
      enabled: false,
    });

    const stateResponse = await app.request(
      "/api/ai/admin/providers/openai/state",
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(stateResponse.status).toBe(200);

    const catalogResponse = await app.request("/api/ai/admin/models", {
      headers: { cookie: admin.cookie },
    });
    const catalog = (await readSuccess<AdminAiModelsResponse>(catalogResponse))
      .data;
    const model = catalog.items.find(
      (item) => item.providerId === "openai" && item.available,
    );
    expect(model).toBeDefined();
    const modelRef = { providerId: model!.providerId, modelId: model!.modelId };

    const whitelistResponse = await app.request("/api/ai/admin/models", {
      method: "PUT",
      headers: { cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ models: [modelRef] }),
    });
    expect(whitelistResponse.status).toBe(200);

    const defaultResponse = await app.request("/api/ai/admin/default-model", {
      method: "PUT",
      headers: { cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelRef }),
    });
    expect(defaultResponse.status).toBe(200);

    const userModelsResponse = await app.request("/api/ai/models", {
      headers: { cookie: user.cookie },
    });
    expect(userModelsResponse.status).toBe(200);
    const userModels = (await readSuccess<AiUserModel[]>(userModelsResponse))
      .data;
    expect(userModels).toHaveLength(1);
    expect(userModels[0]).toMatchObject(modelRef);
    expect(JSON.stringify(userModels)).not.toContain("credentialMask");
    expect(JSON.stringify(userModels)).not.toContain("authSource");

    const preferenceResponse = await app.request("/api/ai/preferences", {
      headers: { cookie: user.cookie },
    });
    expect(
      (await readSuccess<AiUserPreference>(preferenceResponse)).data,
    ).toEqual({
      selectedModel: null,
      effectiveModel: modelRef,
      effectiveSource: "global",
    });

    const updatePreferenceResponse = await app.request("/api/ai/preferences", {
      method: "PUT",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelRef }),
    });
    expect(
      (await readSuccess<AiUserPreference>(updatePreferenceResponse)).data,
    ).toEqual({
      selectedModel: modelRef,
      effectiveModel: modelRef,
      effectiveSource: "user",
    });

    const invalidModelResponse = await app.request("/api/ai/test", {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: { providerId: "openai", modelId: "not-enabled" },
        prompt: "must not reach gateway",
      }),
    });
    expect(invalidModelResponse.status).toBe(403);
    expect((await readFailure(invalidModelResponse)).error.code).toBe(
      ApiErrorCodes.AI_MODEL_NOT_ALLOWED,
    );

    const streamResponse = await app.request("/api/ai/test", {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test prompt" }),
    });
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const streamBody = await streamResponse.text();
    const streamEvents = parseAiTestStream(streamBody);
    expect(streamEvents.map((event) => event.type)).toEqual([
      "start",
      "text_delta",
      "done",
    ]);
    expect(streamEvents[0]).toMatchObject({
      type: "start",
      model: modelRef,
      requestId: expect.any(String),
    });
    expect(streamEvents[1]).toEqual({
      type: "text_delta",
      text: "fake answer",
    });
    expect(streamEvents[2]).toEqual({
      type: "done",
      stopReason: "stop",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    const usageDenied = await app.request("/api/ai/usage/calls", {
      headers: { cookie: user.cookie },
    });
    expect(usageDenied.status).toBe(403);

    const usageListResponse = await app.request(
      "/api/ai/usage/calls?page=1&pageSize=20",
      {
        headers: { cookie: admin.cookie },
      },
    );
    expect(usageListResponse.status).toBe(200);
    const usageList = (
      await readSuccess<{
        items: Array<Record<string, unknown>>;
        total: number;
      }>(usageListResponse)
    ).data;
    expect(usageList.total).toBeGreaterThanOrEqual(1);
    const successfulCall = usageList.items.find(
      (item) => item.result === "succeeded",
    );
    expect(successfulCall).toMatchObject({
      scenario: "model_test",
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
    });
    expect(Object.keys(successfulCall ?? {}).sort()).toEqual(
      [
        "api",
        "appId",
        "chunkCount",
        "cost",
        "durationMs",
        "errorCategory",
        "errorCode",
        "externalUserId",
        "finishedAt",
        "httpStatus",
        "id",
        "modelId",
        "principalKind",
        "projectId",
        "providerId",
        "requestId",
        "responseId",
        "responseModel",
        "result",
        "runId",
        "scenario",
        "startedAt",
        "stepId",
        "stopReason",
        "tenantId",
        "timeoutMs",
        "ttftMs",
        "turnId",
        "usage",
        "userId",
      ].sort(),
    );
    expect(JSON.stringify(successfulCall)).not.toContain("test prompt");
    expect(JSON.stringify(successfulCall)).not.toContain(fakeKey);

    const usageDetailResponse = await app.request(
      `/api/ai/usage/calls/${successfulCall?.id as string}`,
      {
        headers: { cookie: admin.cookie },
      },
    );
    expect(usageDetailResponse.status).toBe(200);
    expect(
      (await readSuccess<{ toolExecutions: unknown[] }>(usageDetailResponse))
        .data.toolExecutions,
    ).toEqual([]);

    const recheckResponse = await app.request(
      "/api/ai/admin/providers/openai/check",
      {
        method: "POST",
        headers: { cookie: admin.cookie },
      },
    );
    expect(recheckResponse.status).toBe(200);
    expect(
      (await readSuccess<AdminAiProvider>(recheckResponse)).data.enabled,
    ).toBe(true);

    const timeoutResponse = await app.request("/api/ai/test", {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "timeout" }),
    });
    expect(timeoutResponse.status).toBe(200);
    const timeoutBody = await timeoutResponse.text();
    const timeoutEvents = parseAiTestStream(timeoutBody);
    expect(timeoutEvents.map((event) => event.type)).toEqual([
      "start",
      "error",
    ]);
    expect(timeoutEvents[1]).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
      retryable: true,
    });

    for (const [prompt, code] of [
      ["auth", ApiErrorCodes.AI_PROVIDER_AUTH_FAILED],
      ["upstream", ApiErrorCodes.AI_UPSTREAM_ERROR],
      ["aborted", ApiErrorCodes.AI_REQUEST_ABORTED],
    ] as const) {
      const errorResponse = await app.request("/api/ai/test", {
        method: "POST",
        headers: {
          cookie: user.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });
      expect(errorResponse.status).toBe(200);
      const errorBody = await errorResponse.text();
      const errorEvents = parseAiTestStream(errorBody);
      expect(errorEvents.map((event) => event.type)).toEqual([
        "start",
        "error",
      ]);
      expect(errorEvents[1]).toMatchObject({ type: "error", code });
      expect(errorBody).not.toContain(prompt);
    }

    const unexpectedToolResponse = await app.request("/api/ai/test", {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "tool_use" }),
    });
    expect(unexpectedToolResponse.status).toBe(200);
    const unexpectedToolBody = await unexpectedToolResponse.text();
    const unexpectedToolEvents = parseAiTestStream(unexpectedToolBody);
    expect(unexpectedToolEvents.map((event) => event.type)).toEqual([
      "start",
      "error",
    ]);
    expect(unexpectedToolEvents[1]).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_UPSTREAM_ERROR,
    });
    expect(unexpectedToolBody).not.toContain("unexpected_tool");
    expect(unexpectedToolBody).not.toContain("must not leak");
    const completedUsageResponse = await app.request(
      "/api/ai/usage/calls?page=1&pageSize=100",
      { headers: { cookie: admin.cookie } },
    );
    const completedUsage = (
      await readSuccess<{
        items: Array<{
          id: string;
          userId: string;
          providerId: string;
          modelId: string;
          requestId: string;
          startedAt: string;
          result: string;
          stopReason: string | null;
        }>;
      }>(completedUsageResponse)
    ).data.items;
    expect(completedUsage.map((item) => item.result)).toEqual(
      expect.arrayContaining([
        "succeeded",
        "timed_out",
        "auth_failed",
        "upstream_failed",
        "cancelled",
      ]),
    );
    expect(
      completedUsage.filter((item) => item.stopReason === "tool_use"),
    ).toEqual([expect.objectContaining({ result: "succeeded" })]);

    const filterTarget = completedUsage[0]!;
    const exactFilter = new URLSearchParams({
      page: "1",
      pageSize: "20",
      userId: filterTarget.userId,
      providerId: filterTarget.providerId,
      modelId: filterTarget.modelId,
      requestId: filterTarget.requestId,
      from: new Date(
        new Date(filterTarget.startedAt).getTime() - 1,
      ).toISOString(),
      to: new Date(
        new Date(filterTarget.startedAt).getTime() + 1,
      ).toISOString(),
    });
    const exactFilterResponse = await app.request(
      `/api/ai/usage/calls?${exactFilter.toString()}`,
      { headers: { cookie: admin.cookie } },
    );
    expect(
      (
        await readSuccess<{ items: Array<{ id: string }> }>(exactFilterResponse)
      ).data.items.map((item) => item.id),
    ).toEqual([filterTarget.id]);

    const firstPageResponse = await app.request(
      "/api/ai/usage/calls?page=1&pageSize=2",
      { headers: { cookie: admin.cookie } },
    );
    const secondPageResponse = await app.request(
      "/api/ai/usage/calls?page=2&pageSize=2",
      { headers: { cookie: admin.cookie } },
    );
    const firstPageIds = (
      await readSuccess<{ items: Array<{ id: string }> }>(firstPageResponse)
    ).data.items.map((item) => item.id);
    const secondPageIds = (
      await readSuccess<{ items: Array<{ id: string }> }>(secondPageResponse)
    ).data.items.map((item) => item.id);
    expect(firstPageIds).toHaveLength(2);
    expect(secondPageIds).toHaveLength(2);
    expect(firstPageIds.some((id) => secondPageIds.includes(id))).toBe(false);

    const timedOutUsageResponse = await app.request(
      "/api/ai/usage/calls?page=1&pageSize=20&result=timed_out",
      { headers: { cookie: admin.cookie } },
    );
    expect(
      (
        await readSuccess<{ items: Array<{ result: string }> }>(
          timedOutUsageResponse,
        )
      ).data.items.every((item) => item.result === "timed_out"),
    ).toBe(true);

    const replaceConfigResponse = await app.request(
      "/api/ai/admin/providers/openai/config",
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-replaced-secret", settings: {} }),
      },
    );
    expect(replaceConfigResponse.status).toBe(200);
    expect(
      (await readSuccess<AdminAiProvider>(replaceConfigResponse)).data,
    ).toMatchObject({ enabled: false, authStatus: "needs_check" });

    const fallbackAfterReplace = await app.request("/api/ai/preferences", {
      headers: { cookie: user.cookie },
    });
    expect(
      (await readSuccess<AiUserPreference>(fallbackAfterReplace)).data,
    ).toMatchObject({ effectiveModel: null, effectiveSource: null });
  } finally {
    cleanup();
  }
});
