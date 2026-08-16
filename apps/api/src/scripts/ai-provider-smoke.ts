import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { createRuntime } from "@api/app.js";
import type { AiGateway } from "@api/infra/ai/index.js";
import { AiGatewayError } from "@api/infra/ai/index.js";
import { parseEnv } from "@api/shared/env.js";

interface AiProviderSmokeOutput {
  error: (message: string) => void;
  log: (message: string) => void;
}

interface AiProviderSmokeDeps {
  /** 测试时替换 Gateway，不访问真实上游 */
  aiGateway?: AiGateway;
  signal?: AbortSignal;
}

/**
 * smoke 专用选择变量，不进入通用 AppEnv。
 * Provider 凭据继续使用 pi-ai 原生环境变量或 Admin 保存的加密 credential，
 * runner 不接收、不打印任何 secret。
 */
const smokeEnvSchema = z.object({
  AI_SMOKE_PROVIDER_ID: z.string().trim().min(1).max(80),
  AI_SMOKE_MODEL_ID: z.string().trim().min(1).max(240),
  AI_SMOKE_PROMPT: z.string().trim().min(1).max(8000),
  AI_SMOKE_CHECK_AUTH: z.stringbool().optional().default(false),
  AI_SMOKE_REFRESH_MODELS: z.stringbool().optional().default(false),
  AI_SMOKE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .optional(),
});

export async function runAiProviderSmoke(
  input: NodeJS.ProcessEnv = process.env,
  output: AiProviderSmokeOutput = console,
  deps: AiProviderSmokeDeps = {},
): Promise<0 | 1> {
  let runtime: ReturnType<typeof createRuntime> | undefined;
  try {
    const smoke = smokeEnvSchema.parse(input);
    const env = parseEnv(input);
    runtime = createRuntime(input, { aiGateway: deps.aiGateway });
    await runtime.ai.ensureReady();

    const provider = runtime.ai.providers.find(
      (item) => item.id === smoke.AI_SMOKE_PROVIDER_ID,
    );
    if (!provider) throw new Error("Provider 不在 registry 中");
    output.log(
      `provider=${provider.id} model=${smoke.AI_SMOKE_MODEL_ID} event=start`,
    );

    if (smoke.AI_SMOKE_CHECK_AUTH) {
      const auth = await runtime.ai.checkAuth(provider.id, deps.signal);
      if (!auth.source) throw new Error("认证未配置或不可用");
      output.log(
        `provider=${provider.id} auth_source=${auth.source} credential_type=${auth.credentialType ?? "null"}`,
      );
    }

    if (smoke.AI_SMOKE_REFRESH_MODELS) {
      if (!provider.supportsModelRefresh) {
        output.log(`provider=${provider.id} models_refresh=skipped`);
      } else {
        await runtime.ai.refreshModels(provider.id, deps.signal);
        output.log(`provider=${provider.id} models_refresh=done`);
      }
    }

    const model = runtime.ai
      .listModels(provider.id)
      .find((item) => item.modelId === smoke.AI_SMOKE_MODEL_ID);
    if (!model) throw new Error("Model 不在该 Provider 的目录中");

    const startedAt = Date.now();
    const gatewayInput = {
      model: { providerId: provider.id, modelId: model.modelId },
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: smoke.AI_SMOKE_PROMPT,
              turnIndex: 0,
              contentIndex: 0,
              blockId: "0:0",
            },
          ],
          timestamp: Date.now(),
        },
      ],
      turnIndex: 0,
      timeoutMs: smoke.AI_SMOKE_TIMEOUT_MS ?? env.AI_REQUEST_TIMEOUT_MS,
      signal: deps.signal,
    };

    let textDeltas = 0;
    let toolCalls = 0;
    let stopReason: string | null = null;
    let usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
    } | null = null;
    try {
      for await (const event of runtime.aiGateway.stream(gatewayInput)) {
        if (event.type === "text_delta") {
          textDeltas += 1;
        } else if (event.type === "tool_call_completed") {
          toolCalls += 1;
        } else if (event.type === "completed") {
          stopReason = event.stopReason;
          usage = event.usage;
        }
      }
    } catch (error) {
      const category = classifyError(error);
      output.log(
        `provider=${provider.id} model=${model.modelId} event=error error=${category}`,
      );
      return 1;
    }
    if (!stopReason) {
      output.log(
        `provider=${provider.id} model=${model.modelId} event=error error=upstream_failed`,
      );
      return 1;
    }

    const durationMs = Date.now() - startedAt;
    output.log(
      `provider=${provider.id} model=${model.modelId} event=text_delta count=${textDeltas}`,
    );
    output.log(
      `provider=${provider.id} model=${model.modelId} event=done stop_reason=${stopReason} input_tokens=${usage?.inputTokens ?? "null"} output_tokens=${usage?.outputTokens ?? "null"} total_tokens=${usage?.totalTokens ?? "null"} duration_ms=${durationMs}${toolCalls > 0 ? ` tool_calls=${toolCalls}` : ""}`,
    );
    output.log("result=success");
    return 0;
  } catch (error) {
    if (error instanceof z.ZodError) {
      output.error("缺少或无效的 AI smoke 环境变量");
    } else if (
      error instanceof Error &&
      /no such table:/iu.test(error.message)
    ) {
      output.error(
        "AI 配置表不存在，请先运行 pnpm --filter @starter/api db:migrate",
      );
    } else {
      output.error(
        error instanceof Error ? error.message : "AI smoke 执行失败",
      );
    }
    return 1;
  } finally {
    runtime?.database.sqlite.close();
  }
}

function classifyError(error: unknown): string {
  if (error instanceof AiGatewayError) {
    switch (error.kind) {
      case "auth":
        return "auth_failed";
      case "timeout":
        return "upstream_timeout";
      case "aborted":
        return "aborted";
      case "model_not_found":
        return "model_not_found";
      default:
        return "upstream_failed";
    }
  }
  return "upstream_failed";
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  process.exitCode = await runAiProviderSmoke();
}
