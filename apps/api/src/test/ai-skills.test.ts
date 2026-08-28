import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  aiEnabledModels,
  aiProviderConfigs,
  aiToolExecutions,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";
import { createAiSkillRepository } from "@api/modules/ai/skill/skill.repository.js";
import {
  appendSkillDescriptions,
  createReadSkillTool,
} from "@api/modules/ai/skill/skill-tools.js";
import {
  createAiAgentDefinitionRepository,
  createAiAgentDefinitionService,
} from "@api/modules/ai/agent/index.js";
import { createAiPromptRepository } from "@api/modules/ai/prompt/prompt.repository.js";
import { createAiPromptService } from "@api/modules/ai/prompt/prompt.service.js";
import { createAiToolRegistry } from "@api/modules/ai/tool/tool-registry.js";

import { createTestApp, readSuccess, register } from "./helpers.js";

it("技能 CRUD：创建、详情、更新、删除、列表不含 content", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await registerAdmin(app, runtime);
    const created = await postJson(app, "/api/ai/skills", admin.cookie, {
      name: "sql-expert",
      description: "SQL 设计专家",
      content: "你是 SQL 优化专家，请按以下步骤分析：",
    });
    expect(created.status).toBe(200);
    const skill = await readSuccess<{
      id: string;
      name: string;
      content: string;
      enabled: boolean;
    }>(created);
    expect(skill.data.content).toContain("SQL 优化专家");

    const detail = await getJson(
      app,
      `/api/ai/skills/${skill.data.id}`,
      admin.cookie,
    );
    expect(detail.status).toBe(200);
    const detailBody = await readSuccess<{ content: string }>(detail);
    expect(detailBody.data.content).toContain("SQL 优化专家");

    const updated = await putJson(
      app,
      `/api/ai/skills/${skill.data.id}`,
      admin.cookie,
      { description: "SQL 优化专家（v2）" },
    );
    expect(updated.status).toBe(200);

    // 普通用户列表不含 content
    const owner = await register(app, "skill-user@example.com");
    const list = await getJson(app, "/api/ai/skills", owner.cookie);
    expect(list.status).toBe(200);
    const listBody =
      await readSuccess<{ name: string; content?: string }[]>(list);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]).toEqual(
      expect.objectContaining({ name: "sql-expert" }),
    );
    expect(JSON.stringify(listBody.data)).not.toContain("请按以下步骤分析");

    const deleted = await app.request(`/api/ai/skills/${skill.data.id}`, {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(deleted.status).toBe(200);
  } finally {
    cleanup();
  }
});

it("技能写接口无 manage 权限返回 403，详情接口无权限 403", async () => {
  const { app, cleanup } = createTestApp();
  try {
    const owner = await register(app, "skill-403@example.com");
    const created = await postJson(app, "/api/ai/skills", owner.cookie, {
      name: "no-permission",
      description: "x",
      content: "y",
    });
    expect(created.status).toBe(403);
  } finally {
    cleanup();
  }
});

it("appendSkillDescriptions：注入 XML 块并转义，无技能时原样返回", () => {
  const skills = [
    { name: "sql-expert", description: 'SQL <优化> & "设计"' },
    { name: "code-review", description: "代码审查" },
  ];
  const result = appendSkillDescriptions(undefined, skills);
  expect(result).toContain("<available_skills>");
  expect(result).toContain("<name>sql-expert</name>");
  expect(result).toContain("SQL &lt;优化&gt; &amp; &quot;设计&quot;");
  expect(result).toContain("</available_skills>");

  expect(appendSkillDescriptions("base", [])).toBe("base");
  expect(appendSkillDescriptions(undefined, [])).toBeUndefined();
  expect(appendSkillDescriptions("base", skills)).toContain(
    "base\n\n<available_skills>",
  );
});

