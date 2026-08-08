import type { Logger as DrizzleLogger } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { schema } from "./schema/index.js";

export type DatabaseBundle = {
  sqlite: InstanceType<typeof Database>;
  db: ReturnType<typeof drizzle>;
};

export function createDatabase(
  databasePath: string,
  logger?: DrizzleLogger,
): DatabaseBundle {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  return { sqlite, db: drizzle(sqlite, { schema, logger }) };
}

export type AppDatabase = DatabaseBundle["db"];
