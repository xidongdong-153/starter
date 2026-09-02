import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../infra/db/migrations')
const legacyMigrations = [
  '0000_broken_komodo.sql',
  '0001_tidy_hellcat.sql',
  '0002_mean_iron_fist.sql',
  '0003_motionless_wrecker.sql',
  '0004_system_logs_read.sql',
  '0005_pale_madrox.sql',
  '0006_crazy_banshee.sql',
  '0007_clammy_shinobi_shaw.sql',
  '0008_illegal_giant_girl.sql',
  '0009_goofy_jean_grey.sql',
  '0010_brief_eddie_brock.sql',
] as const

function runMigration(sqlite: Database.Database, file: string) {
  sqlite.exec(readFileSync(resolve(migrationsFolder, file), 'utf8'))
}

it('harness migration 保留旧记录并增加独立 Run 关联', () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    for (const migration of legacyMigrations) runMigration(sqlite, migration)

    const now = 1_787_000_000_000
    sqlite
      .prepare(
        `INSERT INTO user
          (id, name, email, email_verified, image, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('user-1', 'User', 'user@example.com', 0, null, now, now)
    sqlite
      .prepare(
        `INSERT INTO ai_conversations
          (id, owner_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('conversation-1', 'user-1', 'Legacy', 'idle', now, now)
    sqlite
      .prepare(
        `INSERT INTO ai_conversation_messages
          (id, conversation_id, sequence, role, content_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('message-1', 'conversation-1', 1, 'user', '[{"type":"text","text":"hello"}]', 'completed', now, now)
    sqlite
      .prepare(
        `INSERT INTO ai_generations
          (id, conversation_id, owner_id, status, user_message_id, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('generation-1', 'conversation-1', 'user-1', 'completed', 'message-1', now, now + 100)
    sqlite
      .prepare(
        `INSERT INTO ai_model_calls
          (id, request_id, user_id, scenario, conversation_id, generation_id,
           provider_id, model_id, started_at, finished_at, duration_ms, result,
           stop_reason, input_tokens, output_tokens, total_tokens, cost_total,
           cost_currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'call-1',
        'request-1',
        'user-1',
        'conversation',
        'conversation-1',
        'generation-1',
        'openai',
        'gpt-4o',
        now,
        now + 100,
        100,
        'succeeded',
        'stop',
        2,
        3,
        5,
        0.01,
        'USD',
      )
    sqlite
      .prepare(
        `INSERT INTO ai_provider_configs
          (provider_id, created_at, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run('openai', now, now)
    sqlite
      .prepare(
        `INSERT INTO ai_system_prompts
          (id, name, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('prompt-1', 'Prompt', 'System prompt', now, now)
    sqlite
      .prepare(
        `INSERT INTO ai_skills
          (id, name, description, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('skill-1', 'Skill', 'Description', 'Content', now, now)

    const legacyCounts = Object.fromEntries(
      [
        'ai_conversations',
        'ai_conversation_messages',
        'ai_generations',
        'ai_model_calls',
        'ai_provider_configs',
        'ai_system_prompts',
        'ai_skills',
      ].map((table) => [
        table,
        (
          sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
            count: number
          }
        ).count,
      ]),
    )

    runMigration(sqlite, '0011_normal_sentinel.sql')

    for (const [table, count] of Object.entries(legacyCounts)) {
      expect(
        (
          sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
            count: number
          }
        ).count,
      ).toBe(count)
    }
    for (const table of ['ai_agent_definitions', 'ai_agent_sessions', 'ai_agent_runs']) {
      expect(
        (
          sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
            count: number
          }
        ).count,
      ).toBe(0)
    }

    expect(sqlite.prepare('SELECT * FROM ai_model_calls WHERE id = ?').get('call-1')).toMatchObject({
      conversation_id: 'conversation-1',
      generation_id: 'generation-1',
      run_id: null,
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
      cost_total: 0.01,
      cost_currency: 'USD',
    })
    expect(
      (
        sqlite.pragma("index_info('ai_model_calls_run_started_idx')") as Array<{
          name: string
        }>
      ).map((column) => column.name),
    ).toEqual(['run_id', 'started_at', 'id'])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])

    sqlite
      .prepare(
        `INSERT INTO ai_agent_definitions
          (id, name, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('agent-1', 'Agent', '{"schemaVersion":1}', now, now)
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
      .run('run-1', 'session-1', 'agent-1', 'main', 'starting', 1, '{"schemaVersion":1}', 'request-2', now)
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO ai_model_calls
            (id, request_id, user_id, scenario, conversation_id, generation_id,
             run_id, provider_id, model_id, started_at, result)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'call-invalid',
          'request-3',
          'user-1',
          'agent_run',
          'conversation-1',
          null,
          'run-1',
          'openai',
          'gpt-4o',
          now,
          'running',
        ),
    ).toThrow()
  } finally {
    sqlite.close()
  }
})
