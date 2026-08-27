import { describe, expect, it } from "vitest";

import { createAiRunEventRepository } from "@api/modules/ai/run/run-event.repository.js";
import { createAiStructuredOutputRepository } from "@api/modules/ai/output/structured-output.repository.js";
import { toAgentRun } from "@api/modules/ai/run/run.presenter.js";
import { createAiAgentRunRepository } from "@api/modules/ai/run/run.repository.js";
import { parseAgentDefinitionConfig } from "@api/modules/ai/agent/agent.presenter.js";
import { StoredJsonError } from "@api/shared/stored-json.js";
import { createTestApp } from "./helpers.js";

const runId = "01958c80-8df7-7ce2-8f90-1234567890a1";
const sessionId = "01958c80-8df7-7ce2-8f90-1234567890a2";
const agentId = "01958c80-8df7-7ce2-8f90-1234567890a3";
const turnId = "01958c80-8df7-7ce2-8f90-1234567890a4";
const stepId = "01958c80-8df7-7ce2-8f90-1234567890a5";

const SNAPSHOT = JSON.stringify({
  schemaVersion: 2,
  agentId,
  agentRevision: 1,
  model: { providerId: "openai", modelId: "gpt-4o" },
  systemPromptId: null,
  skillIds: [],
  toolRefs: [],
  outputContract: null,
  outputMode: "optional",
  thinkingLevel: "off",
  maxTurns: 8,
});

const CONFIG = JSON.stringify({
  schemaVersion: 2,
  model: { providerId: "openai", modelId: "gpt-4o" },
  systemPromptId: null,
  skillIds: [],
  toolRefs: [],
  outputContract: null,
  outputMode: "optional",
  thinkingLevel: "off",
  maxTurns: 8,
});

