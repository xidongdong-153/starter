import type {
  AdminAiModel,
  AdminAiModelsResponse,
  AdminAiProvider,
  AiModelRef,
  AiTestInput,
  AiTestStreamEvent,
  AiUserModel,
  AiUserPreference,
  ReplaceAiEnabledModelsInput,
  UpdateAiProviderConfigInput,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";

import type {
  AiGateway,
  AiRuntime,
  AiStoredPayloadColumns,
} from "@api/infra/ai/index.js";
import { AiGatewayError, AiRuntimeError } from "@api/infra/ai/index.js";
import { AppError } from "@api/shared/app-error.js";

import type { AiInvocationRunner } from "../usage-audit/usage-audit.service.js";
import type { AiProviderConfigRecord } from "./configuration.repository.js";
import { AiProviderConfigConflictError } from "./configuration.repository.js";
import {
  toAdminAiModel,
  toAdminAiProvider,
  toAiUserModel,
  toMissingAdminAiModel,
} from "./configuration.presenter.js";

export function createAiService(
  repository: ReturnType<
    typeof import("./configuration.repository.js").createAiRepository
  >,
  runtime: AiRuntime,
  gateway: AiGateway,
  invocationRunner?: AiInvocationRunner,
  requestTimeoutMs = 120_000,
) {
  async function listProviders(): Promise<AdminAiProvider[]> {
    await runtime.ensureReady();
    const configs = new Map(
      repository
        .listProviderConfigs()
        .map((config) => [config.providerId, config]),
    );
    const enabledCounts = countByProvider(repository.listEnabledModels());
    const catalogCounts = countByProvider(runtime.listModels());

    return runtime.providers.map((definition) => {
      const config = configs.get(definition.id);
      return toAdminAiProvider({
        definition,
        config,
        configuredSettings: readSettings(config),
        catalogModelCount: catalogCounts.get(definition.id) ?? 0,
        enabledModelCount: enabledCounts.get(definition.id) ?? 0,
      });
    });
  }

  async function updateProviderConfig(
    providerId: string,
    input: UpdateAiProviderConfigInput,
    actorId: string,
  ): Promise<AdminAiProvider> {
    await runtime.ensureReady();
    const definition = requireProvider(providerId);
    validateProviderConfig(definition, input);
    const current = repository.findProviderConfig(providerId);

    try {
      const payload = runtime.prepareProviderConfig(
        providerId,
        current ? toStoredColumns(current) : undefined,
        input.apiKey,
        input.settings,
      );
      repository.saveProviderConfig(
        providerId,
        payload,
        actorId,
        current?.rowVersion ?? null,
      );
      runtime.reloadProvider(providerId);
      return await findProviderDto(providerId);
    } catch (error) {
      throwRuntimeError(error);
    }
  }

  async function clearProviderCredential(
    providerId: string,
    actorId: string,
  ): Promise<AdminAiProvider> {
    await runtime.ensureReady();
    requireProvider(providerId);
    const current = repository.findProviderConfig(providerId);
    try {
      const payload = current
        ? runtime.prepareCredentialClear(toStoredColumns(current))
        : null;
      repository.clearProviderCredential(
        providerId,
        payload,
        actorId,
        current?.rowVersion ?? null,
      );
      runtime.reloadProvider(providerId);
      return await findProviderDto(providerId);
    } catch (error) {
      throwRuntimeError(error);
    }
  }

  async function checkProvider(
    providerId: string,
    actorId: string,
  ): Promise<AdminAiProvider> {
    await runtime.ensureReady();
    requireProvider(providerId);
    const current = repository.findProviderConfig(providerId);
    const expectedConfigRevision = current?.configRevision ?? null;
    runtime.reloadProvider(providerId);

    try {
      const check = await runtime.checkAuth(providerId);
      repository.recordAuthCheck({
        providerId,
        expectedConfigRevision,
        status: check.source ? "ready" : "not_configured",
        source: check.source,
        credentialType: check.credentialType,
        errorCode: null,
        actorId,
      });
      return await findProviderDto(providerId);
    } catch (error) {
      const normalized = normalizeRuntimeError(error);
      if (normalized.kind === "conflict") throwRuntimeError(normalized);
      try {
        repository.recordAuthCheck({
          providerId,
          expectedConfigRevision,
          status: "error",
          source: null,
          credentialType: null,
          errorCode: normalized.kind,
          actorId,
        });
      } catch (recordError) {
        throwRuntimeError(recordError);
      }
      throwRuntimeError(normalized);
    }
  }

  async function setProviderState(
    providerId: string,
    enabled: boolean,
    actorId: string,
  ): Promise<AdminAiProvider> {
    await runtime.ensureReady();
    requireProvider(providerId);
    const config = repository.findProviderConfig(providerId);
    if (!config) {
      throw new AppError(
        ApiErrorCodes.AI_PROVIDER_NOT_CONFIGURED,
        "Provider 尚未完成认证检查",
        409,
      );
    }
    if (
      enabled &&
      (config.authStatus !== "ready" ||
        config.checkedConfigRevision !== config.configRevision)
    ) {
      throw new AppError(
        ApiErrorCodes.AI_PROVIDER_NOT_CONFIGURED,
        "Provider 配置需要重新检查后才能启用",
        409,
      );
    }
    const updated = repository.setProviderEnabled(providerId, enabled, actorId);
    if (!updated) {
      throw new AppError(
        ApiErrorCodes.AI_PROVIDER_NOT_CONFIGURED,
        "Provider 配置需要重新检查后才能启用",
        409,
      );
    }
    return findProviderDto(providerId);
  }

  async function refreshProviderModels(
    providerId: string,
    actorId: string,
  ): Promise<AdminAiModelsResponse> {
    await runtime.ensureReady();
    const definition = requireProvider(providerId);
    if (!definition.supportsModelRefresh) {
      throw new AppError(
        ApiErrorCodes.AI_CONFIG_INVALID,
        "这个 Provider 不支持刷新模型目录",
        400,
      );
    }
    const config = repository.findProviderConfig(providerId);
    if (!isCheckedReady(config)) {
      throw new AppError(
        ApiErrorCodes.AI_PROVIDER_NOT_CONFIGURED,
        "Provider 尚未完成认证检查",
        503,
      );
    }

    try {
      await runtime.refreshModels(providerId);
      repository.pruneProviderModels(
        providerId,
        runtime.listModels(providerId).map((model) => model.modelId),
        actorId,
      );
      return listAdminModels();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AppError(
          ApiErrorCodes.AI_REQUEST_ABORTED,
          "模型目录刷新已取消",
          503,
        );
      }
      throw new AppError(
        ApiErrorCodes.AI_CATALOG_REFRESH_FAILED,
        "模型目录刷新失败，可以稍后重试",
        503,
      );
    }
  }

  async function listAdminModels(): Promise<AdminAiModelsResponse> {
    await runtime.ensureReady();
    const configs = new Map(
      repository
        .listProviderConfigs()
        .map((config) => [config.providerId, config]),
    );
    const definitions = new Map(
      runtime.providers.map((definition) => [definition.id, definition]),
    );
    const enabledRefs = repository.listEnabledModels();
    const enabledKeys = new Set(enabledRefs.map(refKey));
    const catalog = runtime.listModels();
    const availableKeys = new Set(runtime.listAvailableModels().map(refKey));
    const catalogKeys = new Set(catalog.map(refKey));
    const items: AdminAiModel[] = catalog.map((model) => {
      const config = configs.get(model.providerId);
      const ready = isCheckedReady(config);
      const available = Boolean(
        config?.enabled && ready && availableKeys.has(refKey(model)),
      );
      return toAdminAiModel({
        model,
        providerName:
          definitions.get(model.providerId)?.name ?? model.providerId,
        enabled: enabledKeys.has(refKey(model)),
        available,
        unavailableReason: !config?.enabled
          ? "provider_disabled"
          : !ready
            ? "provider_not_ready"
            : availableKeys.has(refKey(model))
              ? null
              : "model_unavailable",
      });
    });

    for (const ref of enabledRefs) {
      if (!catalogKeys.has(refKey(ref))) {
        items.push(
          toMissingAdminAiModel(
            ref,
            definitions.get(ref.providerId)?.name ?? ref.providerId,
          ),
        );
      }
    }
    items.sort(compareModels);
    return { items, globalDefaultModel: repository.findGlobalDefault() };
  }

  async function replaceEnabledModels(
    input: ReplaceAiEnabledModelsInput,
    actorId: string,
  ): Promise<AdminAiModelsResponse> {
    await runtime.ensureReady();
    const catalog = new Map(
      runtime.listAvailableModels().map((model) => [refKey(model), model]),
    );
    const configs = new Map(
      repository
        .listProviderConfigs()
        .map((config) => [config.providerId, config]),
    );
    for (const ref of input.models) {
      if (!catalog.has(refKey(ref))) {
        throw new AppError(
          ApiErrorCodes.AI_MODEL_NOT_FOUND,
          "模型不在当前目录中",
          404,
        );
      }
      if (!isCheckedReady(configs.get(ref.providerId))) {
        throw new AppError(
          ApiErrorCodes.AI_PROVIDER_NOT_CONFIGURED,
          "模型所属 Provider 尚未完成认证检查",
          409,
        );
      }
    }
    repository.replaceEnabledModels(input.models, actorId);
    return listAdminModels();
  }

  async function setGlobalDefault(
    model: AiModelRef | null,
    actorId: string,
  ): Promise<AdminAiModelsResponse> {
    await runtime.ensureReady();
    if (model && !isModelAllowed(model)) {
      throw new AppError(
        ApiErrorCodes.AI_MODEL_NOT_ALLOWED,
        "只能把已启用的可用模型设为全局默认",
        403,
      );
    }
    repository.setGlobalDefault(model, actorId);
    return listAdminModels();
  }

  async function listUserModels(): Promise<AiUserModel[]> {
    await runtime.ensureReady();
    const definitions = new Map(
      runtime.providers.map((definition) => [definition.id, definition]),
    );
    const allowed = new Set(repository.listEnabledModels().map(refKey));
    return runtime
      .listAvailableModels()
      .filter(
        (model) =>
          allowed.has(refKey(model)) && isProviderAvailable(model.providerId),
      )
      .map((model) =>
        toAiUserModel(
          model,
          definitions.get(model.providerId)?.name ?? model.providerId,
        ),
      )
      .sort(compareModels);
  }

  async function getPreference(userId: string): Promise<AiUserPreference> {
    await runtime.ensureReady();
    const selectedModel = toPreferenceRef(
      repository.findUserPreference(userId),
    );
    const effective = selectDefaultModel(selectedModel);
    return {
      selectedModel,
      effectiveModel: effective?.model ?? null,
      effectiveSource: effective?.source ?? null,
    };
  }

  async function setPreference(
    userId: string,
    model: AiModelRef | null,
  ): Promise<AiUserPreference> {
    await runtime.ensureReady();
    if (model && !isModelAllowed(model)) {
      throw new AppError(
        ApiErrorCodes.AI_MODEL_NOT_ALLOWED,
        "这个模型当前不可用",
        403,
      );
    }
    repository.setUserPreference(userId, model);
    return getPreference(userId);
  }

  async function prepareTest(userId: string, input: AiTestInput) {
    await runtime.ensureReady();
    const model = input.model
      ? requireExplicitModel(input.model)
      : selectModelForUser(userId);
    return {
      model,
      async *stream(requestId: string, signal?: AbortSignal) {
        if (!isModelAllowed(model)) {
          throw new AppError(
            ApiErrorCodes.AI_MODEL_NOT_ALLOWED,
            "这个模型当前不可用",
            403,
          );
        }
        const gatewayInput = {
          model,
          messages: [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: input.prompt,
                  turnIndex: 0,
                  contentIndex: 0,
                  blockId: "0:0",
                },
              ],
            },
          ],
          turnIndex: 0,
          timeoutMs: requestTimeoutMs,
          signal,
        };
        const events = invocationRunner
          ? invocationRunner.stream(
              {
                requestId,
                userId,
                scenario: "model_test",
                timeoutMs: requestTimeoutMs,
              },
              gatewayInput,
            )
          : gateway.stream(gatewayInput);
        for await (const event of events) {
          if (event.type === "text_delta") {
            yield { type: "text_delta", text: event.text } as const;
          } else if (event.type === "completed") {
            if (event.stopReason === "tool_use") {
              throw new AiGatewayError("upstream", {
                usage: event.usage,
                cost: event.cost,
                stopReason: event.stopReason,
              });
            }
            const { inputTokens, outputTokens, totalTokens } = event.usage;
            yield {
              type: "done",
              stopReason: event.stopReason,
              usage:
                inputTokens === null ||
                outputTokens === null ||
                totalTokens === null
                  ? undefined
                  : { inputTokens, outputTokens, totalTokens },
            } as const;
          }
        }
      },
    };
  }

  function toStreamError(error: unknown, requestId: string): AiTestStreamEvent {
    if (error instanceof AppError) {
      return {
        type: "error",
        code: error.code,
        message: error.message,
        retryable: error.status >= 500,
        requestId,
      };
    }
    const gatewayError =
      error instanceof AiGatewayError ? error : new AiGatewayError("upstream");
    if (gatewayError.kind === "timeout") {
      return {
        type: "error",
        code: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
        message: "模型响应超时，可以重试",
        retryable: true,
        requestId,
      };
    }
    if (gatewayError.kind === "aborted") {
      return {
        type: "error",
        code: ApiErrorCodes.AI_REQUEST_ABORTED,
        message: "生成已停止",
        retryable: true,
        requestId,
      };
    }
    if (gatewayError.kind === "auth") {
      return {
        type: "error",
        code: ApiErrorCodes.AI_PROVIDER_AUTH_FAILED,
        message: "Provider 认证失败，请检查配置后重试",
        retryable: true,
        requestId,
      };
    }
    return {
      type: "error",
      code: ApiErrorCodes.AI_UPSTREAM_ERROR,
      message: "模型服务暂时不可用，可以稍后重试",
      retryable: true,
      requestId,
    };
  }

  function selectModelForUser(userId: string): AiModelRef {
    const selected = toPreferenceRef(repository.findUserPreference(userId));
    const effective = selectDefaultModel(selected);
    if (!effective) {
      throw new AppError(
        ApiErrorCodes.AI_NO_AVAILABLE_MODEL,
        "当前没有可用模型",
        503,
      );
    }
    return effective.model;
  }

  function requireExplicitModel(model: AiModelRef): AiModelRef {
    if (!isModelAllowed(model)) {
      throw new AppError(
        ApiErrorCodes.AI_MODEL_NOT_ALLOWED,
        "这个模型当前不可用",
        403,
      );
    }
    return model;
  }

  function selectDefaultModel(userModel: AiModelRef | null) {
    if (userModel && isModelAllowed(userModel))
      return { model: userModel, source: "user" as const };
    const globalModel = repository.findGlobalDefault();
    if (globalModel && isModelAllowed(globalModel))
      return { model: globalModel, source: "global" as const };
    return null;
  }

  function isModelAllowed(model: AiModelRef): boolean {
    const enabled = repository
      .listEnabledModels()
      .some((item) => refKey(item) === refKey(model));
    if (!enabled || !isProviderAvailable(model.providerId)) return false;
    return runtime
      .listAvailableModels(model.providerId)
      .some((item) => item.modelId === model.modelId);
  }

  function isProviderAvailable(providerId: string): boolean {
    const config = repository.findProviderConfig(providerId);
    return Boolean(config?.enabled && isCheckedReady(config));
  }

  function readSettings(
    config: AiProviderConfigRecord | undefined,
  ): Record<string, string> {
    if (!config) return {};
    try {
      return runtime.readProviderSettings(toStoredColumns(config));
    } catch {
      return {};
    }
  }

  async function findProviderDto(providerId: string): Promise<AdminAiProvider> {
    const providers = await listProviders();
    const provider = providers.find((item) => item.providerId === providerId);
    if (!provider) throwProviderNotFound();
    return provider;
  }

  function requireProvider(providerId: string) {
    const definition = runtime.providers.find(
      (provider) => provider.id === providerId,
    );
    if (!definition) throwProviderNotFound();
    return definition;
  }

  async function resolveConversationModel(
    userId: string,
    requestedModel?: AiModelRef,
  ): Promise<AiModelRef> {
    await runtime.ensureReady();
    return requestedModel
      ? requireExplicitModel(requestedModel)
      : selectModelForUser(userId);
  }

  async function resolveAgentModel(model: AiModelRef): Promise<AiModelRef> {
    await runtime.ensureReady();
    return requireExplicitModel(model);
  }

  function isConversationModelAllowed(model: AiModelRef): boolean {
    return isModelAllowed(model);
  }

  return {
    resolveConversationModel,
    resolveAgentModel,
    isConversationModelAllowed,
    listProviders,
    updateProviderConfig,
    clearProviderCredential,
    checkProvider,
    setProviderState,
    refreshProviderModels,
    listAdminModels,
    replaceEnabledModels,
    setGlobalDefault,
    listUserModels,
    getPreference,
    setPreference,
    prepareTest,
    toStreamError,
  };
}

