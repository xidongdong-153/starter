import type {
  Api,
  ApiKeyCredential,
  Model,
  Provider,
  ProviderStreams,
} from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

import type {
  CustomAiProviderDefinition,
  CustomAiProviderModel,
} from "@starter/contracts";

import type { AiUrlGuardOptions } from "./ai-url-guard.js";
import { createAiUrlGuard } from "./ai-url-guard.js";

export class AiCustomProviderProtocolError extends Error {
  constructor(protocol: string) {
    super(`Unsupported custom AI Provider protocol: ${protocol}`);
    this.name = "AiCustomProviderProtocolError";
  }
}

export function createCustomAiProvider(
  definition: CustomAiProviderDefinition,
  guardOptions: AiUrlGuardOptions = {},
): Provider {
  const guard = createAiUrlGuard(guardOptions);
  switch (definition.protocol) {
    case "openai-completions":
      return createTypedProvider(
        definition,
        "openai-completions",
        openAICompletionsApi(),
        guard.fetch,
      );
    case "openai-responses":
      return createTypedProvider(
        definition,
        "openai-responses",
        openAIResponsesApi(),
        guard.fetch,
      );
    case "anthropic-messages":
      return createTypedProvider(
        definition,
        "anthropic-messages",
        anthropicMessagesApi(),
        guard.fetch,
      );
    default:
      return assertNever(definition);
  }
}

function createTypedProvider<TApi extends Api>(
  definition: CustomAiProviderDefinition & { protocol: TApi },
  api: TApi,
  streams: ProviderStreams,
  fetch: typeof globalThis.fetch,
): Provider<TApi> {
  return createProvider<TApi>({
    id: definition.providerId,
    name: definition.name,
    baseUrl: definition.baseUrl,
    auth: {
      apiKey: {
        name: `${definition.name} API key`,
        resolve: async ({ credential, signal }) => {
          signal.throwIfAborted();
          const key = (credential as ApiKeyCredential | undefined)?.key;
          return key
            ? { auth: { apiKey: key }, source: "stored credential" }
            : { auth: {}, source: "keyless" };
        },
      },
    },
    models: definition.models.map((model) => toPiModel(definition, model, api)),
    api: withGuardedFetch(streams, fetch),
  });
}

function toPiModel<TApi extends Api>(
  definition: CustomAiProviderDefinition & { protocol: TApi },
  model: CustomAiProviderModel,
  api: TApi,
): Model<TApi> {
  return {
    id: model.modelId,
    name: model.name,
    api,
    provider: definition.providerId,
    baseUrl: definition.baseUrl,
    reasoning: model.supportsReasoning,
    input: model.supportsImageInput ? ["text", "image"] : ["text"],
    cost: {
      input: model.inputCost,
      output: model.outputCost,
      cacheRead: model.cacheReadCost,
      cacheWrite: model.cacheWriteCost,
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutputTokens,
    compat: definition.compat,
    supportsTools: model.supportsTools,
  } as Model<TApi> & { supportsTools: boolean };
}

function withGuardedFetch(
  streams: ProviderStreams,
  fetch: typeof globalThis.fetch,
): ProviderStreams {
  return {
    stream(model, context, options) {
      return streams.stream(model, context, { ...options, fetch });
    },
    streamSimple(model, context, options) {
      return streams.streamSimple(model, context, { ...options, fetch });
    },
  };
}
function assertNever(value: never): never {
  throw new AiCustomProviderProtocolError(String(value));
}
