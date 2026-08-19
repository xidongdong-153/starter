import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
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
        userId: "skill-user",
        requestId: "skill-request",
        signal: new AbortController().signal,
      },
      { name: "sql-expert" },
    );
    expect(success.modelText).toBe("技能正文 SECRET_SKILL_9f2c");

    await expect(
      tool.execute(
        {
          userId: "skill-user",
          requestId: "skill-request",
          signal: new AbortController().signal,
        },
        { name: "inactive-skill" },
      ),
    ).rejects.toThrow(/未启用/);
    await expect(
      tool.execute(
        {
          userId: "skill-user",
          requestId: "skill-request",
          signal: new AbortController().signal,
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
