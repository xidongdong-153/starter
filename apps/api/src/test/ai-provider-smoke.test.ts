import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AiGateway,
  AiGatewayEvent,
  AiGatewayInput,
} from "@api/infra/ai/index.js";
import { AiGatewayError } from "@api/infra/ai/index.js";
import { createRuntime } from "@api/app.js";
import { createDatabase } from "@api/infra/db/client.js";
import { aiModelCalls, aiToolExecutions } from "@api/infra/db/schema/index.js";
import { runAiProviderSmoke } from "@api/scripts/ai-provider-smoke.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it, vi } from "vitest";

const migrationFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../infra/db/migrations",
);

const promptMarker = "SMOKE_PROMPT_MARKER_9f2c";
const responseMarker = "SMOKE_RESPONSE_MARKER_4a1d";

const usage = {
  inputTokens: 3,
  outputTokens: 5,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: 8,
} as const;

function completedEvent(
  text = "hello",
): Extract<AiGatewayEvent, { type: "completed" }> {
  return {
    type: "completed",
    turnIndex: 0,
    assistantMessage: {
      role: "assistant",
      blocks: [
        { type: "text", text, turnIndex: 0, contentIndex: 0, blockId: "0:0" },
      ],
    },
    stopReason: "stop",
    usage,
    cost: null,
  };
}

function successfulGateway(captured: AiGatewayInput[] = []): AiGateway {
  return {
    async *stream(input) {
      captured.push(input);
      yield {
        type: "text_delta",
        text: responseMarker,
        turnIndex: 0,
        contentIndex: 0,
        blockId: "0:0",
      };
      yield completedEvent(responseMarker);
    },
  };
}

function setup() {
  const testDir = mkdtempSync(join(tmpdir(), "starter-ai-smoke-"));
  const env: NodeJS.ProcessEnv = {
    APP_ENV: "test",
    BETTER_AUTH_SECRET: "smoke-secret-at-least-32-characters-long",
    DATABASE_PATH: join(testDir, "smoke.db"),
    AI_CREDENTIAL_ENCRYPTION_KEY:
      "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    AI_SMOKE_PROVIDER_ID: "openai",
    AI_SMOKE_MODEL_ID: "",
    AI_SMOKE_PROMPT: promptMarker,
  };
  const database = createDatabase(env.DATABASE_PATH!);
  migrate(database.db, { migrationsFolder: migrationFolder });
  database.sqlite.close();

  const probe = createRuntime(env);
  const model = probe.ai.listModels("openai")[0];
  env.AI_SMOKE_MODEL_ID = model?.modelId ?? "";
  probe.database.sqlite.close();

  const cleanup = () => {
    rmSync(testDir, { recursive: true, force: true });
  };
  return { cleanup, env };
}

it("success：真实文本流成功并只输出安全摘要，不写审计表", async () => {
  const { cleanup, env } = setup();
  try {
    const captured: AiGatewayInput[] = [];
    const output = { log: vi.fn(), error: vi.fn() };
    const exitCode = await runAiProviderSmoke(env, output, {
      aiGateway: successfulGateway(captured),
    });

    expect(exitCode).toBe(0);
    const lines = output.log.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^provider=openai model=.+ event=start$/),
        expect.stringMatching(
          /^provider=openai model=.+ event=text_delta count=1$/,
        ),
        expect.stringMatching(
          /^provider=openai model=.+ event=done stop_reason=stop input_tokens=3 output_tokens=5 total_tokens=8 duration_ms=\d+$/,
        ),
        "result=success",
      ]),
    );
    expect(output.error).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.model.modelId).toBe(env.AI_SMOKE_MODEL_ID);
    expect(JSON.stringify(output.log.mock.calls)).not.toContain(promptMarker);
    expect(JSON.stringify(output.log.mock.calls)).not.toContain(responseMarker);

    const database = createDatabase(env.DATABASE_PATH!);
    try {
      expect(database.db.select().from(aiModelCalls).all()).toEqual([]);
      expect(database.db.select().from(aiToolExecutions).all()).toEqual([]);
    } finally {
      database.sqlite.close();
    }
  } finally {
    cleanup();
  }
});

