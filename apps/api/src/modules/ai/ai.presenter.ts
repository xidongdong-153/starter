import type {
  AdminAiModel,
  AdminAiProvider,
  AiAuthSource,
  AiAuthStatus,
  AiModelRef,
  AiUserModel,
} from "@starter/contracts";
import type {
  AiProviderDefinition,
  AiRuntimeModel,
} from "@api/infra/ai/index.js";

import type { AiProviderConfigRecord } from "./ai.repository.js";

export function toAdminAiProvider(input: {
  definition: AiProviderDefinition;
  config: AiProviderConfigRecord | undefined;
  configuredSettings: Record<string, string>;
  catalogModelCount: number;
  enabledModelCount: number;
}): AdminAiProvider {
  const { definition, config } = input;
  const readableKeys = new Set(
    definition.configFields.map((field) => field.key),
  );
  const configuredSettings = Object.fromEntries(
    Object.entries(input.configuredSettings).filter(([key]) =>
      readableKeys.has(key),
    ),
  );

  return {
    providerId: definition.id,
    name: definition.name,
    enabled: config?.enabled ?? false,
    supportedAuthModes: [...definition.supportedAuthModes],
    activeCredentialType:
      config?.credentialType === "api_key" || config?.credentialType === "oauth"
        ? config.credentialType
        : null,
    authStatus: normalizeAuthStatus(config?.authStatus),
    authSource: normalizeAuthSource(config?.authSource),
    checkedAt: config?.lastCheckedAt?.toISOString() ?? null,
    credentialMask: config?.credentialHint ?? null,
    configFields: [...definition.configFields],
    configuredSettings,
    setupInstructions: [...definition.setupInstructions],
    supportsModelRefresh: definition.supportsModelRefresh,
    catalogModelCount: input.catalogModelCount,
    enabledModelCount: input.enabledModelCount,
    configRevision: config?.configRevision ?? 0,
  };
}

export function toAdminAiModel(input: {
  model: AiRuntimeModel;
  providerName: string;
  enabled: boolean;
  available: boolean;
  unavailableReason: AdminAiModel["unavailableReason"];
}): AdminAiModel {
  return {
    ...input.model,
    providerName: input.providerName,
    enabled: input.enabled,
    available: input.available,
    unavailableReason: input.unavailableReason,
  };
}

export function toMissingAdminAiModel(
  ref: AiModelRef,
  providerName: string,
): AdminAiModel {
  return {
    ...ref,
    name: ref.modelId,
    providerName,
    capabilities: {
      contextWindow: 1,
      maxOutputTokens: 1,
      supportsImageInput: false,
      supportsReasoning: false,
      supportsTools: false,
    },
    available: false,
    enabled: true,
    unavailableReason: "model_missing",
  };
}

export function toAiUserModel(
  model: AiRuntimeModel,
  providerName: string,
): AiUserModel {
  return { ...model, providerName };
}

function normalizeAuthStatus(value: string | undefined): AiAuthStatus {
  return value === "needs_check" || value === "ready" || value === "error"
    ? value
    : "not_configured";
}

function normalizeAuthSource(
  value: string | null | undefined,
): AiAuthSource | null {
  return value === "stored_api_key" ||
    value === "stored_oauth" ||
    value === "environment" ||
    value === "aws_credentials" ||
    value === "vertex_adc" ||
    value === "keyless"
    ? value
    : null;
}