function validateProviderConfig(
  definition: AiRuntime["providers"][number],
  input: UpdateAiProviderConfigInput,
): void {
  if (input.apiKey !== undefined && !definition.acceptsAdminApiKey) {
    throw new AppError(
      ApiErrorCodes.AI_CONFIG_INVALID,
      "这个 Provider 不接受 Admin 保存 API Key",
      400,
    );
  }
  const fields = new Map(
    definition.configFields.map((field) => [field.key, field]),
  );
  const unknownKeys = Object.keys(input.settings).filter(
    (key) => !fields.has(key),
  );
  if (unknownKeys.length > 0) {
    throw new AppError(
      ApiErrorCodes.AI_CONFIG_INVALID,
      "Provider 配置包含未知字段",
      400,
      { keys: unknownKeys },
    );
  }
  if (input.apiKey !== undefined) {
    const missing = definition.configFields
      .filter((field) => field.required && !input.settings[field.key])
      .map((field) => field.key);
    if (missing.length > 0) {
      throw new AppError(
        ApiErrorCodes.AI_CONFIG_INVALID,
        "Provider 配置缺少必填字段",
        400,
        { keys: missing },
      );
    }
  }
  for (const configField of definition.configFields) {
    const value = input.settings[configField.key];
    if (value && configField.type === "url" && !isUrl(value)) {
      throw new AppError(
        ApiErrorCodes.AI_CONFIG_INVALID,
        `${configField.label} 不是有效 URL`,
        400,
      );
    }
  }
  if (definition.id === "azure-openai-responses") {
    if (
      input.apiKey !== undefined &&
      !input.settings.AZURE_OPENAI_BASE_URL &&
      !input.settings.AZURE_OPENAI_RESOURCE_NAME
    ) {
      throw new AppError(
        ApiErrorCodes.AI_CONFIG_INVALID,
        "Azure OpenAI 需要 Base URL 或 Resource Name",
        400,
      );
    }

    const deploymentMap = input.settings.AZURE_OPENAI_DEPLOYMENT_NAME_MAP;
    if (deploymentMap && !isStringMapJson(deploymentMap)) {
      throw new AppError(
        ApiErrorCodes.AI_CONFIG_INVALID,
        "Azure OpenAI Deployment Map 必须是字符串键值的 JSON 对象",
        400,
      );
    }
  }
}

