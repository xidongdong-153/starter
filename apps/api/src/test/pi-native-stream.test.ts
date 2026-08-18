import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createPiNativeStreamFn } from "@api/infra/ai/pi-native-stream.js";
import { ApiErrorCodes } from "@starter/contracts";
import { describe, expect, it, vi } from "vitest";

const model: Model<Api> = {
  id: "native-model",
  name: "Native model",
  api: "openai-completions",
  provider: "native-provider",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_000,
  maxTokens: 1024,
};

function assistant(
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "safe answer" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 2,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 5,
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function modelsWith(
  streamSimple: Models["streamSimple"],
  getAuth: Models["getAuth"] = async () => ({
    auth: {},
    source: "test",
  }),
): Models {
  return {
    getAuth,
    streamSimple,
  } as unknown as Models;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

function audit() {
  return {
    beginModelCall: vi.fn(() => "model-call-1"),
    finalizeModelCall: vi.fn(),
  };
}

describe("pi native StreamFn", () => {
  it("通过 Models.streamSimple 返回原生 AssistantMessageEventStream，并完成 run 审计", async () => {
    const upstream = createAssistantMessageEventStream();
    upstream.push({ type: "start", partial: assistant("pending") });
    upstream.push({ type: "done", reason: "stop", message: assistant("stop") });
    const modelAudit = audit();
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(vi.fn(() => upstream)),
      timeoutMs: 1000,
      runId: "run-1",
      userId: "user-1",
      requestId: "request-1",
      audit: modelAudit,
    });

    const stream = streamFn(model, { messages: [] });
    const events = await collect(stream);

    expect(events.map((event) => event.type)).toEqual(["start", "done"]);
    expect(await stream.result()).toMatchObject({ stopReason: "stop" });
    expect(modelAudit.beginModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        userId: "user-1",
        requestId: "request-1",
        model: { providerId: model.provider, modelId: model.id },
      }),
    );
    expect(modelAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "model-call-1",
        result: "succeeded",
        stopReason: "stop",
      }),
    );
  });

  it("审计 begin 失败时仍返回 Provider 事件流", async () => {
    const upstream = createAssistantMessageEventStream();
    upstream.push({ type: "done", reason: "stop", message: assistant("stop") });
    const modelAudit = {
      beginModelCall: vi.fn(() => {
        throw new Error("sensitive-audit-error");
      }),
      finalizeModelCall: vi.fn(),
    };
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(vi.fn(() => upstream)),
      timeoutMs: 1000,
      runId: "run-audit-failure",
      userId: "user-audit-failure",
      requestId: "request-audit-failure",
      audit: modelAudit,
    });

    await expect(
      collect(streamFn(model, { messages: [] })),
    ).resolves.toMatchObject([{ type: "done", reason: "stop" }]);
    expect(modelAudit.finalizeModelCall).not.toHaveBeenCalled();
  });
  it("provider error、timeout 和 abort 都编码为安全 error event，不泄露原始错误", async () => {
    const errorMessage = assistant("error");
    errorMessage.errorMessage = "provider-secret-marker";
    const modelAudit = audit();
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(
        vi.fn(() => {
          throw new Error("provider-secret-marker");
        }),
      ),
      timeoutMs: 1000,
      runId: "run-2",
      userId: "user-2",
      requestId: "request-2",
      audit: modelAudit,
    });
    const errorEvents = await collect(streamFn(model, { messages: [] }));

    expect(JSON.stringify(errorEvents)).not.toContain("provider-secret-marker");
    expect(errorEvents).toMatchObject([
      {
        type: "error",
        reason: "error",
        error: { errorMessage: "模型请求失败" },
      },
    ]);
    expect(modelAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "upstream_failed",
        errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      }),
    );

    const timeoutAudit = audit();
    const never = createAssistantMessageEventStream();
    const timeoutFn = createPiNativeStreamFn({
      models: modelsWith(vi.fn(() => never)),
      timeoutMs: 10,
      runId: "run-3",
      userId: "user-3",
      requestId: "request-3",
      audit: timeoutAudit,
    });
    const timeoutEvents = await collect(timeoutFn(model, { messages: [] }));
    expect(timeoutEvents).toMatchObject([{ type: "error", reason: "aborted" }]);
    expect(timeoutAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "timed_out",
        errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
      }),
    );

    const abortAudit = audit();
    const abortController = new AbortController();
    const abortStream = createAssistantMessageEventStream();
    const abortFn = createPiNativeStreamFn({
      models: modelsWith(
        vi.fn(
          (
            _requestModel: Model<Api>,
            _context: Context,
            options?: SimpleStreamOptions,
          ) => {
            options?.signal?.addEventListener(
              "abort",
              () => {
                abortStream.push({
                  type: "done",
                  reason: "stop",
                  message: assistant("stop"),
                });
              },
              { once: true },
            );
            return abortStream;
          },
        ),
      ),
      timeoutMs: 1000,
      runId: "run-4",
      userId: "user-4",
      requestId: "request-4",
      audit: abortAudit,
    });
    const abortEventsPromise = collect(
      abortFn(model, { messages: [] }, { signal: abortController.signal }),
    );
    abortController.abort();
    expect(await abortEventsPromise).toMatchObject([
      { type: "error", reason: "aborted" },
    ]);
    expect(abortAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "cancelled",
        errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
      }),
    );
  });

  it("保留安全的 assistant partial content，同时过滤原始 Provider error", async () => {
    const upstream = createAssistantMessageEventStream();
    const partial = assistant("error");
    partial.errorMessage = "provider-secret-marker";
    upstream.push({ type: "start", partial });
    upstream.push({ type: "error", reason: "error", error: partial });
    const modelAudit = audit();
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(vi.fn(() => upstream)),
      timeoutMs: 1000,
      runId: "run-partial",
      userId: "user-partial",
      requestId: "request-partial",
      audit: modelAudit,
    });

    const events = await collect(streamFn(model, { messages: [] }));

    expect(JSON.stringify(events)).not.toContain("provider-secret-marker");
    expect(events).toMatchObject([
      { type: "start" },
      {
        type: "error",
        error: {
          content: [{ type: "text", text: "safe answer" }],
          errorMessage: "模型请求失败",
        },
      },
    ]);
  });

  it("timeout 先于后续 caller abort 时保留 timeout 终态", async () => {
    const modelAudit = audit();
    const controller = new AbortController();
    const laterAbort = setTimeout(() => controller.abort(), 50);
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(() => createAssistantMessageEventStream()),
      timeoutMs: 10,
      runId: "run-timeout-first",
      userId: "user-timeout-first",
      requestId: "request-timeout-first",
      audit: modelAudit,
    });

    try {
      await expect(
        collect(
          streamFn(model, { messages: [] }, { signal: controller.signal }),
        ),
      ).resolves.toMatchObject([{ type: "error", reason: "aborted" }]);
    } finally {
      clearTimeout(laterAbort);
    }
    expect(modelAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "timed_out",
        errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
      }),
    );
  });
});
