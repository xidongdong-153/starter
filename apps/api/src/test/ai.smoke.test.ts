import type {
  AdminAiModelsResponse,
  AdminAiProvider,
  AiUserModel,
  AiUserPreference,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import type { AiGateway } from "@api/infra/ai/index.js";
import {
  AiGatewayError,
  createAiCrypto,
  createAiRuntime,
} from "@api/infra/ai/index.js";
import { aiProviderConfigs, aiSettings } from "@api/infra/db/schema/index.js";
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

const fakeGateway: AiGateway = {
  async *stream(input) {
    if (input.prompt === "timeout") throw new AiGatewayError("timeout");
    yield { type: "text_delta", text: "fake answer" };
    yield {
      type: "done",
      stopReason: "stop",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
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
    expect(streamBody).toContain("event: start");
    expect(streamBody).toContain("fake answer");
    expect(streamBody).toContain("event: done");
    expect(streamBody).not.toContain("test prompt");
    expect(streamBody).not.toContain(fakeKey);

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
    expect(timeoutBody).toContain("event: error");
    expect(timeoutBody).toContain(ApiErrorCodes.AI_UPSTREAM_TIMEOUT);

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
