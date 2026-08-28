// Pipeline 编排集成测试：fake executor 假流复用 ai-agent-runs.test.ts 的写法，
// Bearer 客户端复用 ai-third-party-access.test.ts 的模式。
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  ApiErrorCodes,
  type AgentRun,
  type AgentTranscript,
  type PipelineDefinitionDetail,
  type PipelineDefinitionSummaryList,
  type PipelineRun,
  type PipelineRunAbort,
} from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { createPiAgentExecutor } from "@api/infra/agent/index.js";
import { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import { generateId } from "@api/shared/id.js";
import {
  aiAgentRuns,
  aiEnabledModels,
  aiModelCalls,
  aiPipelineRuns,
  aiProviderConfigs,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";
import { createAiOutputContractRegistry } from "@api/modules/ai/output/output-contract-registry.js";
import { createAiRunLifecycleRepository } from "@api/modules/ai/run/index.js";
import { createAiUsageAuditRepository } from "@api/modules/ai/usage-audit/usage-audit.repository.js";
import { createAiUsageAuditService } from "@api/modules/ai/usage-audit/usage-audit.service.js";

import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";
import { modelsWith } from "./ai-run-harness.js";

const model: Model<Api> = {
  id: "pipeline-model",
  name: "Pipeline model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 1024,
};

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamResponse(
  message: AssistantMessage,
  reason: Extract<
    AssistantMessage["stopReason"],
    "stop" | "length" | "toolUse" | "deferred"
  >,
): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const partial = assistantMessage([], "pending");
  stream.push({ type: "start", partial });
  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === "text") {
      stream.push({
        type: "text_delta",
        contentIndex,
        delta: block.text,
        partial: assistantMessage(
          message.content.slice(0, contentIndex + 1),
          "pending",
        ),
      });
    }
  }
  stream.push({ type: "done", reason, message });
  return stream;
}

function streamError(): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const partial = assistantMessage([], "error");
  stream.push({ type: "start", partial });
  stream.push({ type: "error", reason: "error", error: partial });
  return stream;
}

