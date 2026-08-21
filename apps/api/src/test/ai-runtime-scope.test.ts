import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  aiAppCredentials,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";
import { createTestApp, readSuccess, register } from "./helpers.js";

async function createCredential(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
  name: string,
  projectId: string,
) {
  const admin = await register(app, `${name}-${Date.now()}@example.com`);
  const adminRole = runtime.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "admin"))
    .get()!;
  const manage = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, "ai:config:manage"))
    .get()!;
  runtime.db
    .insert(rolePermissions)
    .values({
      roleId: adminRole.id,
      permissionId: manage.id,
      assignedAt: new Date(),
      assignedBy: null,
    })
    .onConflictDoNothing()
    .run();
  runtime.db
    .update(userRoles)
    .set({ roleId: adminRole.id })
    .where(eq(userRoles.userId, admin.user.id))
    .run();
  const response = await app.request("/api/ai/admin/applications", {
    method: "POST",
    headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name, tenantId: "tenant", projectId }),
  });
  const body = await readSuccess<{ secret: string }>(response);
  return body.data.secret;
}

function runtimeHeaders(secret: string, externalUserId: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "X-AI-External-User-Id": externalUserId,
    "Content-Type": "application/json",
  };
}

it("product app Session 按 app scope 和 externalUserId 隔离", async () => {
  const { app, runtime, cleanup } = createTestApp();
  try {
    const first = await createCredential(app, runtime, "first", "project-a");
    const second = await createCredential(app, runtime, "second", "project-b");
    const createdResponse = await app.request("/api/ai/sessions", {
      method: "POST",
      headers: runtimeHeaders(first, "user-1"),
      body: JSON.stringify({ title: "Scoped" }),
    });
    expect(createdResponse.status).toBe(200);
    const created = await readSuccess<{ id: string }>(createdResponse);
    const record = runtime.db
      .select()
      .from(aiAppCredentials)
      .where(eq(aiAppCredentials.projectId, "project-a"))
      .get()!;
    expect(record.status).toBe("active");

    const own = await app.request(`/api/ai/sessions/${created.data.id}`, {
      headers: runtimeHeaders(first, "user-1"),
    });
    expect(own.status).toBe(200);
    const otherUser = await app.request(`/api/ai/sessions/${created.data.id}`, {
      headers: runtimeHeaders(first, "user-2"),
    });
    expect(otherUser.status).toBe(404);
    const otherProject = await app.request(
      `/api/ai/sessions/${created.data.id}`,
      {
        headers: runtimeHeaders(second, "user-1"),
      },
    );
    expect(otherProject.status).toBe(404);
  } finally {
    cleanup();
  }
});