function seedRun(runtime: ReturnType<typeof createTestApp>["runtime"]) {
  const now = Date.now();
  const sqlite = runtime.database.sqlite;
  sqlite
    .prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("user-1", "User", "user@example.com", 0, now, now);
  sqlite
    .prepare(
      `INSERT INTO ai_agent_definitions
        (id, name, status, revision, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(agentId, "Agent", "enabled", 1, CONFIG, now, now);
  sqlite
    .prepare(
      `INSERT INTO ai_agent_sessions (id, owner_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, "user-1", "Session", now, now);
  sqlite
    .prepare(
      `INSERT INTO ai_agent_runs
        (id, session_id, agent_id, lane, status, agent_revision,
         snapshot_json, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      sessionId,
      agentId,
      "main",
      "running",
      1,
      SNAPSHOT,
      "request-1",
      now,
    );
  sqlite
    .prepare(
      `INSERT INTO ai_run_turns (id, run_id, turn_index, started_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(turnId, runId, 1, now);
  sqlite
    .prepare(
      `INSERT INTO ai_run_steps
        (id, run_id, turn_id, kind, attempt, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(stepId, runId, turnId, "assistant", 1, now);
}

function eventDraft() {
  return {
    runId,
    sessionId,
    lane: "main" as const,
    turnIndex: null,
    stepId: null,
    modelCallId: null,
    messageId: null,
    toolCallId: null,
    toolExecutionId: null,
    type: "turn.started" as const,
    data: { stepLimit: 8 },
  };
}

describe("主库 JSON 列读取", () => {
  it("被破坏的 snapshot_json 读取时报数据损坏，不返回脏数据", () => {
    const test = createTestApp();
    try {
      seedRun(test.runtime);
      const repository = createAiAgentRunRepository(test.runtime.db);
      // 语法错误被表级 CHECK json_valid 拦住，不可能进到读取路径。
      expect(() =>
        test.runtime.database.sqlite
          .prepare(`UPDATE ai_agent_runs SET snapshot_json = ? WHERE id = ?`)
          .run("{not json", runId),
      ).toThrowError(/ai_agent_runs_snapshot_json_check/u);

      test.runtime.database.sqlite
        .prepare(`UPDATE ai_agent_runs SET snapshot_json = ? WHERE id = ?`)
        .run(JSON.stringify({ schemaVersion: 2 }), runId);
      const mismatched = repository.findById(runId)!;
      expect(() => toAgentRun(mismatched)).toThrowError(StoredJsonError);
      try {
        toAgentRun(mismatched);
        throw new Error("应当抛出数据损坏错误");
      } catch (error) {
        expect(error).toBeInstanceOf(StoredJsonError);
        const stored = error as StoredJsonError;
        expect(stored.column).toBe("ai_agent_runs.snapshot_json");
        expect(stored.reason).toBe("schema_mismatch");
        expect(stored.status).toBe(500);
      }
    } finally {
      test.cleanup();
    }
  });

  it("被破坏的 payload_json 读取时报数据损坏", () => {
    const test = createTestApp();
    try {
      seedRun(test.runtime);
      const repository = createAiRunEventRepository(test.runtime.db);
      const event = repository.append(eventDraft());
      test.runtime.database.sqlite
        .prepare(`UPDATE ai_run_events SET payload_json = ? WHERE event_id = ?`)
        .run("{not json", event.eventId);
      try {
        repository.listAfter(runId, 0, 10);
        throw new Error("应当抛出数据损坏错误");
      } catch (error) {
        expect(error).toBeInstanceOf(StoredJsonError);
        const stored = error as StoredJsonError;
        expect(stored.column).toBe("ai_run_events.payload_json");
        expect(stored.reason).toBe("invalid_json");
      }

      test.runtime.database.sqlite
        .prepare(`UPDATE ai_run_events SET payload_json = ? WHERE event_id = ?`)
        .run('{"type":"turn.started"}', event.eventId);
      try {
        repository.listAfter(runId, 0, 10);
        throw new Error("应当抛出数据损坏错误");
      } catch (error) {
        expect(error).toBeInstanceOf(StoredJsonError);
        expect((error as StoredJsonError).reason).toBe("schema_mismatch");
      }
    } finally {
      test.cleanup();
    }
  });

  it("被破坏的 value_json 读取时报数据损坏", () => {
    const test = createTestApp();
    try {
      seedRun(test.runtime);
      const repository = createAiStructuredOutputRepository(test.runtime.db);
      const record = repository.create({
        runId,
        stepId,
        contractName: "decision.summary",
        contractVersion: "1.0.0",
        schemaHash: "a".repeat(64),
        renderKind: "decision",
        value: { verdict: "approved" },
      });
      expect(repository.findById(record.id)?.value).toEqual({
        verdict: "approved",
      });

      test.runtime.database.sqlite
        .prepare(`UPDATE ai_structured_outputs SET value_json = ? WHERE id = ?`)
        .run("[1,2,3]", record.id);
      try {
        repository.findById(record.id);
        throw new Error("应当抛出数据损坏错误");
      } catch (error) {
        expect(error).toBeInstanceOf(StoredJsonError);
        expect((error as StoredJsonError).column).toBe(
          "ai_structured_outputs.value_json",
        );
        expect((error as StoredJsonError).reason).toBe("schema_mismatch");
      }
    } finally {
      test.cleanup();
    }
  });

  it("被破坏的 config_json 读取时报数据损坏", () => {
    expect(() => parseAgentDefinitionConfig("{not json")).toThrowError(
      StoredJsonError,
    );
    expect(() =>
      parseAgentDefinitionConfig(JSON.stringify({ schemaVersion: 2 })),
    ).toThrowError(StoredJsonError);
    expect(parseAgentDefinitionConfig(CONFIG).maxTurns).toBe(8);
  });

  it("数据损坏错误只带列名、原因和字段路径，不带被拒绝的值", () => {
    try {
      parseAgentDefinitionConfig(
        JSON.stringify({ schemaVersion: 2, maxTurns: 99 }),
      );
      throw new Error("应当抛出数据损坏错误");
    } catch (error) {
      expect(error).toBeInstanceOf(StoredJsonError);
      const stored = error as StoredJsonError;
      expect(stored.details).toBeUndefined();
      expect(stored.issues.length).toBeGreaterThan(0);
      for (const issue of stored.issues) {
        expect(Object.keys(issue).sort()).toEqual(["code", "path"]);
      }
      expect(JSON.stringify(stored.issues)).not.toContain("99");
    }
  });
});

describe("run event sequence 并发", () => {
  it("同一 Run 并发 append 时 sequence 连续、不重复、不跳号", async () => {
    const test = createTestApp();
    try {
      seedRun(test.runtime);
      const repository = createAiRunEventRepository(test.runtime.db);
      const total = 64;
      const events = await Promise.all(
        Array.from({ length: total }, async () =>
          repository.append(eventDraft()),
        ),
      );
      const sequences = events
        .map((event) => event.sequence)
        .sort((a, b) => a - b);
      expect(sequences).toEqual(
        Array.from({ length: total }, (_, index) => index + 1),
      );
      expect(new Set(events.map((event) => event.eventId)).size).toBe(total);
      expect(repository.watermark(runId)).toBe(total);
      expect(
        repository
          .listAfter(runId, 0, total + 1)
          .map((event) => event.sequence),
      ).toEqual(Array.from({ length: total }, (_, index) => index + 1));
    } finally {
      test.cleanup();
    }
  });
});
