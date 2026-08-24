import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";

import { ApiErrorCodes } from "@starter/contracts";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  aiAgentDefinitions,
  aiCustomProviders,
  aiEnabledModels,
  aiModelCalls,
  aiProviderConfigs,
  aiSettings,
} from "@api/infra/db/schema/index.js";
import { createAuthorizationRepository } from "@api/modules/authorization/index.js";

import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

type Protocol =
  "openai-completions" | "openai-responses" | "anthropic-messages";

const protocols: readonly Protocol[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
];

const systemContext = {
  actorType: "system",
  actorId: "test:custom-provider-integration",
  requestId: null,
} as const;

const model = {
  modelId: "integration-model",
  name: "Integration Model",
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

it.each(protocols)(
  "%s 通过 Admin 生命周期、模型测试和 Agent Run，并写入 agent_run 审计",
  async (protocol) => {
    const upstream = await startFakeUpstream(protocol);
    const { app, cleanup, runtime } = createTestApp();
    const providerId = `integration-${protocol}`;
    const modelRef = { providerId, modelId: model.modelId };

    try {
      const admin = await register(app, `${providerId}-admin@example.com`);
      const user = await register(app, `${providerId}-user@example.com`);
      expect(
        createAuthorizationRepository(runtime.db).bootstrapAdminByEmail(
          `${providerId}-admin@example.com`,
          systemContext,
        ).kind,
      ).toBe("ok");

      const createResponse = await app.request(
        "/api/ai/admin/custom-providers",
        {
          method: "POST",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            providerId,
            name: `Integration ${protocol}`,
            protocol,
            baseUrl: upstream.url,
            compat: {},
            models: [model],
            apiKey: `${providerId}-secret`,
          }),
        },
      );
      expect(createResponse.status).toBe(200);
      const created = await readSuccess<{
        revision: number;
        enabled: boolean;
        authStatus: string;
      }>(createResponse);
      expect(created.data).toMatchObject({
        revision: 1,
        enabled: false,
        authStatus: "needs_check",
      });
      expect(JSON.stringify(created)).not.toContain(`${providerId}-secret`);

      const checkResponse = await app.request(
        `/api/ai/admin/custom-providers/${providerId}/check`,
        {
          method: "POST",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ expectedRevision: created.data.revision }),
        },
      );
      expect(checkResponse.status).toBe(200);
      const checked = await readSuccess<{
        revision: number;
        enabled: boolean;
        authStatus: string;
      }>(checkResponse);
      expect(checked.data).toMatchObject({
        revision: 1,
        enabled: false,
        authStatus: "ready",
      });

      const enableResponse = await app.request(
        `/api/ai/admin/custom-providers/${providerId}/state`,
        {
          method: "PUT",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ enabled: true }),
        },
      );
      expect(enableResponse.status).toBe(200);
      expect(
        (await readSuccess<{ enabled: boolean }>(enableResponse)).data.enabled,
      ).toBe(true);

      const allowlistResponse = await app.request("/api/ai/admin/models", {
        method: "PUT",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ models: [modelRef] }),
      });
      expect(allowlistResponse.status).toBe(200);

      const defaultResponse = await app.request("/api/ai/admin/default-model", {
        method: "PUT",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: modelRef }),
      });
      expect(defaultResponse.status).toBe(200);

      const userModelsResponse = await app.request("/api/ai/models", {
        headers: { cookie: user.cookie },
      });
      expect(userModelsResponse.status).toBe(200);
      expect(
        (
          await readSuccess<Array<{ providerId: string; modelId: string }>>(
            userModelsResponse,
          )
        ).data,
      ).toEqual([expect.objectContaining(modelRef)]);

      const modelTestResponse = await app.request("/api/ai/test", {
        method: "POST",
        headers: {
          cookie: user.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: modelRef, prompt: "integration test" }),
      });
      expect(modelTestResponse.status).toBe(200);
      const modelTestBody = await modelTestResponse.text();
      expect(modelTestBody).toContain('"type":"done"');
      expect(modelTestBody).not.toContain(`${providerId}-secret`);
      expect(modelTestBody).not.toContain("integration test");

      const promptResponse = await app.request("/api/ai/system-prompts", {
        method: "POST",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `${providerId}-prompt`,
          content: "只返回事实。",
        }),
      });
      expect(promptResponse.status).toBe(200);
      const prompt = await readSuccess<{ id: string }>(promptResponse);

      const agentResponse = await app.request("/api/ai/admin/agents", {
        method: "POST",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `${providerId}-agent`,
          config: {
            schemaVersion: 1,
            model: modelRef,
            systemPromptId: prompt.data.id,
            skillIds: [],
            toolNames: [],
            thinkingLevel: "off",
            maxTurns: 1,
          },
        }),
      });
      expect(agentResponse.status).toBe(200);
      const agent = await readSuccess<{ id: string }>(agentResponse);
      const enableAgentResponse = await app.request(
        `/api/ai/admin/agents/${agent.data.id}/status`,
        {
          method: "PATCH",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "enabled" }),
        },
      );
      expect(enableAgentResponse.status).toBe(200);

      const sessionResponse = await app.request("/api/ai/sessions", {
        method: "POST",
        headers: {
          cookie: user.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Custom Provider Run" }),
      });
      expect(sessionResponse.status).toBe(200);
      const session = await readSuccess<{ id: string }>(sessionResponse);

      const runResponse = await app.request(
        `/api/ai/sessions/${session.data.id}/runs`,
        {
          method: "POST",
          headers: {
            cookie: user.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ agentId: agent.data.id, input: "run input" }),
        },
      );
      expect(runResponse.status).toBe(200);
      const runBody = await runResponse.text();
      expect(runBody).toContain('"type":"run.completed"');
      expect(runBody).not.toContain(`${providerId}-secret`);

      const agentCall = runtime.db
        .select()
        .from(aiModelCalls)
        .where(
          and(
            eq(aiModelCalls.scenario, "agent_run"),
            eq(aiModelCalls.providerId, providerId),
            eq(aiModelCalls.modelId, model.modelId),
          ),
        )
        .get();
      expect(agentCall).toMatchObject({
        providerId,
        modelId: model.modelId,
        scenario: "agent_run",
        result: "succeeded",
      });
      expect(JSON.stringify(agentCall)).not.toContain(`${providerId}-secret`);

      const disableResponse = await app.request(
        `/api/ai/admin/custom-providers/${providerId}/state`,
        {
          method: "PUT",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ enabled: false }),
        },
      );
      expect(disableResponse.status).toBe(200);
      expect(
        (await readSuccess<{ enabled: boolean }>(disableResponse)).data.enabled,
      ).toBe(false);
      expect(
        (
          await readSuccess<Array<unknown>>(
            await app.request("/api/ai/models", {
              headers: { cookie: user.cookie },
            }),
          )
        ).data,
      ).toEqual([]);

      const blockedDelete = await app.request(
        `/api/ai/admin/custom-providers/${providerId}`,
        {
          method: "DELETE",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ expectedRevision: 1 }),
        },
      );
      expect(blockedDelete.status).toBe(409);
      expect((await readFailure(blockedDelete)).error.code).toBe(
        ApiErrorCodes.AI_CUSTOM_PROVIDER_IN_USE,
      );

      const disableAgentResponse = await app.request(
        `/api/ai/admin/agents/${agent.data.id}/status`,
        {
          method: "PATCH",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "disabled" }),
        },
      );
      expect(disableAgentResponse.status).toBe(200);
      const clearReferenceResponse = await app.request(
        `/api/ai/admin/agents/${agent.data.id}`,
        {
          method: "PATCH",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            config: {
              schemaVersion: 1,
              model: null,
              systemPromptId: null,
              skillIds: [],
              toolNames: [],
              thinkingLevel: "off",
              maxTurns: 1,
            },
          }),
        },
      );
      expect(clearReferenceResponse.status).toBe(200);

      const deleteResponse = await app.request(
        `/api/ai/admin/custom-providers/${providerId}`,
        {
          method: "DELETE",
          headers: {
            cookie: admin.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ expectedRevision: 1 }),
        },
      );
      expect(deleteResponse.status).toBe(204);
      expect(
        runtime.db
          .select()
          .from(aiCustomProviders)
          .where(eq(aiCustomProviders.providerId, providerId))
          .get(),
      ).toBeUndefined();
      expect(
        runtime.db
          .select()
          .from(aiProviderConfigs)
          .where(eq(aiProviderConfigs.providerId, providerId))
          .get(),
      ).toBeUndefined();
      expect(
        runtime.db
          .select()
          .from(aiEnabledModels)
          .where(eq(aiEnabledModels.providerId, providerId))
          .all(),
      ).toEqual([]);
      expect(
        runtime.db
          .select()
          .from(aiSettings)
          .all()
          .every(
            (row) =>
              row.globalProviderId !== providerId &&
              row.globalModelId !== model.modelId,
          ),
      ).toBe(true);
      expect(
        (
          await readSuccess<Array<unknown>>(
            await app.request("/api/ai/admin/custom-providers", {
              headers: { cookie: admin.cookie },
            }),
          )
        ).data,
      ).toEqual([]);
      expect(
        runtime.db
          .select()
          .from(aiAgentDefinitions)
          .where(eq(aiAgentDefinitions.id, agent.data.id))
          .get(),
      ).toBeDefined();
    } finally {
      cleanup();
      await upstream.close();
    }
  },
);