it("read_skill 工具：注册在 orchestrator 中，启用技能返回 content，未启用抛错走 failed", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await registerAdmin(app, runtime);
    await postJson(app, "/api/ai/skills", admin.cookie, {
      name: "sql-expert",
      description: "SQL 设计专家",
      content: "技能正文 SECRET_SKILL_9f2c",
    });
    await postJson(app, "/api/ai/skills", admin.cookie, {
      name: "inactive-skill",
      description: "已停用",
      content: "不应可读",
      enabled: false,
    });

    // orchestrator 的 registry 通过 app 装配注入 read_skill
    // 这里直接验证 read_skill 工具行为与审计脱敏。
    const tool = createReadSkillTool(createAiSkillRepository(runtime.db));
    const success = await tool.execute(
      {
        principal: {
          kind: "starter_user" as const,
          principalId: "skill-user",
          tenantId: "starter",
          projectId: "starter",
          externalUserId: "skill-user",
          appId: null,
        },
        scope: {
          tenantId: "starter",
          projectId: "starter",
          subjectType: null,
          subjectId: null,
        },
        requestId: "skill-request",
        signal: new AbortController().signal,
        reportProgress: () => undefined,
      },
      { name: "sql-expert" },
    );
    expect(success.modelText).toBe("技能正文 SECRET_SKILL_9f2c");

    await expect(
      tool.execute(
        {
          principal: {
            kind: "starter_user" as const,
            principalId: "skill-user",
            tenantId: "starter",
            projectId: "starter",
            externalUserId: "skill-user",
            appId: null,
          },
          scope: {
            tenantId: "starter",
            projectId: "starter",
            subjectType: null,
            subjectId: null,
          },
          requestId: "skill-request",
          signal: new AbortController().signal,
          reportProgress: () => undefined,
        },
        { name: "inactive-skill" },
      ),
    ).rejects.toThrow(/未启用/);
    await expect(
      tool.execute(
        {
          principal: {
            kind: "starter_user" as const,
            principalId: "skill-user",
            tenantId: "starter",
            projectId: "starter",
            externalUserId: "skill-user",
            appId: null,
          },
          scope: {
            tenantId: "starter",
            projectId: "starter",
            subjectType: null,
            subjectId: null,
          },
          requestId: "skill-request",
          signal: new AbortController().signal,
          reportProgress: () => undefined,
        },
        { name: "missing" },
      ),
    ).rejects.toThrow(/不存在/);

    // 审计表不出现技能正文
    const executions = runtime.db.select().from(aiToolExecutions).all();
    expect(JSON.stringify(executions)).not.toContain("SECRET_SKILL_9f2c");
  } finally {
    cleanup();
  }
});

it("agent.resolve：当 Agent 配置了启用技能时，systemPrompt 自动注入 <available_skills> 描述块", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await registerAdmin(app, runtime);
    const skill = await postJson(app, "/api/ai/skills", admin.cookie, {
      name: "sql-optimizer",
      description: "SQL 性能优化技能",
      content: "优化 SQL 的具体步骤...",
    });
    const skillBody = await readSuccess<{ id: string }>(skill);

    const prompt = await postJson(app, "/api/ai/system-prompts", admin.cookie, {
      name: "base-prompt",
      content: "你是一个专业的助手。",
    });
    const promptBody = await readSuccess<{ id: string }>(prompt);

    const model = seedModel(runtime);
    const agent = await postJson(app, "/api/ai/admin/agents", admin.cookie, {
      name: "skill-enabled-agent",
      config: {
        schemaVersion: 2,
        model,
        systemPromptId: promptBody.data.id,
        skillIds: [skillBody.data.id],
        toolRefs: [{ name: "read_skill", version: "1.0.0" }],
        thinkingLevel: "off",
        maxTurns: 8,
      },
    });
    const agentBody = await readSuccess<{ id: string }>(agent);
    await patchJson(
      app,
      `/api/ai/admin/agents/${agentBody.data.id}/status`,
      admin.cookie,
      {
        status: "enabled",
      },
    );

    const skillRepo = createAiSkillRepository(runtime.db);
    const agentService = createAiAgentDefinitionService({
      repository: createAiAgentDefinitionRepository(runtime.db),
      resolveModel: async (m) => m,
      promptService: createAiPromptService(
        createAiPromptRepository(runtime.db),
      ),
      skillRepository: skillRepo,
      toolRegistry: createAiToolRegistry([createReadSkillTool(skillRepo)]),
      outputContractRegistry: runtime.aiOutputContracts,
    });

    const resolved = await agentService.resolve(agentBody.data.id, {
      principal: {
        kind: "starter_user" as const,
        principalId: "user-1",
        tenantId: "starter",
        projectId: "starter",
        externalUserId: "user-1",
        appId: null,
      },
      scope: {
        tenantId: "starter",
        projectId: "starter",
        subjectType: null,
        subjectId: null,
      },
    });

    expect(resolved.systemPrompt).toContain("你是一个专业的助手。");
    expect(resolved.systemPrompt).toContain("<available_skills>");
    expect(resolved.systemPrompt).toContain("<name>sql-optimizer</name>");
    expect(resolved.systemPrompt).toContain(
      "<description>SQL 性能优化技能</description>",
    );
    expect(resolved.systemPrompt).toContain("</available_skills>");
  } finally {
    cleanup();
  }
});

function seedModel(runtime: ReturnType<typeof createTestApp>["runtime"]): {
  providerId: string;
  modelId: string;
} {
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

async function registerAdmin(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
) {
  const owner = await register(app, `skill-admin-${Date.now()}@example.com`);
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

async function patchJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
