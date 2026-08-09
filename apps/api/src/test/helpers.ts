import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ApiFailure, ApiSuccess } from "@starter/contracts";
import { createApp, createRuntime } from "@api/app.js";

const migrationFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../infra/db/migrations",
);

export function createTestApp(envOverrides: NodeJS.ProcessEnv = {}) {
  const testDir = mkdtempSync(join(tmpdir(), "starter-api-"));
  const runtime = createRuntime({
    APP_ENV: "test",
    PORT: "7788",
    DATABASE_PATH: join(testDir, "app.db"),
    FILES_DIR: join(testDir, "files"),
    BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
    BETTER_AUTH_URL: "http://localhost:7788",
    CORS_ORIGINS: "http://localhost:2333,http://localhost:4399",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    AUTH_BOOTSTRAP_ADMIN_EMAIL: "",
    ...envOverrides,
  });
  migrate(runtime.db, { migrationsFolder: migrationFolder });

  let closed = false;
  return {
    app: createApp(runtime),
    runtime,
    cleanup() {
      if (closed) return;
      closed = true;
      runtime.database.sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    },
  };
}

export async function register(
  app: ReturnType<typeof createApp>,
  email: string,
) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test User",
      email,
      password: "password-123",
    }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const body = (await response.json()) as { user: { id: string } };
  return { cookie, user: body.user };
}

export async function signIn(app: ReturnType<typeof createApp>, email: string) {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password-123" }),
  });
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

export async function readSuccess<T>(
  response: Response,
): Promise<ApiSuccess<T>> {
  return (await response.json()) as ApiSuccess<T>;
}

export async function readFailure(response: Response): Promise<ApiFailure> {
  return (await response.json()) as ApiFailure;
}
