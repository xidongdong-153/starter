import type {
  AiAuthSource,
  AiAuthStatus,
  AiModelRef,
} from "@starter/contracts";
import type { AppDatabase } from "@api/infra/db/client.js";
import type { AiPreparedProviderPayload } from "@api/infra/ai/index.js";
import { and, eq } from "drizzle-orm";

import {
  aiEnabledModels,
  aiProviderConfigs,
  aiSettings,
  userAiPreferences,
} from "../ai.schema.js";

export class AiProviderConfigConflictError extends Error {
  constructor() {
    super("AI Provider config changed concurrently");
    this.name = "AiProviderConfigConflictError";
  }
}

export type AiProviderConfigRecord = typeof aiProviderConfigs.$inferSelect;
export type AiEnabledModelRecord = typeof aiEnabledModels.$inferSelect;
export type AiUserPreferenceRecord = typeof userAiPreferences.$inferSelect;

export function createAiRepository(db: AppDatabase) {
  function listProviderConfigs(): AiProviderConfigRecord[] {
    return db.select().from(aiProviderConfigs).all();
  }

  function findProviderConfig(
    providerId: string,
  ): AiProviderConfigRecord | undefined {
    return db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.providerId, providerId))
      .get();
  }

  function saveProviderConfig(
    providerId: string,
    payload: AiPreparedProviderPayload,
    actorId: string,
    expectedRowVersion: number | null,
  ): AiProviderConfigRecord {
    return db.transaction((tx) => {
      const current = tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, providerId))
        .get();
      if ((current?.rowVersion ?? null) !== expectedRowVersion)
        throw new AiProviderConfigConflictError();
      const now = new Date();
      const configRevision = (current?.configRevision ?? 0) + 1;
      const values = {
        providerId,
        enabled: false,
        credentialType: payload.credentialType,
        credentialHint: payload.credentialHint,
        payloadCiphertext: payload.payloadCiphertext,
        payloadIv: payload.payloadIv,
        payloadAuthTag: payload.payloadAuthTag,
        encryptionVersion: payload.encryptionVersion,
        rowVersion: (current?.rowVersion ?? 0) + 1,
        configRevision,
        checkedConfigRevision: null,
        authStatus: "needs_check",
        authSource: null,
        lastCheckedAt: null,
        lastCheckErrorCode: null,
        updatedBy: actorId,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      } as const;

      tx.insert(aiProviderConfigs)
        .values(values)
        .onConflictDoUpdate({
          target: aiProviderConfigs.providerId,
          set: values,
        })
        .run();
      clearGlobalDefaultForProvider(tx, providerId, actorId, now);
      return tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, providerId))
        .get()!;
    });
  }

  function clearProviderCredential(
    providerId: string,
    payload: AiPreparedProviderPayload | null,
    actorId: string,
    expectedRowVersion: number | null,
  ): AiProviderConfigRecord {
    return db.transaction((tx) => {
      const current = tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, providerId))
        .get();
      if ((current?.rowVersion ?? null) !== expectedRowVersion)
        throw new AiProviderConfigConflictError();
      const now = new Date();
      const configRevision = (current?.configRevision ?? 0) + 1;
      const values = {
        providerId,
        enabled: false,
        credentialType: null,
        credentialHint: null,
        payloadCiphertext: payload?.payloadCiphertext ?? null,
        payloadIv: payload?.payloadIv ?? null,
        payloadAuthTag: payload?.payloadAuthTag ?? null,
        encryptionVersion: payload?.encryptionVersion ?? null,
        rowVersion: (current?.rowVersion ?? 0) + 1,
        configRevision,
        checkedConfigRevision: null,
        authStatus: "needs_check",
        authSource: null,
        lastCheckedAt: null,
        lastCheckErrorCode: null,
        updatedBy: actorId,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      } as const;
      tx.insert(aiProviderConfigs)
        .values(values)
        .onConflictDoUpdate({
          target: aiProviderConfigs.providerId,
          set: values,
        })
        .run();
      clearGlobalDefaultForProvider(tx, providerId, actorId, now);
      return tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, providerId))
        .get()!;
    });
  }

  function recordAuthCheck(input: {
    providerId: string;
    expectedConfigRevision: number | null;
    status: AiAuthStatus;
    source: AiAuthSource | null;
    credentialType: "api_key" | "oauth" | null;
    errorCode: string | null;
    actorId: string;
  }): AiProviderConfigRecord {
    return db.transaction((tx) => {
      const current = tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, input.providerId))
        .get();
      if ((current?.configRevision ?? null) !== input.expectedConfigRevision)
        throw new AiProviderConfigConflictError();
      const now = new Date();
      const values = {
        providerId: input.providerId,
        enabled: input.status === "ready" ? (current?.enabled ?? false) : false,
        credentialType: current?.credentialType ?? input.credentialType,
        credentialHint: current?.credentialHint ?? null,
        payloadCiphertext: current?.payloadCiphertext ?? null,
        payloadIv: current?.payloadIv ?? null,
        payloadAuthTag: current?.payloadAuthTag ?? null,
        encryptionVersion: current?.encryptionVersion ?? null,
        rowVersion: current?.rowVersion ?? 0,
        configRevision: current?.configRevision ?? 0,
        checkedConfigRevision:
          input.status === "ready" ? (current?.configRevision ?? 0) : null,
        authStatus: input.status,
        authSource: input.source,
        lastCheckedAt: now,
        lastCheckErrorCode: input.errorCode,
        updatedBy: input.actorId,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      } as const;
      tx.insert(aiProviderConfigs)
        .values(values)
        .onConflictDoUpdate({
          target: aiProviderConfigs.providerId,
          set: values,
        })
        .run();
      if (input.status !== "ready")
        clearGlobalDefaultForProvider(tx, input.providerId, input.actorId, now);
      return tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, input.providerId))
        .get()!;
    });
  }

  function setProviderEnabled(
    providerId: string,
    enabled: boolean,
    actorId: string,
  ): AiProviderConfigRecord | undefined {
    return db.transaction((tx) => {
      const current = tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, providerId))
        .get();
      if (
        !current ||
        (enabled &&
          (current.authStatus !== "ready" ||
            current.checkedConfigRevision !== current.configRevision))
      ) {
        return undefined;
      }
      const now = new Date();
      tx.update(aiProviderConfigs)
        .set({ enabled, updatedBy: actorId, updatedAt: now })
        .where(eq(aiProviderConfigs.providerId, providerId))
        .run();
      if (!enabled) clearGlobalDefaultForProvider(tx, providerId, actorId, now);
      return tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, providerId))
        .get()!;
    });
  }

  function markCredentialChanged(providerId: string): AiProviderConfigRecord {
    return db.transaction((tx) => {
      const current = tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, providerId))
        .get();
      const now = new Date();
      const values = {
        providerId,
        enabled: false,
        credentialType: current?.credentialType ?? null,
        credentialHint: current?.credentialHint ?? null,
        payloadCiphertext: current?.payloadCiphertext ?? null,
        payloadIv: current?.payloadIv ?? null,
        payloadAuthTag: current?.payloadAuthTag ?? null,
        encryptionVersion: current?.encryptionVersion ?? null,
        rowVersion: current?.rowVersion ?? 0,
        configRevision: (current?.configRevision ?? 0) + 1,
        checkedConfigRevision: null,
        authStatus: "needs_check",
        authSource: null,
        lastCheckedAt: null,
        lastCheckErrorCode: null,
        updatedBy: null,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      } as const;
      tx.insert(aiProviderConfigs)
        .values(values)
        .onConflictDoUpdate({
          target: aiProviderConfigs.providerId,
          set: values,
        })
        .run();
      clearGlobalDefaultForProvider(tx, providerId, null, now);
      return tx
        .select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.providerId, providerId))
        .get()!;
    });
  }

  function listEnabledModels(): AiEnabledModelRecord[] {
    return db.select().from(aiEnabledModels).all();
  }

  function replaceEnabledModels(
    models: readonly AiModelRef[],
    actorId: string,
  ): void {
    db.transaction((tx) => {
      tx.delete(aiEnabledModels).run();
      const now = new Date();
      if (models.length > 0) {
        tx.insert(aiEnabledModels)
          .values(
            models.map((model) => ({
              ...model,
              enabledAt: now,
              updatedBy: actorId,
            })),
          )
          .run();
      }
      const global = findGlobalDefaultWith(tx);
      if (global && !hasRef(models, global))
        setGlobalDefaultWith(tx, null, actorId, now);
    });
  }

  function pruneProviderModels(
    providerId: string,
    validModelIds: readonly string[],
    actorId: string,
  ): void {
    db.transaction((tx) => {
      const providerRows = tx
        .select()
        .from(aiEnabledModels)
        .where(eq(aiEnabledModels.providerId, providerId))
        .all();
      for (const row of providerRows) {
        if (!validModelIds.includes(row.modelId)) {
          tx.delete(aiEnabledModels)
            .where(
              and(
                eq(aiEnabledModels.providerId, providerId),
                eq(aiEnabledModels.modelId, row.modelId),
              ),
            )
            .run();
        }
      }
      const global = findGlobalDefaultWith(tx);
      if (
        global?.providerId === providerId &&
        !validModelIds.includes(global.modelId)
      ) {
        setGlobalDefaultWith(tx, null, actorId, new Date());
      }
    });
  }

  function findGlobalDefault(): AiModelRef | null {
    return findGlobalDefaultWith(db);
  }

  function setGlobalDefault(model: AiModelRef | null, actorId: string): void {
    setGlobalDefaultWith(db, model, actorId, new Date());
  }

  function findUserPreference(
    userId: string,
  ): AiUserPreferenceRecord | undefined {
    return db
      .select()
      .from(userAiPreferences)
      .where(eq(userAiPreferences.userId, userId))
      .get();
  }

  function setUserPreference(userId: string, model: AiModelRef | null): void {
    if (!model) {
      db.delete(userAiPreferences)
        .where(eq(userAiPreferences.userId, userId))
        .run();
      return;
    }
    const values = {
      userId,
      providerId: model.providerId,
      modelId: model.modelId,
      updatedAt: new Date(),
    };
    db.insert(userAiPreferences)
      .values(values)
      .onConflictDoUpdate({ target: userAiPreferences.userId, set: values })
      .run();
  }

  return {
    listProviderConfigs,
    findProviderConfig,
    saveProviderConfig,
    clearProviderCredential,
    recordAuthCheck,
    setProviderEnabled,
    markCredentialChanged,
    listEnabledModels,
    replaceEnabledModels,
    pruneProviderModels,
    findGlobalDefault,
    setGlobalDefault,
    findUserPreference,
    setUserPreference,
  };
}

