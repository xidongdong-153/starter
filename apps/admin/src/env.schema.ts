import { z } from 'zod'

export const adminEnvSchema = z.object({
  VITE_API_URL: z.string().url().default('http://localhost:7788'),
  VITE_APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type AdminEnv = z.infer<typeof adminEnvSchema>

/**
 * 校验 admin 的环境变量。
 * 缺值或格式不对时直接抛错，错误里写清哪个变量要怎么填。
 */
export function parseAdminEnv(source: Record<string, unknown>): AdminEnv {
  const result = adminEnvSchema.safeParse({
    VITE_API_URL: source.VITE_API_URL,
    VITE_APP_ENV: source.VITE_APP_ENV,
  })

  if (result.success) {
    return result.data
  }

  throw new Error(`admin 环境变量配置错误:\n${formatAdminEnvIssues(source)}`)
}

function formatAdminEnvIssues(source: Record<string, unknown>): string {
  const lines: string[] = []

  if (source.VITE_API_URL === undefined || source.VITE_API_URL === '') {
    lines.push('- VITE_API_URL 没有配置')
  } else if (!z.string().url().safeParse(source.VITE_API_URL).success) {
    lines.push('- VITE_API_URL 必须是完整 URL，例如 http://localhost:7788')
  }

  const appEnv = source.VITE_APP_ENV

  if (appEnv !== undefined && appEnv !== '' && !['development', 'test', 'production'].includes(String(appEnv))) {
    lines.push('- VITE_APP_ENV 只能是 development、test 或 production')
  }

  return lines.join('\n')
}
