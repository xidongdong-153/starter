import type { AddressInfo } from "node:net";
import type { ServerResponse } from "node:http";
import { createServer } from "node:http";

import type { CredentialStore } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai";
import { customAiProviderDefinitionSchema } from "@starter/contracts";
import { describe, expect, it, vi } from "vitest";

import { createAiGateway } from "./ai-gateway.js";
import { createPiNativeStreamFn } from "./pi-native-stream.js";
import { createCustomAiProvider } from "./custom-provider.factory.js";

const modelInput = {
  modelId: "fake-model",
  name: "Fake Model",
  contextWindow: 32_000,
  maxOutputTokens: 1_024,
  supportsImageInput: false,
  supportsReasoning: false,
  supportsTools: false,
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheWriteCost: 0,
};

type Protocol =
  "openai-completions" | "openai-responses" | "anthropic-messages";
type Mode = "success" | "auth" | "timeout" | "upstream";

const protocols: readonly Protocol[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
];

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

describe("custom Provider real protocol streams", () => {
  it.each(protocols)("%s 成功流经过真实 fake upstream", async (protocol) => {
    const upstream = await startFakeUpstream(protocol, "success");
    try {
      const { gateway, model } = createGateway(protocol, upstream.url);
      const events = await collect(gateway.stream(gatewayInput(model)));

      expect(events.map((event) => event.type)).toContain("text_delta");
      expect(events.at(-1)).toMatchObject({
        type: "completed",
        stopReason: "stop",
      });
      expect(events.some((event) => event.type === "completed")).toBe(true);
    } finally {
      await upstream.close();
    }
  });

  it("custom model 复用 Pi native stream 的 agent_run 审计", async () => {
    const upstream = await startFakeUpstream("openai-completions", "success");
    try {
      const { model, models } = createGateway(
        "openai-completions",
        upstream.url,
      );
      const audit = {
        beginModelCall: vi.fn(() => "custom-agent-call"),
        finalizeModelCall: vi.fn(),
      };
      const streamFn = createPiNativeStreamFn({
        models,
        timeoutMs: 1_000,
        runId: "custom-run",
        userId: "custom-user",
        requestId: "custom-request",
        audit,
      });
      const sdkModel = models.getModel(model.providerId, model.modelId)!;
      const events = await collect(streamFn(sdkModel, { messages: [] }));

      expect(events.at(-1)).toMatchObject({ type: "done", reason: "stop" });
      expect(audit.beginModelCall).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "custom-run",
          model,
        }),
      );
      expect(audit.finalizeModelCall).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "custom-agent-call",
          result: "succeeded",
        }),
      );
    } finally {
      await upstream.close();
    }
  });

  it.each(protocols)(
    "%s auth failure is exposed as a safe error event",
    async (protocol) => {
      const upstream = await startFakeUpstream(protocol, "auth");
      try {
        const { gateway, model } = createGateway(protocol, upstream.url);
        await expect(
          collect(gateway.stream(gatewayInput(model))),
        ).rejects.toMatchObject({
          kind: "auth",
        });
      } finally {
        await upstream.close();
      }
    },
  );

  it.each(protocols)(
    "%s timeout failure is surfaced without hanging",
    async (protocol) => {
      const upstream = await startFakeUpstream(protocol, "timeout");
      try {
        const { gateway, model } = createGateway(protocol, upstream.url);
        const failure = collect(
          gateway.stream({ ...gatewayInput(model), timeoutMs: 30 }),
        );
        await expect(failure).rejects.toMatchObject({ kind: "timeout" });
      } finally {
        await upstream.close();
      }
    },
  );

  it.each(protocols)(
    "%s upstream failure is surfaced without raw payload",
    async (protocol) => {
      const upstream = await startFakeUpstream(protocol, "upstream");
      try {
        const { gateway, model } = createGateway(protocol, upstream.url);
        let failure: unknown;
        try {
          await collect(gateway.stream(gatewayInput(model)));
        } catch (error) {
          failure = error;
        }

        expect(failure).toMatchObject({ kind: "upstream" });
        expect(JSON.stringify(failure)).not.toContain("upstream-secret");
      } finally {
        await upstream.close();
      }
    },
  );
});

function createGateway(protocol: Protocol, baseUrl: string) {
  const provider = createProvider(protocol, baseUrl);
  const credential = { type: "api_key" as const, key: "test-api-key" };
  const credentials: CredentialStore = {
    async read() {
      return credential;
    },
    async list() {
      return [];
    },
    async modify(_providerId, update) {
      return update(credential);
    },
    async delete() {},
  };
  const models = createModels({ credentials });
  models.setProvider(provider);
  return {
    gateway: createAiGateway(models, 1_000),
    model: { providerId: provider.id, modelId: modelInput.modelId },
    models,
  };
}

function gatewayInput(model: { providerId: string; modelId: string }) {
  return {
    model,
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: "hello",
            turnIndex: 0,
            contentIndex: 0,
            blockId: "0:0",
          },
        ],
      },
    ],
    turnIndex: 0,
  };
}

function createProvider(protocol: Protocol, baseUrl: string) {
  const definition = customAiProviderDefinitionSchema.parse({
    providerId: `fake-${protocol}`,
    name: "Fake Provider",
    protocol,
    baseUrl,
    compat: {},
    models: [modelInput],
  });
  return createCustomAiProvider(definition, {
    appEnv: "test",
    timeoutMs: 250,
  });
}

async function startFakeUpstream(
  protocol: Protocol,
  mode: Mode,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    if (mode === "timeout") return;
    if (mode === "auth") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "upstream-secret" }));
      return;
    }
    if (mode === "upstream") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "upstream-secret" }));
      return;
    }

    if (protocol === "openai-completions") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      writeSse(response, {
        id: "chatcmpl-fake",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "hello" },
            finish_reason: null,
          },
        ],
      });
      writeSse(response, {
        id: "chatcmpl-fake",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      });
      response.end("data: [DONE]\n\n");
      return;
    }

    if (protocol === "openai-responses") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      writeEventSse(response, "response.created", {
        type: "response.created",
        response: { id: "resp-fake", output: [], status: "in_progress" },
      });
      writeEventSse(response, "response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "msg-fake",
          type: "message",
          role: "assistant",
          content: [],
        },
      });
      writeEventSse(response, "response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "hello",
      });
      writeEventSse(response, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: "msg-fake",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        },
      });
      writeEventSse(response, "response.completed", {
        type: "response.completed",
        response: {
          id: "resp-fake",
          status: "completed",
          output: [
            {
              id: "msg-fake",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "hello" }],
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        },
      });
      response.end();
      return;
    }

    response.writeHead(200, { "content-type": "text/event-stream" });
    writeEventSse(response, "message_start", {
      type: "message_start",
      message: {
        id: "msg-fake",
        type: "message",
        role: "assistant",
        content: [],
        model: "fake-model",
        stop_reason: null,
        usage: { input_tokens: 2, output_tokens: 0 },
      },
    });
    writeEventSse(response, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    writeEventSse(response, "content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hello" },
    });
    writeEventSse(response, "content_block_stop", {
      type: "content_block_stop",
      index: 0,
    });
    writeEventSse(response, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    });
    writeEventSse(response, "message_stop", { type: "message_stop" });
    response.end();
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

function writeSse(response: ServerResponse, data: unknown): void {
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeEventSse(
  response: ServerResponse,
  event: string,
  data: unknown,
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
