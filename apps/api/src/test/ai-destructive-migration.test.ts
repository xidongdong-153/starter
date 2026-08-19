import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../infra/db/migrations",
);
const legacyMigrations = [
  "0000_broken_komodo.sql",
  "0001_tidy_hellcat.sql",
  "0002_mean_iron_fist.sql",
  "0003_motionless_wrecker.sql",
  "0004_system_logs_read.sql",
  "0005_pale_madrox.sql",
  "0006_crazy_banshee.sql",
  "0007_clammy_shinobi_shaw.sql",
  "0008_illegal_giant_girl.sql",
  "0009_goofy_jean_grey.sql",
  "0010_brief_eddie_brock.sql",
  "0011_normal_sentinel.sql",
];

function runMigration(sqlite: Database.Database, file: string) {
  // 与 drizzle-kit SQLiteSyncDialect.migrate 一致：在单个事务内逐条执行。
  // 注意：事务内 PRAGMA foreign_keys=OFF 是 no-op，migration 不能依赖它。
  const sql = readFileSync(resolve(migrationsFolder, file), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((stmt) => stmt.trim())
    .filter(Boolean);
  sqlite.exec("BEGIN");
  try {
    for (const stmt of statements) sqlite.exec(stmt);
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

it("destructive migration 删除旧三表、归一 legacy 审计并保留其余数据", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.pragma("foreign_keys = ON");
    for (const migration of legacyMigrations) runMigration(sqlite, migration);

    const now = 1_787_000_000_000;
    sqlite
      .prepare(
        `INSERT INTO user
          (id, name, email, email_verified, image, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("user-1", "User", "user@example.com", 0, null, now, now);
    sqlite
      .prepare(
        `INSERT INTO ai_conversations
          (id, owner_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("conversation-1", "user-1", "Legacy", "idle", now, now);
    sqlite
      .prepare(
        `INSERT INTO ai_conversation_messages
          (id, conversation_id, sequence, role, content_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "message-1",
        "conversation-1",
        1,
        "user",
        "{}",
        "completed",
        now,
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO ai_generations
          (id, conversation_id, owner_id, status, user_message_id, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "generation-1",
        "conversation-1",
        "user-1",
        "completed",
        "message-1",
        now,
        now + 100,
      );
    sqlite
      .prepare(
        `INSERT INTO ai_model_calls
          (id, request_id, user_id, scenario, conversation_id, generation_id,
           run_id, provider_id, model_id, started_at, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "call-conv",
        "request-1",
        "user-1",
        "conversation",
        "conversation-1",
        "generation-1",
        null,
        "openai",
        "gpt-4o",
        now,
        "succeeded",
      );
    sqlite
      .prepare(
        `INSERT INTO ai_model_calls
          (id, request_id, user_id, scenario, conversation_id, generation_id,
           run_id, provider_id, model_id, started_at, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "call-test",
        "request-2",
        "user-1",
        "model_test",
        null,
        null,
        null,
        "openai",
        "gpt-4o",
        now,
        "succeeded",
      );
    sqlite
      .prepare(
        `INSERT INTO ai_agent_definitions
          (id, name, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("agent-1", "Agent", "{}", now, now);
    sqlite
      .prepare(
        `INSERT INTO ai_agent_sessions
          (id, owner_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("session-1", "user-1", "Session", now, now);
    sqlite
      .prepare(
        `INSERT INTO ai_agent_runs
          (id, session_id, agent_id, lane, status, agent_revision,
           snapshot_json, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "run-1",
        "session-1",
        "agent-1",
        "main",
        "completed",
        1,
        "{}",
        "request-3",
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO ai_model_calls
          (id, request_id, user_id, scenario, conversation_id, generation_id,
           run_id, provider_id, model_id, started_at, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "call-run",
        "request-3",
        "user-1",
        "agent_run",
        null,
        null,
        "run-1",
        "openai",
        "gpt-4o",
        now,
        "succeeded",
      );
    sqlite
      .prepare(
        `INSERT INTO ai_provider_configs (provider_id, created_at, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run("openai", now, now);
    sqlite
      .prepare(
        `INSERT INTO ai_system_prompts (id, name, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("prompt-1", "Prompt", "System prompt", now, now);
    sqlite
      .prepare(
        `INSERT INTO ai_skills (id, name, description, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("skill-1", "Skill", "Description", "Content", now, now);
    sqlite
      .prepare(
        `INSERT INTO ai_tool_executions
          (id, ai_call_id, tool_name, started_at, status, timeout_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("tool-1", "call-run", "lookup", now, "succeeded", 5000);

    runMigration(sqlite, "0012_far_lockjaw.sql");
    sqlite.pragma("foreign_keys = ON");

    const tables = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    for (const removed of [
      "ai_conversations",
      "ai_conversation_messages",
      "ai_generations",
    ]) {
      expect(tables).not.toContain(removed);
    }
    for (const kept of [
      "ai_agent_definitions",
      "ai_agent_sessions",
      "ai_agent_runs",
      "ai_model_calls",
      "ai_tool_executions",
      "ai_provider_configs",
      "ai_system_prompts",
      "ai_skills",
    ]) {
      expect(tables).toContain(kept);
    }

    expect(
      (
        sqlite
          .prepare(
            `SELECT COUNT(*) AS count FROM ai_model_calls WHERE scenario = 'legacy' AND run_id IS NULL`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        sqlite
          .prepare(
            `SELECT COUNT(*) AS count FROM ai_model_calls WHERE scenario = 'model_test'`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        sqlite
          .prepare(
            `SELECT COUNT(*) AS count FROM ai_model_calls WHERE scenario = 'agent_run' AND run_id = 'run-1'`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);

    for (const table of [
      "ai_agent_runs",
      "ai_system_prompts",
      "ai_skills",
      "ai_tool_executions",
    ]) {
      expect(
        (
          sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          }
        ).count,
      ).toBe(1);
    }

    expect(sqlite.pragma("foreign_key_check")).toEqual([]);

    const schemaSql = (
      sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE name = 'ai_model_calls'")
        .get() as { sql: string }
    ).sql;
    expect(schemaSql).toContain("'legacy'");
    expect(schemaSql).not.toContain("conversation_id");
    expect(schemaSql).not.toContain("generation_id");
  } finally {
    sqlite.close();
  }
});
