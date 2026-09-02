import { createDatabase } from '@api/infra/db/client.js'
import { createAuthorizationRepository } from '@api/modules/authorization/authorization.repository.js'
import { parseEnv } from '@api/shared/env.js'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface BootstrapOutput {
  error: (message: string) => void
  log: (message: string) => void
}

export function runBootstrapAdmin(input: NodeJS.ProcessEnv = process.env, output: BootstrapOutput = console): 0 | 1 {
  let database: ReturnType<typeof createDatabase> | undefined

  try {
    const env = parseEnv(input)
    const email = env.AUTH_BOOTSTRAP_ADMIN_EMAIL
    if (!email) {
      throw new Error('未配置 AUTH_BOOTSTRAP_ADMIN_EMAIL，请在 apps/api/.env.development 中填写已存在账号的邮箱')
    }

    database = createDatabase(env.DATABASE_PATH)
    let result
    try {
      result = createAuthorizationRepository(database.db).bootstrapAdminByEmail(email, {
        actorType: 'system',
        actorId: 'auth:bootstrap-admin',
        requestId: null,
      })
    } catch (error) {
      if (error instanceof Error && /no such table:/i.test(error.message)) {
        throw new Error('授权表不存在，请先运行 pnpm --filter @starter/api db:migrate')
      }
      throw error
    }

    if (result.kind === 'user-not-found') {
      throw new Error(`没有找到邮箱为 ${email} 的已存在用户，请先注册账号`)
    }
    if (result.kind === 'admin-role-not-found') {
      throw new Error('系统 admin 角色不存在，请确认 migration 已完整执行')
    }

    output.log(`已将 ${result.user.email} 的角色替换为 admin`)
    return 0
  } catch (error) {
    output.error(error instanceof Error ? error.message : '管理员初始化失败')
    return 1
  } finally {
    database?.sqlite.close()
  }
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  process.exitCode = runBootstrapAdmin()
}