function throwProviderNotFound(): never {
  throw new AppError(
    ApiErrorCodes.AI_PROVIDER_NOT_FOUND,
    "Provider 不存在",
    404,
  );
}

function throwRuntimeError(error: unknown): never {
  const normalized = normalizeRuntimeError(error);
  if (normalized.kind === "provider_not_found") throwProviderNotFound();
  if (normalized.kind === "credential_key_unavailable") {
    throw new AppError(
      ApiErrorCodes.AI_CREDENTIAL_KEY_UNAVAILABLE,
      "API 未配置 AI 凭据加密密钥",
      503,
    );
  }
  if (normalized.kind === "conflict") {
    throw new AppError(
      ApiErrorCodes.AI_CREDENTIAL_CONFLICT,
      "Provider 凭据已被其他操作更新，请重试",
      409,
    );
  }
  throw new AppError(
    ApiErrorCodes.AI_PROVIDER_AUTH_FAILED,
    "Provider 认证失败，请检查配置后重试",
    503,
  );
}

function normalizeRuntimeError(error: unknown): AiRuntimeError {
  if (error instanceof AiProviderConfigConflictError)
    return new AiRuntimeError("conflict");
  return error instanceof AiRuntimeError ? error : new AiRuntimeError("auth");
}

function isCheckedReady(config: AiProviderConfigRecord | undefined): boolean {
  return Boolean(
    config?.authStatus === "ready" &&
    config.checkedConfigRevision === config.configRevision,
  );
}

