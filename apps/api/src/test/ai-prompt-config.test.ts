import type { AiGateway, AiGatewayInput } from "@api/infra/ai/index.js";
import { ApiErrorCodes } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  aiEnabledModels,
  aiProviderConfigs,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";

import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: 2,
} as const;

it("system prompt CRUD：创建、更新、列表、删除全链路", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await registerAdmin(app, runtime);
    const created = await postJson(
      app,
      "/api/ai/system-prompts",
      admin.cookie,
      { name: "code-reviewer", content: "你是资深代码审查专家。" },
    );
    expect(created.status).toBe(200);
    const body = await readSuccess<{
      id: string;
      name: string;
      content: string;
      enabled: boolean;
    }>(created);
    expect(body.data.name).toBe("code-reviewer");

    const updated = await putJson(
      app,
      `/api/ai/system-prompts/${body.data.id}`,
      admin.cookie,
      { content: "你是资深代码审查专家，用中文回答。" },
    );
    expect(updated.status).toBe(200);

    const list = await getJson(app, "/api/ai/system-prompts", admin.cookie);
    expect(list.status).toBe(200);
    const listBody = await readSuccess<{ name: string }[]>(list);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.name).toBe("code-reviewer");

    const deleted = await app.request(
      `/api/ai/system-prompts/${body.data.id}`,
      { method: "DELETE", headers: { cookie: admin.cookie } },
    );
    expect(deleted.status).toBe(200);
    const listAfter = await getJson(
      app,
      "/api/ai/system-prompts",
      admin.cookie,
    );
    const listAfterBody = await readSuccess<unknown[]>(listAfter);
    expect(listAfterBody.data).toHaveLength(0);
  } finally {
    cleanup();
  }
});

it("system prompt 写接口无 manage 权限返回 403，列表无 read 权限返回 403", async () => {
  const { app, cleanup } = createTestApp();
  try {
    const owner = await register(app, "prompt-403@example.com");
    const created = await postJson(
      app,
      "/api/ai/system-prompts",
      owner.cookie,
      { name: "no-permission", content: "x" },
    );
    expect(created.status).toBe(403);
    const listed = await getJson(app, "/api/ai/system-prompts", owner.cookie);
    expect(listed.status).toBe(403);
  } finally {
    cleanup();
  }
});

it("被引用为全局默认的 system prompt 不能删除（409）", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await registerAdmin(app, runtime);
    const created = await postJson(
      app,
      "/api/ai/system-prompts",
      admin.cookie,
      { name: "global-rule", content: "全局规则" },
    );
    const body = await readSuccess<{ id: string }>(created);
    const set = await putJson(
      app,
      "/api/ai/settings/system-prompt",
      admin.cookie,
      { systemPromptId: body.data.id },
    );
    expect(set.status).toBe(200);

    const deleted = await app.request(
      `/api/ai/system-prompts/${body.data.id}`,
      { method: "DELETE", headers: { cookie: admin.cookie } },
    );
    expect(deleted.status).toBe(409);
    const failure = await readFailure(deleted);
    expect(failure.error.code).toBe(ApiErrorCodes.AI_PROMPT_REFERENCED);
  } finally {
    cleanup();
  }
});