async function registerAdmin(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
) {
  const owner = await register(app, `pipeline-admin-${Date.now()}@example.com`);
  const adminRole = runtime.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "admin"))
    .get()!;
  const permissionKeys = ["ai:config:manage", "ai:config:read"];
  const permissionIds = permissionKeys.flatMap((key) =>
    runtime.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, key))
      .all(),
  );
  for (const permission of permissionIds) {
    runtime.db
      .insert(rolePermissions)
      .values({
        roleId: adminRole.id,
        permissionId: permission.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .onConflictDoNothing()
      .run();
  }
  runtime.db
    .update(userRoles)
    .set({ roleId: adminRole.id })
    .where(eq(userRoles.userId, owner.user.id))
    .run();
  return owner;
}

function seedModel(runtime: ReturnType<typeof createTestApp>["runtime"]): {
  providerId: string;
  modelId: string;
} {
  const modelRef = runtime.ai.listModels("openai")[0];
  if (!modelRef) throw new Error("测试模型目录为空");
  const now = new Date();
  runtime.db
    .insert(aiProviderConfigs)
    .values({
      providerId: modelRef.providerId,
      enabled: true,
      configRevision: 0,
      checkedConfigRevision: 0,
      authStatus: "ready",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  runtime.db
    .insert(aiEnabledModels)
    .values({
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
      enabledAt: now,
    })
    .onConflictDoNothing()
    .run();
  return { providerId: modelRef.providerId, modelId: modelRef.modelId };
}

async function postJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setupAgent(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
  admin: { cookie: string },
  name: string,
  outputContract?: {
    ref: {
      name: string;
      version: string;
      schemaHash: string;
      renderKind: string;
      visibility: string;
      mode: string;
    };
  },
): Promise<{ agentId: string }> {
  const prompt = await postJson(app, "/api/ai/system-prompts", admin.cookie, {
    name: `${name}-prompt`,
    content: "只返回事实。",
  });
  const promptBody = await readSuccess<{ id: string }>(prompt);
  const modelRef = seedModel(runtime);
  const created = await postJson(app, "/api/ai/admin/agents", admin.cookie, {
    name,
    config: {
      schemaVersion: 2,
      model: modelRef,
      systemPromptId: promptBody.data.id,
      skillIds: [],
      toolRefs: [],
      ...(outputContract ? { outputContract: outputContract.ref } : {}),
      thinkingLevel: "off",
      maxTurns: 8,
    },
  });
  const createdBody = await readSuccess<{ id: string }>(created);
  const enabled = await patchJson(
    app,
    `/api/ai/admin/agents/${createdBody.data.id}/status`,
    admin.cookie,
    { status: "enabled" },
  );
  expect(enabled.status).toBe(200);
  return { agentId: createdBody.data.id };
}

async function createPipeline(
  app: ReturnType<typeof createTestApp>["app"],
  adminCookie: string,
  name: string,
  steps: Array<{ agentId: string; inputTemplate: string }>,
): Promise<string> {
  const created = await postJson(app, "/api/ai/admin/pipelines", adminCookie, {
    name,
    steps,
  });
  expect(created.status).toBe(200);
  const body = await readSuccess<{ id: string }>(created);
  const enabled = await patchJson(
    app,
    `/api/ai/admin/pipelines/${body.data.id}/status`,
    adminCookie,
    { status: "enabled" },
  );
  expect(enabled.status).toBe(200);
  return body.data.id;
}

async function startPipelineRun(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  pipelineId: string,
  input: string,
): Promise<string> {
  const started = await postJson(
    app,
    `/api/ai/pipelines/${pipelineId}/runs`,
    cookie,
    { input },
  );
  expect(started.status).toBe(200);
  const body = await readSuccess<{ runId: string }>(started);
  return body.data.runId;
}

async function getPipelineRun(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  runId: string,
): Promise<PipelineRun> {
  const response = await app.request(`/api/ai/pipeline-runs/${runId}`, {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  return (await readSuccess<PipelineRun>(response)).data;
}

async function pollPipelineRun(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  runId: string,
): Promise<PipelineRun> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const run = await getPipelineRun(app, cookie, runId);
    if (["completed", "failed", "aborted"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Pipeline Run 未在等待时间内进入终态");
}

function lastUserText(context: Context): string {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (!message || message.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (block): block is { type: "text"; text: string } =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("");
    }
  }
  return "";
}

it("pipeline 定义 CRUD：创建、静态模板校验、revision 递增", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pipeline-crud-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () =>
      streamResponse(
        assistantMessage([{ type: "text", text: "ok" }], "stop"),
        "stop",
      ),
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const { agentId } = await setupAgent(app, runtime, admin, "crud-agent");

    // 创建两步定义：revision=1，stepCount=2
    const created = await postJson(
      app,
      "/api/ai/admin/pipelines",
      admin.cookie,
      {
        name: "crud-pipeline",
        description: "两步流水线",
        steps: [
          { agentId, inputTemplate: "提取要点：{{input}}" },
          {
            agentId,
            inputTemplate: "翻译成英文：{{steps.0.output}}",
            laneLabel: "translate",
          },
        ],
      },
    );
    expect(created.status).toBe(200);
    const detail = (await readSuccess<PipelineDefinitionDetail>(created)).data;
    expect(detail.revision).toBe(1);
    expect(detail.status).toBe("draft");
    expect(detail.steps).toHaveLength(2);
    expect(detail.steps[1]?.inputTemplate).toContain("{{steps.0.output}}");
    expect(detail.steps[1]?.laneLabel).toBe("translate");

    // 越界引用：步骤 0 引用 {{steps.1.output}} -> 400，message 含步骤序号与变量名
    const forwardRef = await postJson(
      app,
      "/api/ai/admin/pipelines",
      admin.cookie,
      {
        name: "forward-ref-pipeline",
        steps: [
          { agentId, inputTemplate: "翻译：{{steps.1.output}}" },
          { agentId, inputTemplate: "第二步：{{input}}" },
        ],
      },
    );
    expect(forwardRef.status).toBe(400);
    const forwardRefError = await readFailure(forwardRef);
    expect(forwardRefError.error.code).toBe(
      ApiErrorCodes.COMMON_INVALID_REQUEST,
    );
    expect(forwardRefError.error.message).toContain("步骤 0");
    expect(forwardRefError.error.message).toContain("{{steps.1.output}}");

    // 自引用：步骤 0 引用 {{steps.0.output}} -> 400
    const selfRef = await postJson(
      app,
      "/api/ai/admin/pipelines",
      admin.cookie,
      {
        name: "self-ref-pipeline",
        steps: [{ agentId, inputTemplate: "处理：{{steps.0.output}}" }],
      },
    );
    expect(selfRef.status).toBe(400);
    const selfRefError = await readFailure(selfRef);
    expect(selfRefError.error.message).toContain("步骤 0");
    expect(selfRefError.error.message).toContain("{{steps.0.output}}");

    // PATCH 与状态切换各 +1 revision；列表返回 summary（stepCount 而非 steps）
    const patched = await patchJson(
      app,
      `/api/ai/admin/pipelines/${detail.id}`,
      admin.cookie,
      { description: "更新后的描述" },
    );
    expect(patched.status).toBe(200);
    expect(
      (await readSuccess<PipelineDefinitionDetail>(patched)).data.revision,
    ).toBe(2);
    const flipped = await patchJson(
      app,
      `/api/ai/admin/pipelines/${detail.id}/status`,
      admin.cookie,
      { status: "enabled" },
    );
    expect(flipped.status).toBe(200);
    const flippedBody = (await readSuccess<PipelineDefinitionDetail>(flipped))
      .data;
    expect(flippedBody.status).toBe("enabled");
    expect(flippedBody.revision).toBe(3);

    const list = await app.request("/api/ai/admin/pipelines", {
      headers: { Cookie: admin.cookie },
    });
    expect(list.status).toBe(200);
    const listBody = (await readSuccess<PipelineDefinitionSummaryList>(list))
      .data;
    expect(listBody.total).toBe(1);
    expect(listBody.items[0]?.stepCount).toBe(2);
    expect("steps" in listBody.items[0]!).toBe(false);

    // 重复名 -> 409
    const duplicated = await postJson(
      app,
      "/api/ai/admin/pipelines",
      admin.cookie,
      {
        name: "crud-pipeline",
        steps: [{ agentId, inputTemplate: "{{input}}" }],
      },
    );
    expect(duplicated.status).toBe(409);
    expect((await readFailure(duplicated)).error.code).toBe(
      ApiErrorCodes.AI_PIPELINE_NAME_CONFLICT,
    );

    // 未启用 / 不存在的 pipeline 启动 -> 404
    const draftCreated = await postJson(
      app,
      "/api/ai/admin/pipelines",
      admin.cookie,
      {
        name: "draft-pipeline",
        steps: [{ agentId, inputTemplate: "{{input}}" }],
      },
    );
    const draftId = (await readSuccess<{ id: string }>(draftCreated)).data.id;
    const draftStart = await postJson(
      app,
      `/api/ai/pipelines/${draftId}/runs`,
      admin.cookie,
      { input: "x" },
    );
    expect(draftStart.status).toBe(404);
    const missingStart = await postJson(
      app,
      `/api/ai/pipelines/${generateId()}/runs`,
      admin.cookie,
      { input: "x" },
    );
    expect(missingStart.status).toBe(404);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("happy path：两步流水线 completed，步骤明细含 runId，finalOutput 为步骤 2 文本", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pipeline-happy-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const streamFn = (
    _model: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const input = lastUserText(context);
    if (input.startsWith("翻译成英文")) {
      return streamResponse(
        assistantMessage(
          [{ type: "text", text: "KEY POINTS TRANSLATED" }],
          "stop",
        ),
        "stop",
      );
    }
    return streamResponse(
      assistantMessage(
        [{ type: "text", text: "要点：原始输入的核心内容" }],
        "stop",
      ),
      "stop",
    );
  };
  const executorFactory = (
    testRuntime: ReturnType<typeof createTestApp>["runtime"],
  ) => {
    const usage = createAiUsageAuditService(
      createAiUsageAuditRepository(testRuntime.db),
      testRuntime.logger,
    );
    return createPiAgentExecutor({
      sessionStore: store,
      // models 路径而非直接 streamFn：审计（ai_model_calls）只在 models 路径注入。
      models: modelsWith(streamFn as unknown as Models["streamSimple"], {
        model,
      }),
      hasPermission: async () => true,
      audit: usage.createAgentModelCallAudit(),
      toolAudit: usage.createAgentToolExecutionAudit(),
      lifecycle: createAiRunLifecycleRepository(testRuntime.db),
    });
  };
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutorFactory: executorFactory },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "pipeline-happy@example.com");
    const summaryAgent = await setupAgent(app, runtime, admin, "summary-agent");
    const translateAgent = await setupAgent(
      app,
      runtime,
      admin,
      "translate-agent",
    );
    const pipelineId = await createPipeline(
      app,
      admin.cookie,
      "happy-pipeline",
      [
        { agentId: summaryAgent.agentId, inputTemplate: "提取要点：{{input}}" },
        {
          agentId: translateAgent.agentId,
          inputTemplate: "翻译成英文：{{steps.0.output}}",
        },
      ],
    );

    const runId = await startPipelineRun(
      app,
      user.cookie,
      pipelineId,
      "hello pipeline",
    );
    const pipelineRun = await pollPipelineRun(app, user.cookie, runId);
    expect(pipelineRun.status).toBe("completed");
    expect(pipelineRun.errorCode).toBeNull();
    expect(pipelineRun.finalOutput).toBe("KEY POINTS TRANSLATED");
    expect(pipelineRun.steps).toHaveLength(2);

    const stepZero = pipelineRun.steps[0]!;
    const stepOne = pipelineRun.steps[1]!;
    expect(stepZero.status).toBe("completed");
    expect(stepOne.status).toBe("completed");
    expect(stepZero.output).toBe("要点：原始输入的核心内容");
    expect(stepOne.output).toBe("KEY POINTS TRANSLATED");
    expect(stepZero.lane).toBe("pipeline-0");
    expect(stepOne.lane).toBe("pipeline-1");
    expect(stepZero.agentId).toBe(summaryAgent.agentId);
    expect(stepOne.agentId).toBe(translateAgent.agentId);

    // 每步 Run 可独立查询且 transcript 可读
    const runZero = await app.request(
      `/api/ai/sessions/${pipelineRun.sessionId}/runs/${stepZero.runId}`,
      { headers: { Cookie: user.cookie } },
    );
    expect(runZero.status).toBe(200);
    const runZeroBody = (await readSuccess<AgentRun>(runZero)).data;
    expect(runZeroBody.status).toBe("completed");
    expect(runZeroBody.lane).toBe("pipeline-0");

    const transcriptOne = await app.request(
      `/api/ai/sessions/${pipelineRun.sessionId}/transcript?lane=pipeline-1`,
      { headers: { Cookie: user.cookie } },
    );
    expect(transcriptOne.status).toBe(200);
    const transcriptOneBody = (
      await readSuccess<AgentTranscript>(transcriptOne)
    ).data;
    const userMessage = transcriptOneBody.items.find(
      (item) => item.type === "user_message",
    );
    expect(
      userMessage && userMessage.type === "user_message"
        ? userMessage.content
        : "",
    ).toBe("翻译成英文：要点：原始输入的核心内容");

    // 专用 session 标题自动生成
    const sessionDetail = await app.request(
      `/api/ai/sessions/${pipelineRun.sessionId}`,
      { headers: { Cookie: user.cookie } },
    );
    expect(sessionDetail.status).toBe(200);
    expect(
      (await readSuccess<{ title: string }>(sessionDetail)).data.title,
    ).toBe("Pipeline: happy-pipeline");

    // 审计：每步一条 ai_model_calls（scenario=agent_run、run_id 正确），
    // stepsStateJson 与实际 Run 状态一致。
    for (const step of pipelineRun.steps) {
      const calls = runtime.db
        .select({ scenario: aiModelCalls.scenario, runId: aiModelCalls.runId })
        .from(aiModelCalls)
        .where(eq(aiModelCalls.runId, step.runId))
        .all();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const call of calls) {
        expect(call.scenario).toBe("agent_run");
      }
    }
    const pipelineRow = runtime.db
      .select()
      .from(aiPipelineRuns)
      .where(eq(aiPipelineRuns.id, runId))
      .get();
    expect(pipelineRow?.status).toBe("completed");
    expect(pipelineRow?.finalOutput).toBe("KEY POINTS TRANSLATED");
    const runRows = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.sessionId, pipelineRun.sessionId))
      .all();
    expect(runRows).toHaveLength(2);
    expect(new Set(runRows.map((row) => row.id))).toEqual(
      new Set([stepZero.runId, stepOne.runId]),
    );
    for (const row of runRows) {
      expect(row.status).toBe("completed");
    }
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("fail fast：步骤 1 失败时整条 pipeline 为 failed，步骤 2 未启动", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pipeline-fail-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () => streamError(),
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "pipeline-fail@example.com");
    const agent = await setupAgent(app, runtime, admin, "fail-agent");
    const pipelineId = await createPipeline(
      app,
      admin.cookie,
      "fail-pipeline",
      [
        { agentId: agent.agentId, inputTemplate: "提取要点：{{input}}" },
        { agentId: agent.agentId, inputTemplate: "翻译：{{steps.0.output}}" },
      ],
    );

    const runId = await startPipelineRun(app, user.cookie, pipelineId, "input");
    const pipelineRun = await pollPipelineRun(app, user.cookie, runId);
    expect(pipelineRun.status).toBe("failed");
    expect(pipelineRun.errorCode).toBe(ApiErrorCodes.AI_UPSTREAM_ERROR);
    expect(pipelineRun.finalOutput).toBeNull();
    expect(pipelineRun.steps).toHaveLength(1);
    expect(pipelineRun.steps[0]?.status).toBe("failed");
    expect(pipelineRun.steps[0]?.errorCode).toBe(
      ApiErrorCodes.AI_UPSTREAM_ERROR,
    );
    expect(pipelineRun.steps[0]?.output).toBeNull();

    // 步骤 2 没有 Run 行（session 上只有一个 Run）
    const runRows = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.sessionId, pipelineRun.sessionId))
      .all();
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.status).toBe("failed");
    expect(runRows[0]?.id).toBe(pipelineRun.steps[0]?.runId);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("步骤 agent 被禁用后启动 pipeline：该步无 Run，errorCode 透传", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pipeline-disabled-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () =>
      streamResponse(
        assistantMessage([{ type: "text", text: "ok" }], "stop"),
        "stop",
      ),
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "pipeline-disabled@example.com");
    const agent = await setupAgent(app, runtime, admin, "disabled-step-agent");
    // 定义时 agent 是 enabled，创建后禁用（定义允许引用，启动时校验失败）
    const disabled = await patchJson(
      app,
      `/api/ai/admin/agents/${agent.agentId}/status`,
      admin.cookie,
      { status: "disabled" },
    );
    expect(disabled.status).toBe(200);
    const pipelineId = await createPipeline(
      app,
      admin.cookie,
      "disabled-pipeline",
      [{ agentId: agent.agentId, inputTemplate: "提取要点：{{input}}" }],
    );

    const runId = await startPipelineRun(app, user.cookie, pipelineId, "input");
    const pipelineRun = await pollPipelineRun(app, user.cookie, runId);
    expect(pipelineRun.status).toBe("failed");
    expect(pipelineRun.errorCode).toBe(ApiErrorCodes.AI_AGENT_NOT_ENABLED);
    expect(pipelineRun.steps).toHaveLength(0);
    const runRows = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.sessionId, pipelineRun.sessionId))
      .all();
    expect(runRows).toHaveLength(0);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("abort 进行中的 pipeline run：步骤 Run aborted、pipeline aborted、后续步骤无 Run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pipeline-abort-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const streamFn = (
    _model: Model<Api>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const stream = createAssistantMessageEventStream();
    const partial = assistantMessage([], "pending");
    stream.push({ type: "start", partial });
    void gate.then(() => {
      stream.push({
        type: "done",
        reason: "stop",
        message: assistantMessage([{ type: "text", text: "late" }], "stop"),
      });
    });
    return stream;
  };
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "pipeline-abort@example.com");
    const agent = await setupAgent(app, runtime, admin, "abort-step-agent");
    const pipelineId = await createPipeline(
      app,
      admin.cookie,
      "abort-pipeline",
      [
        { agentId: agent.agentId, inputTemplate: "提取要点：{{input}}" },
        { agentId: agent.agentId, inputTemplate: "翻译：{{steps.0.output}}" },
      ],
    );

    const runId = await startPipelineRun(app, user.cookie, pipelineId, "input");
    // 等步骤 0 的 Run 真正启动再 abort
    let stepRunId = "";
    await vi.waitFor(async () => {
      const rows = runtime.db
        .select()
        .from(aiAgentRuns)
        .where(eq(aiAgentRuns.status, "running"))
        .all();
      expect(rows).toHaveLength(1);
      stepRunId = rows[0]!.id;
    });

    const abortResponse = await app.request(
      `/api/ai/pipeline-runs/${runId}/abort`,
      {
        method: "POST",
        headers: { Cookie: user.cookie },
      },
    );
    expect(abortResponse.status).toBe(200);
    const abortBody = (await readSuccess<PipelineRunAbort>(abortResponse)).data;
    expect(abortBody.runId).toBe(runId);
    expect(abortBody.status).toBe("running");
    release();

    const pipelineRun = await pollPipelineRun(app, user.cookie, runId);
    expect(pipelineRun.status).toBe("aborted");
    expect(pipelineRun.errorCode).toBeNull();
    expect(pipelineRun.steps).toHaveLength(1);
    expect(pipelineRun.steps[0]?.status).toBe("aborted");
    expect(pipelineRun.steps[0]?.runId).toBe(stepRunId);
    expect(pipelineRun.finalOutput).toBeNull();

    // 后续步骤没有 Run 行
    const runRows = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.sessionId, pipelineRun.sessionId))
      .all();
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.status).toBe("aborted");

    // abort 已终态的 pipeline -> 409 AI_RUN_NOT_ACTIVE
    const abortAgain = await app.request(
      `/api/ai/pipeline-runs/${runId}/abort`,
      {
        method: "POST",
        headers: { Cookie: user.cookie },
      },
    );
    expect(abortAgain.status).toBe(409);
    expect((await readFailure(abortAgain)).error.code).toBe(
      ApiErrorCodes.AI_RUN_NOT_ACTIVE,
    );
  } finally {
    release?.();
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("归属隔离：product_app 只能访问自己的 pipeline run，跨 principal 404", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pipeline-scope-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () =>
      streamResponse(
        assistantMessage([{ type: "text", text: "done" }], "stop"),
        "stop",
      ),
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const agent = await setupAgent(app, runtime, admin, "scope-agent");
    const pipelineId = await createPipeline(
      app,
      admin.cookie,
      "scope-pipeline",
      [{ agentId: agent.agentId, inputTemplate: "处理：{{input}}" }],
    );

    const main = await createAppCredential(
      app,
      admin.cookie,
      "Main",
      "tenant-a",
      "project-a",
    );
    const other = await createAppCredential(
      app,
      admin.cookie,
      "Other",
      "tenant-a",
      "project-b",
    );
    const starterUser = await register(app, "pipeline-scope-user@example.com");
    const headers = (secret: string, externalUserId: string) => ({
      Authorization: `Bearer ${secret}`,
      "X-AI-External-User-Id": externalUserId,
      "Content-Type": "application/json",
    });

    const started = await app.request(`/api/ai/pipelines/${pipelineId}/runs`, {
      method: "POST",
      headers: headers(main.secret, "customer-1"),
      body: JSON.stringify({ input: "hello" }),
    });
    expect(started.status).toBe(200);
    const runId = (await readSuccess<{ runId: string }>(started)).data.runId;

    // 轮询自己的 run 到终态
    let pipelineRun: PipelineRun | undefined;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const response = await app.request(`/api/ai/pipeline-runs/${runId}`, {
        headers: headers(main.secret, "customer-1"),
      });
      expect(response.status).toBe(200);
      const run = (await readSuccess<PipelineRun>(response)).data;
      if (["completed", "failed", "aborted"].includes(run.status)) {
        pipelineRun = run;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(pipelineRun?.status).toBe("completed");
    expect(pipelineRun?.finalOutput).toBe("done");

    // 其他 product_app（不同凭据）访问 -> 404
    const otherResponse = await app.request(`/api/ai/pipeline-runs/${runId}`, {
      headers: headers(other.secret, "customer-1"),
    });
    expect(otherResponse.status).toBe(404);
    const otherAbort = await app.request(
      `/api/ai/pipeline-runs/${runId}/abort`,
      {
        method: "POST",
        headers: headers(other.secret, "customer-1"),
      },
    );
    expect(otherAbort.status).toBe(404);

    // starter_user 访问 product_app 的 run -> 404
    const starterResponse = await app.request(
      `/api/ai/pipeline-runs/${runId}`,
      {
        headers: { Cookie: starterUser.cookie },
      },
    );
    expect(starterResponse.status).toBe(404);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("结构化输出优先：步骤产出取结构化输出 value，下一步输入含该 JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pipeline-output-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  let calls = 0;
  const streamFn = (
    _model: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    calls += 1;
    const input = lastUserText(context);
    if (input.startsWith("翻译") || input.startsWith("总结")) {
      return streamResponse(
        assistantMessage([{ type: "text", text: "FINAL TRANSLATION" }], "stop"),
        "stop",
      );
    }
    return streamResponse(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: `pipeline-emit-${calls}`,
            name: "emit_structured_output",
            arguments: { result: "approved" },
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  };
  const contracts = createAiOutputContractRegistry();
  const productContract = contracts.define({
    name: "pipeline.result",
    version: "1.0.0",
    description: "Pipeline structured result",
    schema: z.object({ result: z.string() }),
    renderKind: "json",
    visibility: "product",
    mode: "required",
  });
  const executorFactory = (
    testRuntime: ReturnType<typeof createTestApp>["runtime"],
  ) =>
    createPiAgentExecutor({
      sessionStore: store,
      resolveModel: () => model,
      streamFn,
      hasPermission: async () => true,
      lifecycle: createAiRunLifecycleRepository(testRuntime.db),
    });
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutorFactory: executorFactory,
      aiOutputContracts: contracts,
    },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "pipeline-output@example.com");
    const extractAgent = await setupAgent(
      app,
      runtime,
      admin,
      "extract-contract-agent",
      productContract,
    );
    const translateAgent = await setupAgent(
      app,
      runtime,
      admin,
      "translate-plain-agent",
    );
    const pipelineId = await createPipeline(
      app,
      admin.cookie,
      "output-pipeline",
      [
        { agentId: extractAgent.agentId, inputTemplate: "提取：{{input}}" },
        {
          agentId: translateAgent.agentId,
          inputTemplate: "翻译：{{steps.0.output}}",
        },
      ],
    );

    const runId = await startPipelineRun(
      app,
      user.cookie,
      pipelineId,
      "raw input",
    );
    const pipelineRun = await pollPipelineRun(app, user.cookie, runId);
    expect(pipelineRun.status).toBe("completed");

    // 步骤 0 产出是结构化输出 value 的 JSON 序列化
    expect(pipelineRun.steps[0]?.output).toBe('{"result":"approved"}');
    // finalOutput 是步骤 1 的文本
    expect(pipelineRun.finalOutput).toBe("FINAL TRANSLATION");

    // 步骤 1 收到的输入含该 JSON
    const transcriptOne = await app.request(
      `/api/ai/sessions/${pipelineRun.sessionId}/transcript?lane=pipeline-1`,
      { headers: { Cookie: user.cookie } },
    );
    expect(transcriptOne.status).toBe(200);
    const transcriptOneBody = (
      await readSuccess<AgentTranscript>(transcriptOne)
    ).data;
    const userMessage = transcriptOneBody.items.find(
      (item) => item.type === "user_message",
    );
    expect(
      userMessage && userMessage.type === "user_message"
        ? userMessage.content
        : "",
    ).toBe('翻译：{"result":"approved"}');
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("dTO 步骤产出截断到 1000 字符，finalOutput 全量", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pipeline-truncate-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const longText = "长".repeat(1500);
  const streamFn = (
    _model: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const input = lastUserText(context);
    if (input.startsWith("翻译")) {
      return streamResponse(
        assistantMessage([{ type: "text", text: "最终翻译结果" }], "stop"),
        "stop",
      );
    }
    return streamResponse(
      assistantMessage([{ type: "text", text: longText }], "stop"),
      "stop",
    );
  };
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "pipeline-truncate@example.com");
    const agent = await setupAgent(app, runtime, admin, "truncate-agent");
    const pipelineId = await createPipeline(
      app,
      admin.cookie,
      "truncate-pipeline",
      [
        { agentId: agent.agentId, inputTemplate: "提取：{{input}}" },
        { agentId: agent.agentId, inputTemplate: "翻译：{{steps.0.output}}" },
      ],
    );

    const runId = await startPipelineRun(app, user.cookie, pipelineId, "input");
    const pipelineRun = await pollPipelineRun(app, user.cookie, runId);
    expect(pipelineRun.status).toBe("completed");

    const stepZeroOutput = pipelineRun.steps[0]?.output ?? "";
    expect(stepZeroOutput.length).toBeGreaterThan(1000);
    expect(stepZeroOutput.length).toBeLessThan(longText.length);
    expect(stepZeroOutput.startsWith("长".repeat(1000))).toBe(true);
    expect(stepZeroOutput).toContain("已截断");
    // finalOutput 全量（它就是最后一步产出本身，长度不受截断影响）
    expect(pipelineRun.finalOutput).toBe("最终翻译结果");
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

async function createAppCredential(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  name: string,
  tenantId: string,
  projectId: string,
): Promise<{ appId: string; secret: string }> {
  const response = await app.request("/api/ai/admin/applications", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name, tenantId, projectId }),
  });
  expect(response.status).toBe(200);
  const result = await readSuccess<{
    application: { appId: string };
    secret: string;
  }>(response);
  return { appId: result.data.application.appId, secret: result.data.secret };
}