async function startFakeUpstream(
  protocol: Protocol,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    if (protocol === "openai-completions") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      writeSse(response, {
        id: "chatcmpl-integration",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "integration answer" },
            finish_reason: null,
          },
        ],
      });
      writeSse(response, {
        id: "chatcmpl-integration",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      });
      response.end("data: [DONE]\n\n");
      return;
    }

    if (protocol === "openai-responses") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      writeEventSse(response, "response.created", {
        type: "response.created",
        response: {
          id: "response-integration",
          output: [],
          status: "in_progress",
        },
      });
      writeEventSse(response, "response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "message-integration",
          type: "message",
          role: "assistant",
          content: [],
        },
      });
      writeEventSse(response, "response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "integration answer",
      });
      writeEventSse(response, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: "message-integration",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "integration answer" }],
        },
      });
      writeEventSse(response, "response.completed", {
        type: "response.completed",
        response: {
          id: "response-integration",
          status: "completed",
          output: [
            {
              id: "message-integration",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "integration answer" }],
            },
          ],
          usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
        },
      });
      response.end();
      return;
    }

    response.writeHead(200, { "content-type": "text/event-stream" });
    writeEventSse(response, "message_start", {
      type: "message_start",
      message: {
        id: "message-integration",
        type: "message",
        role: "assistant",
        content: [],
        model: "integration-model",
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
      delta: { type: "text_delta", text: "integration answer" },
    });
    writeEventSse(response, "content_block_stop", {
      type: "content_block_stop",
      index: 0,
    });
    writeEventSse(response, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 2 },
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
