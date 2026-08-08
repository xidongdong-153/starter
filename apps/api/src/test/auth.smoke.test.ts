import { expect, it } from "vitest";
import { ApiErrorCodes } from "@starter/contracts";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
  signIn,
} from "./helpers.js";

it("测试 runtime、健康检查、注册、登录、session 和退出流程可用", async () => {
  const { app, cleanup } = createTestApp();
  try {
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect((await readSuccess<{ ok: boolean }>(health)).data.ok).toBe(true);

    const email = "auth@example.com";
    const { cookie, user } = await register(app, email);
    expect(user.id[14]).toBe("7");
    expect(cookie).not.toBe("");

    const session = await app.request("/api/auth/get-session", {
      headers: { cookie },
    });
    expect(session.status).toBe(200);
    expect(((await session.json()) as { user: { id: string } }).user.id).toBe(
      user.id,
    );

    const signOut = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie },
    });
    expect(signOut.status).toBe(200);

    const loginCookie = await signIn(app, email);
    expect(loginCookie).not.toBe("");
    const me = await app.request("/api/me", {
      headers: { cookie: loginCookie },
    });
    expect(me.status).toBe(200);
    const meBody = await readSuccess<{
      user: { id: string };
      providers: string[];
    }>(me);
    expect(meBody.data.user.id).toBe(user.id);
    expect(meBody.data.providers).toContain("credential");
  } finally {
    cleanup();
  }
});

it("未登录、请求校验和 404 返回稳定错误", async () => {
  const { app, cleanup } = createTestApp();
  try {
    for (const path of ["/api/profile", "/api/files"]) {
      const response = await app.request(path);
      expect(response.status).toBe(401);
      expect((await readFailure(response)).error.code).toBe(
        ApiErrorCodes.AUTH_UNAUTHENTICATED,
      );
    }

    const invalid = await app.request("/api/profiles/not-a-uuid");
    expect(invalid.status).toBe(400);
    expect((await readFailure(invalid)).error.code).toBe(
      ApiErrorCodes.COMMON_INVALID_REQUEST,
    );

    const missing = await app.request("/does-not-exist");
    expect(missing.status).toBe(404);
    expect((await readFailure(missing)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );
  } finally {
    cleanup();
  }
});