function toStoredColumns(
  config: AiProviderConfigRecord,
): AiStoredPayloadColumns {
  return {
    payloadCiphertext: config.payloadCiphertext,
    payloadIv: config.payloadIv,
    payloadAuthTag: config.payloadAuthTag,
    encryptionVersion: config.encryptionVersion,
  };
}

function refKey(ref: { providerId: string; modelId: string }): string {
  return `${ref.providerId}\u0000${ref.modelId}`;
}

function countByProvider(
  items: readonly { providerId: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(item.providerId, (counts.get(item.providerId) ?? 0) + 1);
  return counts;
}

function toPreferenceRef(
  preference: { providerId: string | null; modelId: string | null } | undefined,
): AiModelRef | null {
  return preference?.providerId && preference.modelId
    ? { providerId: preference.providerId, modelId: preference.modelId }
    : null;
}

function compareModels(
  left: { providerId: string; modelId: string },
  right: { providerId: string; modelId: string },
): number {
  return (
    left.providerId.localeCompare(right.providerId) ||
    left.modelId.localeCompare(right.modelId)
  );
}

function isUrl(value: string): boolean {
  return URL.canParse(value);
}

function isStringMapJson(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every(
        (item) => typeof item === "string" && item.trim().length > 0,
      )
    );
  } catch {
    return false;
  }
}
