import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const migrationsFolder = resolve(import.meta.dirname, '../infra/db/migrations')

function applyMigrations(sqlite: Database.Database, throughTag?: string) {
  sqlite.pragma('foreign_keys = ON')
  const journal = JSON.parse(readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>
  }
  for (const entry of journal.entries) {
    sqlite.exec(readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), 'utf8'))
    if (entry.tag === throughTag) break
  }
}

it('移除 ai_call_id 的 replacement migration 保留旧 Tool 行并修复外键', () => {
  const sqlite = new Database(':memory:')
  try {
    applyMigrations(sqlite, '0019_reflective_thanos')
    const now = Date.now()
    sqlite
      .prepare(
        `INSERT INTO ai_model_calls
          (id, request_id, user_id, scenario, provider_id, model_id, started_at, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-call-1', 'request-1', 'user-1', 'model_test', 'openai', 'gpt-test', now, 'succeeded')
    sqlite
      .prepare(
        `INSERT INTO ai_tool_executions
          (id, ai_call_id, tool_name, started_at, status, timeout_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-tool-1', 'legacy-call-1', 'lookup', now, 'succeeded', 5000)

    sqlite.exec(readFileSync(resolve(migrationsFolder, '0020_amusing_plazm.sql'), 'utf8'))

    const columns = sqlite.prepare(`SELECT name FROM pragma_table_info('ai_tool_executions')`).all() as Array<{
      name: string
    }>
    expect(columns.map((column) => column.name)).not.toContain('ai_call_id')
    expect(
      sqlite.prepare(`SELECT model_call_id, tool_name FROM ai_tool_executions WHERE id = ?`).get('legacy-tool-1'),
    ).toEqual({ model_call_id: 'legacy-call-1', tool_name: 'lookup' })

    const modelCallForeignKey = (
      sqlite.prepare(`SELECT "from", "on_delete" FROM pragma_foreign_key_list('ai_tool_executions')`).all() as Array<{
        from: string
        on_delete: string
      }>
    ).find((key) => key.from === 'model_call_id')
    expect(modelCallForeignKey).toEqual({
      from: 'model_call_id',
      on_delete: 'CASCADE',
    })

    sqlite.prepare(`DELETE FROM ai_model_calls WHERE id = ?`).run('legacy-call-1')
    expect(sqlite.prepare(`SELECT id FROM ai_tool_executions WHERE id = ?`).get('legacy-tool-1')).toBeUndefined()
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
  }
})

it('新 Run 执行事实可以按关系写入并随 Run 级联删除', () => {
  const sqlite = new Database(':memory:')
  try {
    applyMigrations(sqlite)
    const now = Date.now()

    sqlite
      .prepare(
        `INSERT INTO user
          (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('user-1', 'User', 'user@example.com', 0, now, now)
    sqlite
      .prepare(
        `INSERT INTO ai_agent_definitions
          (id, name, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('agent-1', 'Agent', '{"schemaVersion":2}', now, now)
    sqlite
      .prepare(
        `INSERT INTO ai_agent_sessions
          (id, owner_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('session-1', 'user-1', 'Session', now, now)
    sqlite
      .prepare(
        `INSERT INTO ai_agent_runs
          (id, session_id, agent_id, lane, status, agent_revision,
           snapshot_json, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('run-1', 'session-1', 'agent-1', 'main', 'running', 1, '{"schemaVersion":2}', 'request-1', now)
    sqlite
      .prepare(
        `INSERT INTO ai_run_turns
          (id, run_id, turn_index, started_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run('turn-1', 'run-1', 1, now)
    sqlite
      .prepare(
        `INSERT INTO ai_run_steps
          (id, run_id, turn_id, kind, attempt, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('step-1', 'run-1', 'turn-1', 'assistant', 1, now)
    sqlite
      .prepare(
        `INSERT INTO ai_model_calls
          (id, request_id, user_id, scenario, run_id, turn_id, step_id,
           provider_id, model_id, started_at, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'call-1',
        'request-1',
        'user-1',
        'agent_run',
        'run-1',
        'turn-1',
        'step-1',
        'openai',
        'gpt-5.6-sol',
        now,
        'running',
      )
    sqlite
      .prepare(
        `INSERT INTO ai_tool_executions
          (id, run_id, model_call_id, turn_id, step_id,
           tool_call_id, tool_execution_id, tool_name, started_at, status, timeout_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'tool-row-1',
        'run-1',
        'call-1',
        'turn-1',
        'step-1',
        'tool-call-1',
        'tool-execution-1',
        'lookup',
        now,
        'running',
        30_000,
      )
    sqlite
      .prepare(
        `INSERT INTO ai_run_events
          (event_id, run_id, sequence, type, payload_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('event-1', 'run-1', 1, 'run.started', '{}', now)
    sqlite
      .prepare(
        `INSERT INTO ai_structured_outputs
          (id, run_id, step_id, contract_name, contract_version,
           schema_hash, render_kind, value_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('output-1', 'run-1', 'step-1', 'decision', '1.0.0', 'sha256:test', 'decision', '{"approved":true}', now)

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO ai_run_events
            (event_id, run_id, sequence, type, payload_json, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('event-duplicate', 'run-1', 1, 'run.started', '{}', now),
    ).toThrow()

    sqlite.prepare('DELETE FROM ai_agent_runs WHERE id = ?').run('run-1')
    for (const table of ['ai_run_turns', 'ai_run_steps', 'ai_run_events', 'ai_structured_outputs']) {
      expect(
        (
          sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
            count: number
          }
        ).count,
      ).toBe(0)
    }
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
  }
})

it('ai_agent_runs 已经等于目标形态，不需要 replacement migration', () => {
  const sqlite = new Database(':memory:')
  try {
    applyMigrations(sqlite)

    const columns = sqlite.prepare(`SELECT name, "notnull" FROM pragma_table_info('ai_agent_runs')`).all() as Array<{
      name: string
      notnull: number
    }>
    expect(columns.map((column) => column.name).sort()).toEqual(
      [
        'id',
        'session_id',
        'agent_id',
        'lane',
        'status',
        'agent_revision',
        'snapshot_json',
        'request_id',
        'idempotency_key',
        'idempotency_scope',
        'current_attempt_no',
        'final_entry_id',
        'error_code',
        'execution_fencing_token',
        'created_at',
        'started_at',
        'finished_at',
      ].sort(),
    )
    // 终态关系字段、幂等键、内联配置的 agent 标识和 fencing token（历史行为 NULL）允许为空
    expect(
      columns
        .filter((column) => column.notnull === 0)
        .map((column) => column.name)
        .sort(),
    ).toEqual(
      [
        'final_entry_id',
        'error_code',
        'execution_fencing_token',
        'started_at',
        'finished_at',
        'idempotency_key',
        'idempotency_scope',
        'agent_id',
        'agent_revision',
      ].sort(),
    )

    const ddl = (
      sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_agent_runs'`).get() as {
        sql: string
      }
    ).sql
    expect(ddl).toContain('ai_agent_runs_status_check')
    expect(ddl).toContain('ai_agent_runs_revision_check')
    expect(ddl).toContain('ai_agent_runs_snapshot_json_check')
    expect(ddl).toContain('ai_agent_runs_agent_pair_check')

    const foreignKeys = sqlite
      .prepare(`SELECT "table", "on_delete" FROM pragma_foreign_key_list('ai_agent_runs')`)
      .all() as Array<{ table: string; on_delete: string }>
    expect(foreignKeys.map((key) => `${key.table}:${key.on_delete}`).sort()).toEqual([
      'ai_agent_definitions:RESTRICT',
      'ai_agent_sessions:CASCADE',
    ])

    expect(
      (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ai_agent_runs' AND sql IS NOT NULL`,
          )
          .all() as Array<{ name: string }>
      )
        .map((index) => index.name)
        .sort(),
    ).toEqual(
      [
        'ai_agent_runs_session_created_idx',
        'ai_agent_runs_session_lane_status_idx',
        'ai_agent_runs_agent_created_idx',
        'ai_agent_runs_status_created_idx',
        'ai_agent_runs_request_idx',
        'ai_agent_runs_finished_idx',
        'ai_agent_runs_idempotency_unique',
      ].sort(),
    )
  } finally {
    sqlite.close()
  }
})
