import { expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

it("openAPI 文档和 Scalar 页面可用", async () => {
  const { app, cleanup } = createTestApp();
  try {
    const response = await app.request("/doc");
    expect(response.status).toBe(200);

    const document = (await response.json()) as {
      openapi: string;
      paths: Record<
        string,
        Record<string, { responses?: Record<string, unknown> }>
      >;
      components?: { securitySchemes?: Record<string, unknown> };
    };
    expect(document.openapi).toBe("3.0.0");
    expect(document.paths["/api/profile"]?.get).toBeDefined();
    expect(document.paths["/api/files"]?.post).toBeDefined();
    expect(document.paths["/api/profiles/{userId}"]?.get).toBeDefined();
    expect(document.paths["/api/files/{fileId}/content"]).toBeUndefined();
    expect(document.paths["/api/me/permissions"]?.get).toBeDefined();
    expect(document.paths["/api/authorization/users"]?.get).toBeDefined();
    expect(
      document.paths["/api/authorization/users/{userId}/roles"]?.put
        ?.responses?.["403"],
    ).toBeDefined();
    expect(
      document.paths["/api/authorization/roles/{roleKey}/permissions"]?.put
        ?.responses?.["403"],
    ).toBeDefined();
    expect(document.components?.securitySchemes?.cookieAuth).toBeDefined();

    const reference = await app.request("/reference");
    expect(reference.status).toBe(200);
    expect(reference.headers.get("content-type")).toContain("text/html");
    const html = await reference.text();
    expect(html).toContain('id="app"');
    expect(html).toContain("/doc");
    expect(html).toContain(
      "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.64.1",
    );
  } finally {
    cleanup();
  }
});

it("openAPI_ENABLED=false 时不注册文档路由，业务接口不受影响", async () => {
  const { app, cleanup } = createTestApp({ OPENAPI_ENABLED: "false" });
  try {
    expect((await app.request("/doc")).status).toBe(404);
    expect((await app.request("/reference")).status).toBe(404);

    const health = await app.request("/health");
    expect(health.status).toBe(200);
  } finally {
    cleanup();
  }
});
