import { AppError } from "@api/shared/app-error.js";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { createRequireProductApp } from "@api/modules/ai/application/application.guard.js";
import { createAiApplicationService } from "@api/modules/ai/application/application.service.js";
import {
  createAppSecret,
  hashAppSecret,
} from "@api/modules/ai/application/application.crypto.js";
import type { AiAppCredentialRecord } from "@api/modules/ai/application/application.repository.js";

function record(secret: string): AiAppCredentialRecord {
  const now = new Date();
  return {
    id: "01958c80-8df7-7ce2-8f90-123456789001",
    name: "Product",
    tenantId: "tenant-a",
    projectId: "project-a",
    secretHash: hashAppSecret(secret),
    secretPrefix: secret.slice(0, 12),
    status: "active",
    createdBy: "admin",
    updatedBy: "admin",
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    revokedAt: null,
  };
}

it("product app guard 从 credential 派生 scope，并拒绝缺失或不完整 subject", async () => {
  const generated = createAppSecret();
  let used = false;
  const appService = createAiApplicationService({
    repository: {
      list: () => [],
      findById: () => undefined,
      findActiveByPrefix: () => [record(generated.secret)],
      markUsed: () => {
        used = true;
      },
    } as never,
    logger: { info() {} } as never,
  });
  const app = new Hono();
  app.onError((error, context) =>
    context.text("error", error instanceof AppError ? error.status : 500),
  );
  app.use("/runtime", createRequireProductApp(appService));
  app.get("/runtime", (context) => {
    const principal = context.get("principal" as never) as {
      tenantId: string;
      projectId: string;
      externalUserId: string;
    };
    return context.json(principal);
  });

  const valid = await app.request("/runtime", {
    headers: {
      Authorization: `Bearer ${generated.secret}`,
      "X-AI-External-User-Id": "user-42",
      "X-AI-Subject-Type": "order",
      "X-AI-Subject-Id": "order-7",
    },
  });
  expect(valid.status).toBe(200);
  expect(await valid.json()).toMatchObject({
    tenantId: "tenant-a",
    projectId: "project-a",
    externalUserId: "user-42",
  });
  expect(used).toBe(true);

  const invalid = await app.request("/runtime", {
    headers: {
      Authorization: `Bearer ${generated.secret}`,
      "X-AI-External-User-Id": "user-42",
      "X-AI-Subject-Type": "order",
    },
  });
  expect(invalid.status).toBe(401);
});