function hasRef(models: readonly AiModelRef[], target: AiModelRef): boolean {
  return models.some(
    (model) =>
      model.providerId === target.providerId &&
      model.modelId === target.modelId,
  );
}

type Transaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
type DbLike = AppDatabase | Transaction;

function findGlobalDefaultWith(db: DbLike): AiModelRef | null {
  const row = db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, "global"))
    .get();
  return row?.globalProviderId && row.globalModelId
    ? { providerId: row.globalProviderId, modelId: row.globalModelId }
    : null;
}

function setGlobalDefaultWith(
  db: DbLike,
  model: AiModelRef | null,
  actorId: string | null,
  now: Date,
): void {
  const values = {
    id: "global",
    globalProviderId: model?.providerId ?? null,
    globalModelId: model?.modelId ?? null,
    updatedBy: actorId,
    updatedAt: now,
  };
  db.insert(aiSettings)
    .values(values)
    .onConflictDoUpdate({ target: aiSettings.id, set: values })
    .run();
}

function clearGlobalDefaultForProvider(
  db: DbLike,
  providerId: string,
  actorId: string | null,
  now: Date,
): void {
  const current = findGlobalDefaultWith(db);
  if (current?.providerId === providerId)
    setGlobalDefaultWith(db, null, actorId, now);
}
