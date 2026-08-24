import type {
  Api,
  Model,
  ModelsStore,
  ModelsStoreEntry,
  ModelsStoreOperationOptions,
} from "@earendil-works/pi-ai";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import { aiModelCatalogs } from "@api/modules/ai/ai.schema.js";
import { parseBoundedJson } from "@api/shared/bounded-json.js";

export class AiModelsStore implements ModelsStore {
  constructor(private readonly db: AppDatabase) {}

  async read(
    providerId: string,
    options?: ModelsStoreOperationOptions,
  ): Promise<ModelsStoreEntry | undefined> {
    throwIfAborted(options?.signal);
    const row = this.db
      .select()
      .from(aiModelCatalogs)
      .where(eq(aiModelCatalogs.providerId, providerId))
      .get();
    throwIfAborted(options?.signal);
    if (!row) return undefined;

    const models = parseModels(row.modelsJson);
    return {
      models,
      ...(row.checkedAt ? { checkedAt: row.checkedAt.getTime() } : {}),
      ...(row.lastModified ? { lastModified: row.lastModified.getTime() } : {}),
      ...(row.etag ? { etag: row.etag } : {}),
    };
  }

  async write(
    providerId: string,
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal);
    const now = new Date();
    this.db
      .insert(aiModelCatalogs)
      .values({
        providerId,
        modelsJson: JSON.stringify(entry.models),
        checkedAt: toDate(entry.checkedAt),
        lastModified: toDate(entry.lastModified),
        etag: entry.etag ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: aiModelCatalogs.providerId,
        set: {
          modelsJson: JSON.stringify(entry.models),
          checkedAt: toDate(entry.checkedAt),
          lastModified: toDate(entry.lastModified),
          etag: entry.etag ?? null,
          updatedAt: now,
        },
      })
      .run();
    throwIfAborted(options?.signal);
  }

  async delete(
    providerId: string,
    options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal);
    this.db
      .delete(aiModelCatalogs)
      .where(eq(aiModelCatalogs.providerId, providerId))
      .run();
    throwIfAborted(options?.signal);
  }
}

function parseModels(json: string): readonly Model<Api>[] {
  let value: unknown;
  try {
    value = parseBoundedJson(json);
  } catch {
    throw new Error("AI model catalog is invalid");
  }

  if (!Array.isArray(value) || !value.every(isModel))
    throw new Error("AI model catalog is invalid");
  return value;
}

function isModel(value: unknown): value is Model<Api> {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.api === "string" &&
    typeof value.provider === "string" &&
    typeof value.baseUrl === "string" &&
    typeof value.reasoning === "boolean" &&
    Array.isArray(value.input) &&
    value.input.every((item) => item === "text" || item === "image") &&
    typeof value.contextWindow === "number" &&
    Number.isFinite(value.contextWindow) &&
    typeof value.maxTokens === "number" &&
    Number.isFinite(value.maxTokens) &&
    isCost(value.cost)
  );
}

function isCost(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["input", "output", "cacheRead", "cacheWrite"].every(
    (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDate(value: number | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
