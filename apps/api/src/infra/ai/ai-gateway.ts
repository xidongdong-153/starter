import type { Models, StopReason } from "@earendil-works/pi-ai";
import { ModelsError } from "@earendil-works/pi-ai";

import type { AiModelRef } from "@starter/contracts";

export type AiGatewayEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "done";
      stopReason: "stop" | "length" | "tool_use";
      usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    };

export type AiGatewayErrorKind =
  "aborted" | "auth" | "model_not_found" | "timeout" | "upstream";

export class AiGatewayError extends Error {
  constructor(readonly kind: AiGatewayErrorKind) {
    super(`AI gateway error: ${kind}`);
    this.name = "AiGatewayError";
  }
}

export interface AiGateway {
  stream: (input: {
    model: AiModelRef;
    prompt: string;
    signal?: AbortSignal;
  }) => AsyncGenerator<AiGatewayEvent>;
}

export function createAiGateway(
  models: Models,
  timeoutMs: number,
  getProviderRequestEnv: (
    providerId: string,
  ) => Record<string, string> = () => ({}),
): AiGateway {
  return {
    async *stream(input) {
      const model = models.getModel(
        input.model.providerId,
        input.model.modelId,
      );
      if (!model) throw new AiGatewayError("model_not_found");

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signals = input.signal
        ? [input.signal, timeoutSignal]
        : [timeoutSignal];
      const signal = AbortSignal.any(signals);
      let completed = false;

      try {
        const stream = models.streamSimple(
          model,
          {
            messages: [
              { role: "user", content: input.prompt, timestamp: Date.now() },
            ],
          },
          {
            signal,
            env: getProviderRequestEnv(input.model.providerId),
            timeoutMs,
            maxRetries: 0,
            maxTokens: Math.min(model.maxTokens, 2048),
          },
        );

        for await (const event of stream) {
          if (event.type === "text_delta") {
            yield { type: "text_delta", text: event.delta };
          } else if (event.type === "done") {
            completed = true;
            yield {
              type: "done",
              stopReason: normalizeStopReason(event.reason),
              usage: {
                inputTokens: event.message.usage.input,
                outputTokens: event.message.usage.output,
                totalTokens: event.message.usage.totalTokens,
              },
            };
          } else if (event.type === "error") {
            if (timeoutSignal.aborted) throw new AiGatewayError("timeout");
            if (input.signal?.aborted || event.reason === "aborted")
              throw new AiGatewayError("aborted");
            throw new AiGatewayError("upstream");
          }
        }
        if (!completed) throw new AiGatewayError("upstream");
      } catch (error) {
        if (error instanceof AiGatewayError) throw error;
        if (timeoutSignal.aborted) throw new AiGatewayError("timeout");
        if (input.signal?.aborted || isAbortError(error))
          throw new AiGatewayError("aborted");
        if (
          error instanceof ModelsError &&
          (error.code === "auth" || error.code === "oauth")
        ) {
          throw new AiGatewayError("auth");
        }
        throw new AiGatewayError("upstream");
      }
    },
  };
}

function normalizeStopReason(
  reason: StopReason,
): "stop" | "length" | "tool_use" {
  if (reason === "length") return "length";
  if (reason === "toolUse") return "tool_use";
  return "stop";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
