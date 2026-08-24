import type { Provider } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

import type {
  AiAuthMode,
  AiProviderConfigField,
  CustomAiProviderDefinition,
} from "@starter/contracts";

export interface AiProviderDefinition {
  id: string;
  name: string;
  kind: "built_in" | "custom";
  protocol: CustomAiProviderDefinition["protocol"] | null;
  baseUrl: string | null;
  revision: number;
  supportedAuthModes: readonly AiAuthMode[];
  acceptsAdminApiKey: boolean;
  configFields: readonly AiProviderConfigField[];
  setupInstructions: readonly string[];
  supportsModelRefresh: boolean;
}

interface ProviderOverride {
  configFields?: readonly AiProviderConfigField[];
  setupInstructions?: readonly string[];
}

function field(
  key: string,
  label: string,
  description: string,
  type: AiProviderConfigField["type"] = "text",
  required = true,
): AiProviderConfigField {
  return { key, label, description, required, type };
}

const overrides: Record<string, ProviderOverride> = {
  "amazon-bedrock": {
    setupInstructions: [
      "可以在此保存 Bedrock bearer token。",
      "AWS profile、IAM access key、ECS task role 和 web identity 由 API 主机的 AWS credential chain 提供。",
    ],
  },
  "azure-openai-responses": {
    configFields: [
      field(
        "AZURE_OPENAI_BASE_URL",
        "Base URL",
        "Azure OpenAI 资源的完整 endpoint。与 Resource Name 二选一。",
        "url",
        false,
      ),
      field(
        "AZURE_OPENAI_RESOURCE_NAME",
        "Resource Name",
        "Azure OpenAI 资源名称。与 Base URL 二选一。",
        "text",
        false,
      ),
      field(
        "AZURE_OPENAI_API_VERSION",
        "API Version",
        "可选的 Azure OpenAI API version。",
        "text",
        false,
      ),
      field(
        "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
        "Deployment Map",
        "JSON 对象，key 为 catalog model ID，value 为 Azure deployment name。",
        "text",
        false,
      ),
    ],
  },
  "cloudflare-ai-gateway": {
    configFields: [
      field("CLOUDFLARE_ACCOUNT_ID", "Account ID", "Cloudflare account ID。"),
      field(
        "CLOUDFLARE_GATEWAY_ID",
        "Gateway ID",
        "Cloudflare AI Gateway ID。",
      ),
    ],
  },
  "cloudflare-workers-ai": {
    configFields: [
      field("CLOUDFLARE_ACCOUNT_ID", "Account ID", "Cloudflare account ID。"),
    ],
  },
  "google-vertex": {
    configFields: [
      field(
        "GOOGLE_CLOUD_PROJECT",
        "Project ID",
        "Google Cloud project ID。使用 API Key、ADC 或服务账号时都需要。",
      ),
      field(
        "GOOGLE_CLOUD_LOCATION",
        "Location",
        "Google Cloud location，例如 us-central1。",
      ),
    ],
    setupInstructions: [
      "可以在此保存 Google Cloud API Key。",
      "Vertex ADC 和服务账号文件由 API 主机配置，同时设置 GOOGLE_CLOUD_PROJECT 和 GOOGLE_CLOUD_LOCATION。",
    ],
  },
  radius: {
    configFields: [
      field(
        "RADIUS_GATEWAY_URL",
        "Gateway URL",
        "Radius gateway 地址。修改后需要重新检查和刷新模型。",
        "url",
        false,
      ),
    ],
    setupInstructions: [
      "API Key 可以在此保存。OAuth 需要在 API 主机执行 ai:auth 命令。",
      "Radius 模型目录来自 gateway，认证完成后执行刷新。",
    ],
  },
};

export function createAiProviderRegistry(): readonly AiProviderDefinition[] {
  return builtinProviders().map(toDefinition);
}

export function createCustomAiProviderDefinition(
  definition: CustomAiProviderDefinition,
  revision: number,
): AiProviderDefinition {
  return {
    id: definition.providerId,
    name: definition.name,
    kind: "custom",
    protocol: definition.protocol,
    baseUrl: definition.baseUrl,
    revision,
    supportedAuthModes: ["api_key"],
    acceptsAdminApiKey: true,
    configFields: [],
    setupInstructions: [
      "可选保存 API Key；未保存凭据时按 keyless Provider 处理。",
    ],
    supportsModelRefresh: false,
  };
}
export function findAiProviderDefinition(
  providerId: string,
): AiProviderDefinition | undefined {
  return createAiProviderRegistry().find(
    (provider) => provider.id === providerId,
  );
}

function toDefinition(provider: Provider): AiProviderDefinition {
  const override = overrides[provider.id];
  const supportedAuthModes: AiAuthMode[] = [];
  if (provider.auth.apiKey?.login) supportedAuthModes.push("api_key");
  if (provider.auth.oauth) supportedAuthModes.push("oauth");
  if (provider.auth.apiKey) supportedAuthModes.push("ambient");

  const setupInstructions =
    override?.setupInstructions ?? defaultInstructions(provider);
  return {
    id: provider.id,
    name: provider.name,
    kind: "built_in",
    protocol: null,
    baseUrl: provider.baseUrl ?? null,
    revision: 0,
    supportedAuthModes,
    acceptsAdminApiKey: Boolean(provider.auth.apiKey?.login),
    configFields: override?.configFields ?? [],
    setupInstructions,
    supportsModelRefresh: Boolean(provider.refreshModels),
  };
}

function defaultInstructions(provider: Provider): readonly string[] {
  const instructions: string[] = [];
  if (provider.auth.apiKey?.login) {
    instructions.push("可以在此保存 API Key，也可以由 API 主机环境变量提供。");
  } else if (provider.auth.apiKey) {
    instructions.push("认证由 API 主机环境提供，Admin 不保存原始凭据。");
  }
  if (provider.auth.oauth) {
    instructions.push("OAuth 需要在 API 主机执行 ai:auth 命令。");
  }
  return instructions;
}
