import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  AiCredentialStore,
  AiCredentialConflictError,
} from "@api/infra/ai/ai-credential-store.js";
import {
  AiCredentialDecryptError,
  AiCredentialKeyUnavailableError,
  createAiCrypto,
} from "@api/infra/ai/ai-crypto.js";
import { AiModelsStore } from "@api/infra/ai/ai-models-store.js";
import {
  aiModelCatalogs,
  aiProviderConfigs,
} from "@api/infra/db/schema/index.js";

import { createTestApp } from "./helpers.js";

const key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const otherKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

describe("ai encrypted stores", () => {
  it("aes-256-GCM 每次使用随机 IV，并拒绝缺失、错误和损坏密钥", () => {
    const crypto = createAiCrypto(key);
    const payload = {
      credential: { type: "api_key" as const, key: "secret" },
      runtimeSettings: { ENDPOINT: "https://example.com" },
    };
    const first = crypto.encrypt(payload);
    const second = crypto.encrypt(payload);

    expect(first.payloadIv).not.toBe(second.payloadIv);
    expect(first.payloadCiphertext).not.toBe(second.payloadCiphertext);
    expect(crypto.decrypt(first)).toEqual(payload);
    expect(() => createAiCrypto(undefined).encrypt(payload)).toThrow(
      AiCredentialKeyUnavailableError,
    );
    expect(() => createAiCrypto(otherKey).decrypt(first)).toThrow(
      AiCredentialDecryptError,
    );
    expect(() =>
      crypto.decrypt({
        ...first,
        payloadCiphertext: `${first.payloadCiphertext.slice(0, -2)}AA`,
      }),
    ).toThrow(AiCredentialDecryptError);
  });

  it("credentialStore refresh 只增加 row version，undefined 不写库，delete 保留 runtime settings", async () => {
    const { cleanup, runtime } = createTestApp();
    try {
      const crypto = createAiCrypto(key);
      const encrypted = crypto.encrypt({
        credential: {
          type: "oauth",
          access: "old-access",
          refresh: "refresh-token",
          expires: 1,
        },
        runtimeSettings: { RADIUS_GATEWAY_URL: "https://radius.example.com" },
      });
      const now = new Date();
      runtime.db
        .insert(aiProviderConfigs)
        .values({
          providerId: "radius",
          enabled: true,
          credentialType: "oauth",
          ...encrypted,
          rowVersion: 4,
          configRevision: 3,
          checkedConfigRevision: 3,
          authStatus: "ready",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const store = new AiCredentialStore(runtime.db, crypto);

      await expect(
        store.modify("radius", async () => undefined),
      ).resolves.toMatchObject({ access: "old-access" });
      expect(readProvider(runtime, "radius")).toMatchObject({
        rowVersion: 4,
        configRevision: 3,
        enabled: true,
      });

      await store.modify("radius", async (current) => ({
        ...current!,
        type: "oauth",
        access: "new-access",
        refresh: "refresh-token",
        expires: 2,
      }));
      expect(readProvider(runtime, "radius")).toMatchObject({
        rowVersion: 5,
        configRevision: 3,
        checkedConfigRevision: 3,
        enabled: true,
      });

      await store.delete("radius");
      const deleted = readProvider(runtime, "radius")!;
      expect(deleted).toMatchObject({
        credentialType: null,
        rowVersion: 6,
        configRevision: 3,
        enabled: true,
      });
      await expect(store.read("radius")).resolves.toBeUndefined();
      expect(
        crypto.decrypt({
          payloadCiphertext: deleted.payloadCiphertext!,
          payloadIv: deleted.payloadIv!,
          payloadAuthTag: deleted.payloadAuthTag!,
          encryptionVersion: deleted.encryptionVersion!,
        }),
      ).toEqual({
        runtimeSettings: { RADIUS_GATEWAY_URL: "https://radius.example.com" },
      });
    } finally {
      cleanup();
    }
  });

  it("credentialStore CAS 冲突不覆盖较新的 credential", async () => {
    const { cleanup, runtime } = createTestApp();
    try {
      const crypto = createAiCrypto(key);
      const encrypted = crypto.encrypt({
        credential: { type: "api_key", key: "old-secret" },
        runtimeSettings: {},
      });
      const now = new Date();
      runtime.db
        .insert(aiProviderConfigs)
        .values({
          providerId: "openai",
          credentialType: "api_key",
          ...encrypted,
          rowVersion: 1,
          configRevision: 1,
          authStatus: "needs_check",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const store = new AiCredentialStore(runtime.db, crypto);

      await expect(
        store.modify("openai", async () => {
          runtime.db
            .update(aiProviderConfigs)
            .set({ rowVersion: 2 })
            .where(eq(aiProviderConfigs.providerId, "openai"))
            .run();
          return { type: "api_key", key: "stale-secret" };
        }),
      ).rejects.toBeInstanceOf(AiCredentialConflictError);
      await expect(store.read("openai")).resolves.toMatchObject({
        key: "old-secret",
      });
    } finally {
      cleanup();
    }
  });

  it("modelsStore 完整恢复 models、checkedAt、lastModified 和 etag，并拒绝损坏 JSON", async () => {
    const { cleanup, runtime } = createTestApp();
    try {
      const store = new AiModelsStore(runtime.db);
      const model = runtime.ai.getModelsCollection().getModels("openai")[0]!;
      const entry = {
        models: [model],
        checkedAt: 1_786_700_001_234,
        lastModified: 1_786_700_000_000,
        etag: '"catalog-v1"',
      };

      await store.write("radius", entry);
      await expect(store.read("radius")).resolves.toEqual(entry);

      runtime.db
        .update(aiModelCatalogs)
        .set({ modelsJson: "{secret-invalid-json" })
        .where(eq(aiModelCatalogs.providerId, "radius"))
        .run();
      await expect(store.read("radius")).rejects.toThrow(
        "AI model catalog is invalid",
      );
    } finally {
      cleanup();
    }
  });
});

function readProvider(
  runtime: ReturnType<typeof createTestApp>["runtime"],
  providerId: string,
) {
  return runtime.db
    .select()
    .from(aiProviderConfigs)
    .where(eq(aiProviderConfigs.providerId, providerId))
    .get();
}