it("对话注入 system prompt：会话级覆盖优先于全局默认", async () => {
  const captured: AiGatewayInput[] = [];
  const gateway: AiGateway = {
    async *stream(input) {
      captured.push(input);
      yield {
        type: "text_delta",
        text: "hi",
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      yield {
        type: "completed",
        turnIndex: input.turnIndex,
        assistantMessage: {
          role: "assistant",
          blocks: [
            {
              type: "text",
              text: "hi",
              turnIndex: input.turnIndex,
              contentIndex: 0,
              blockId: `${input.turnIndex}:0`,
            },
          ],
        },
        stopReason: "stop",
        usage,
        cost: null,
      };
    },
  };
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const admin = await registerAdmin(app, runtime);
    const globalPrompt = await postJson(
      app,
      "/api/ai/system-prompts",
      admin.cookie,
      { name: "global-default", content: "全局默认提示词" },
    );
    const globalBody = await readSuccess<{ id: string }>(globalPrompt);
    await putJson(app, "/api/ai/settings/system-prompt", admin.cookie, {
      systemPromptId: globalBody.data.id,
    });

    const owner = await register(app, "prompt-user@example.com");
    const model = seedModel(runtime);
    const conversationResponse = await app.request("/api/ai/conversations", {
      method: "POST",
      headers: { cookie: owner.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "with global" }),
    });
    const conversation = await readSuccess<{ id: string }>(
      conversationResponse,
    );
    await sendMessage(app, conversation.data.id, owner.cookie, model);
    expect(captured[0]?.systemPrompt).toBe("全局默认提示词");

    // 会话级覆盖：创建会话时指定 systemPromptId
    const customPrompt = await postJson(
      app,
      "/api/ai/system-prompts",
      admin.cookie,
      { name: "session-rule", content: "会话专属提示词" },
    );
    const customBody = await readSuccess<{ id: string }>(customPrompt);
    const customConversationResponse = await app.request(
      "/api/ai/conversations",
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "with override",
          systemPromptId: customBody.data.id,
        }),
      },
    );
    const customConversation = await readSuccess<{ id: string }>(
      customConversationResponse,
    );
    await sendMessage(app, customConversation.data.id, owner.cookie, model);
    expect(captured[1]?.systemPrompt).toBe("会话专属提示词");

    // 发消息时切换 systemPromptId 并清除回全局默认
    await sendMessage(app, conversation.data.id, owner.cookie, model, {
      systemPromptId: customBody.data.id,
    });
    expect(captured[2]?.systemPrompt).toBe("会话专属提示词");
    await sendMessage(app, conversation.data.id, owner.cookie, model, {
      systemPromptId: null,
    });
    expect(captured[3]?.systemPrompt).toBe("全局默认提示词");
  } finally {
    cleanup();
  }
});

it("prompt 模板 CRUD 与列表排序：enabled 优先、sortOrder 升序", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await registerAdmin(app, runtime);
    await postJson(app, "/api/ai/prompt-templates", admin.cookie, {
      name: "review-code",
      description: "代码审查",
      content: "请审查这段代码：",
      sortOrder: 2,
    });
    await postJson(app, "/api/ai/prompt-templates", admin.cookie, {
      name: "write-sql",
      description: "SQL 设计",
      content: "请设计 SQL：",
      enabled: false,
      sortOrder: 1,
    });
    await postJson(app, "/api/ai/prompt-templates", admin.cookie, {
      name: "explain-term",
      description: "概念解释",
      content: "请解释概念：",
      sortOrder: 0,
    });

    const owner = await register(app, "template-user@example.com");
    const list = await getJson(app, "/api/ai/prompt-templates", owner.cookie);
    expect(list.status).toBe(200);
    const body = await readSuccess<{ name: string; enabled: boolean }[]>(list);
    expect(body.data.map((item) => item.name)).toEqual([
      "explain-term",
      "review-code",
      "write-sql",
    ]);
  } finally {
    cleanup();
  }
});

async function registerAdmin(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
) {
  const owner = await register(app, `admin-${Date.now()}@example.com`);
  const adminRole = runtime.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "admin"))
    .get()!;
  const aiPermissions = runtime.db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(eq(permissions.key, "ai:config:manage"))
    .all();
  const aiReadPermissions = runtime.db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(eq(permissions.key, "ai:config:read"))
    .all();
  for (const permission of [...aiPermissions, ...aiReadPermissions]) {
    runtime.db
      .insert(rolePermissions)
      .values({
        roleId: adminRole.id,
        permissionId: permission.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .run();
  }
  runtime.db
    .update(userRoles)
    .set({ roleId: adminRole.id })
    .where(eq(userRoles.userId, owner.user.id))
    .run();
  return owner;
}

async function postJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: "PUT",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  cookie: string,
) {
  return app.request(path, { method: "GET", headers: { cookie } });
}

async function sendMessage(
  app: ReturnType<typeof createTestApp>["app"],
  conversationId: string,
  cookie: string,
  model: { providerId: string; modelId: string },
  extra: Record<string, unknown> = {},
) {
  const response = await app.request(
    `/api/ai/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", model, ...extra }),
    },
  );
  await response.text();
}

function seedModel(runtime: ReturnType<typeof createTestApp>["runtime"]) {
  const model = runtime.ai.listModels("openai")[0];
  if (!model) throw new Error("测试模型目录为空");
  const now = new Date();
  runtime.db
    .insert(aiProviderConfigs)
    .values({
      providerId: model.providerId,
      enabled: true,
      configRevision: 0,
      checkedConfigRevision: 0,
      authStatus: "ready",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  runtime.db
    .insert(aiEnabledModels)
    .values({
      providerId: model.providerId,
      modelId: model.modelId,
      enabledAt: now,
    })
    .run();
  return { providerId: model.providerId, modelId: model.modelId };
}