it("上游分类：auth、timeout、aborted、upstream 分别映射稳定错误码", async () => {
  const { cleanup, env } = setup();
  try {
    const cases = [
      { kind: "auth" as const, expected: "auth_failed" },
      { kind: "timeout" as const, expected: "upstream_timeout" },
      { kind: "upstream" as const, expected: "upstream_failed" },
    ];
    for (const item of cases) {
      const output = { log: vi.fn(), error: vi.fn() };
      const exitCode = await runAiProviderSmoke(env, output, {
        aiGateway: {
          async *stream() {
            throw new AiGatewayError(item.kind);
          },
        },
      });
      expect(exitCode).toBe(1);
      expect(JSON.stringify(output.log.mock.calls)).toContain(
        `error=${item.expected}`,
      );
    }

    const controller = new AbortController();
    controller.abort();
    const output = { log: vi.fn(), error: vi.fn() };
    const exitCode = await runAiProviderSmoke(env, output, {
      aiGateway: {
        async *stream(input) {
          if (input.signal?.aborted) throw new AiGatewayError("aborted");
          yield completedEvent();
        },
      },
      signal: controller.signal,
    });
    expect(exitCode).toBe(1);
    expect(JSON.stringify(output.log.mock.calls)).toContain("error=aborted");
  } finally {
    cleanup();
  }
});

it("provider 或 model 不在 registry/catalog 时在请求前失败，Gateway 不被调用", async () => {
  const { cleanup, env } = setup();
  try {
    const stream = vi.fn(async function* () {});
    const gateway = { stream } as unknown as AiGateway;

    const badProvider = await runAiProviderSmoke(
      { ...env, AI_SMOKE_PROVIDER_ID: "not-a-provider" },
      { log: vi.fn(), error: vi.fn() },
      { aiGateway: gateway },
    );
    expect(badProvider).toBe(1);
    expect(stream).not.toHaveBeenCalled();

    const badModel = await runAiProviderSmoke(
      { ...env, AI_SMOKE_MODEL_ID: "no-such-model" },
      { log: vi.fn(), error: vi.fn() },
      { aiGateway: gateway },
    );
    expect(badModel).toBe(1);
    expect(stream).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

it("缺 smoke 变量或没有终态时失败，且错误输出不含 prompt", async () => {
  const { cleanup, env } = setup();
  try {
    const output = { log: vi.fn(), error: vi.fn() };
    const missing = await runAiProviderSmoke(
      { ...env, AI_SMOKE_PROMPT: "  " },
      output,
      { aiGateway: successfulGateway() },
    );
    expect(missing).toBe(1);
    expect(JSON.stringify(output.error.mock.calls)).toContain(
      "缺少或无效的 AI smoke 环境变量",
    );
    expect(JSON.stringify(output.error.mock.calls)).not.toContain(promptMarker);

    const noTerminal = await runAiProviderSmoke(env, output, {
      aiGateway: {
        async *stream() {
          yield {
            type: "text_delta",
            text: responseMarker,
            turnIndex: 0,
            contentIndex: 0,
            blockId: "0:0",
          };
        },
      },
    });
    expect(noTerminal).toBe(1);
    expect(JSON.stringify(output.log.mock.calls)).toContain(
      "error=upstream_failed",
    );
    expect(JSON.stringify(output.log.mock.calls)).not.toContain(promptMarker);
    expect(JSON.stringify(output.log.mock.calls)).not.toContain(responseMarker);
  } finally {
    cleanup();
  }
});

it("显式 checkAuth 但未配置凭据时返回配置说明", async () => {
  const { cleanup, env } = setup();
  try {
    const output = { log: vi.fn(), error: vi.fn() };
    const exitCode = await runAiProviderSmoke(
      { ...env, AI_SMOKE_CHECK_AUTH: "true" },
      output,
      { aiGateway: successfulGateway() },
    );
    expect(exitCode).toBe(1);
    expect(JSON.stringify(output.error.mock.calls)).toContain(
      "认证未配置或不可用",
    );
  } finally {
    cleanup();
  }
});
