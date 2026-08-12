import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiErrorCodes } from "@starter/contracts";
import { expect, it } from "vitest";
import { createAuthorizationRepository } from "@api/modules/authorization/index.js";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

interface LogEntry {
  level?: number;
  time?: number;
  msg?: string;
  event?: string;
  requestId?: string;
  [key: string]: unknown;
}

const LOG_LINES: string[] = [
  JSON.stringify({
    event: "http.request.completed",
    level: 30,
    msg: "请求完成",
    requestId: "req-1",
    status: 200,
    time: 1000,
    userId: "u-1",
  }),
  JSON.stringify({
    event: "http.request.completed",
    level: 50,
    msg: "请求返回 5xx",
    requestId: "req-1",
    status: 500,
    time: 2000,
    userId: "u-1",
  }),
  JSON.stringify({
    durationMs: 1500,
    event: "http.request.completed",
    level: 40,
    msg: "请求耗时较长",
    requestId: "req-2",
    status: 200,
    time: 3000,
  }),
  JSON.stringify({
    event: "files.upload.succeeded",
    fileId: "f-1",
    level: 30,
    msg: "文件上传成功",
    requestId: "req-3",
    time: 4000,
    userId: "u-2",
  }),
  JSON.stringify({
    actorId: "u-1",
    event: "users.status.changed",
    from: "active",
    level: 30,
    msg: "用户状态变更",
    requestId: "req-4",
    targetUserId: "u-2",
    time: 5000,
    to: "suspended",
  }),
  "not-a-json-line",
  JSON.stringify({
    err: { message: "x" },
    event: "llm.failed",
    level: 50,
    msg: "boom",
    requestId: "req-5",
    time: 6000,
  }),
];

function createLogsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "starter-logs-"));
  writeFileSync(join(dir, "app.2026-08-12.log"), `${LOG_LINES.join("\n")}\n`);
  writeFileSync(
    join(dir, "app.2026-08-11.log"),
    `${JSON.stringify({
      event: "http.request.completed",
      level: 30,
      msg: "旧日志",
      requestId: "req-0",
      status: 200,
      time: 500,
    })}\n`,
  );
  return dir;
}

async function bootstrapAdmin(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
  email: string,
) {
  const admin = await register(app, email);
  const repository = createAuthorizationRepository(runtime.db);
  expect(
    repository.bootstrapAdminByEmail(email, {
      actorType: "system",
      actorId: "auth:bootstrap-admin",
      requestId: null,
    }).kind,
  ).toBe("ok");
  return admin;
}

function timesOf(items: LogEntry[]): number[] {
  return items.map((item) => item.time as number);
}

it("日志接口权限：未认证 401，非 admin 403，admin 可查且按时间倒序", async () => {
  const logsDir = createLogsDir();
  const { app, cleanup, runtime } = createTestApp({ LOGS_DIR: logsDir });
  try {
    expect((await app.request("/api/system/logs")).status).toBe(401);

    const operator = await register(app, "logs-operator@example.com");
    const denied = await app.request("/api/system/logs", {
      headers: { cookie: operator.cookie },
    });
    expect(denied.status).toBe(403);
    expect((await readFailure(denied)).error.code).toBe(
      ApiErrorCodes.AUTH_FORBIDDEN,
    );

    const admin = await bootstrapAdmin(app, runtime, "logs-admin@example.com");
    const ok = await app.request("/api/system/logs", {
      headers: { cookie: admin.cookie },
    });
    expect(ok.status).toBe(200);
    const data = (await readSuccess<{ items: LogEntry[] }>(ok)).data;
    // 倒序（最新在前）、损坏行跳过、跨文件（旧文件 500 排最后）
    expect(timesOf(data.items)).toEqual([
      6000, 5000, 4000, 3000, 2000, 1000, 500,
    ]);
  } finally {
    cleanup();
    rmSync(logsDir, { recursive: true, force: true });
  }
});

it("日志接口过滤：level、query、limit、before 分页", async () => {
  const logsDir = createLogsDir();
  const { app, cleanup, runtime } = createTestApp({ LOGS_DIR: logsDir });
  try {
    const admin = await bootstrapAdmin(
      app,
      runtime,
      "logs-filter-admin@example.com",
    );
    const get = (search: string) =>
      app.request(`/api/system/logs${search}`, {
        headers: { cookie: admin.cookie },
      });

    const levelError = await readSuccess<{ items: LogEntry[] }>(
      await get("?level=error"),
    );
    expect(timesOf(levelError.data.items)).toEqual([6000, 2000]);

    const queryUpload = await readSuccess<{ items: LogEntry[] }>(
      await get("?query=files.upload"),
    );
    expect(timesOf(queryUpload.data.items)).toEqual([4000]);

    const limited = await readSuccess<{ items: LogEntry[] }>(
      await get("?limit=2"),
    );
    expect(timesOf(limited.data.items)).toEqual([6000, 5000]);

    const paged = await readSuccess<{ items: LogEntry[] }>(
      await get("?before=3000"),
    );
    expect(timesOf(paged.data.items)).toEqual([2000, 1000, 500]);
  } finally {
    cleanup();
    rmSync(logsDir, { recursive: true, force: true });
  }
});

it("日志接口 requestId 链路：精确过滤并按时间正序", async () => {
  const logsDir = createLogsDir();
  const { app, cleanup, runtime } = createTestApp({ LOGS_DIR: logsDir });
  try {
    const admin = await bootstrapAdmin(
      app,
      runtime,
      "logs-link-admin@example.com",
    );
    const response = await app.request("/api/system/logs?requestId=req-1", {
      headers: { cookie: admin.cookie },
    });
    expect(response.status).toBe(200);
    const data = (await readSuccess<{ items: LogEntry[] }>(response)).data;
    expect(timesOf(data.items)).toEqual([1000, 2000]);
    expect(data.items.every((item) => item.requestId === "req-1")).toBe(true);
  } finally {
    cleanup();
    rmSync(logsDir, { recursive: true, force: true });
  }
});

it("日志接口未配置 LOGS_DIR 时返回 400", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await bootstrapAdmin(
      app,
      runtime,
      "logs-nodir-admin@example.com",
    );
    const response = await app.request("/api/system/logs", {
      headers: { cookie: admin.cookie },
    });
    expect(response.status).toBe(400);
    expect((await readFailure(response)).error.code).toBe(
      ApiErrorCodes.COMMON_INVALID_REQUEST,
    );
  } finally {
    cleanup();
  }
});
