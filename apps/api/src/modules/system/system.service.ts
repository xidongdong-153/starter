import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ApiErrorCodes } from '@starter/contracts'
import { AppError } from '@api/shared/app-error.js'

const PINO_LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

export type SystemLogLevel = 'info' | 'warn' | 'error'

export interface SystemLogsQuery {
  requestId?: string
  level?: SystemLogLevel
  query?: string
  page?: number
  pageSize?: number
  limit?: number
}

export type SystemLogEntry = Record<string, unknown>

export interface SystemLogsResult {
  items: SystemLogEntry[]
  total: number
}

export function createSystemService(logsDir: string | undefined) {
  /**
   * 只读查询 pino-roll 日志文件。文件按天命名，从新到旧读取；
   * 单行 JSON 解析失败直接跳过，收集全部匹配行。
   * 传 requestId 时按时间正序返回（链路时间线，取前 limit 条），
   * 否则按时间倒序（最新在前）按 page/pageSize 切片返回。
   */
  function queryLogs(params: SystemLogsQuery): SystemLogsResult {
    if (!logsDir) {
      throw new AppError(ApiErrorCodes.COMMON_INVALID_REQUEST, '未配置日志目录', 400)
    }

    const files = readdirSync(logsDir)
      .filter((name) => name.startsWith('app'))
      .sort((a, b) => (a < b ? 1 : -1))

    const items: SystemLogEntry[] = []
    for (const file of files) {
      const lines = readFileSync(join(logsDir, file), 'utf8').split('\n')
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim()
        if (!line) continue

        let entry: SystemLogEntry
        try {
          entry = JSON.parse(line) as SystemLogEntry
        } catch {
          continue
        }
        if (!matches(entry, params)) continue

        items.push(entry)
      }
    }

    if (params.requestId) {
      items.reverse()
      return {
        items: items.slice(0, params.limit ?? 100),
        total: items.length,
      }
    }

    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 20
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
    }
  }

  return { queryLogs }
}

function matches(entry: SystemLogEntry, params: SystemLogsQuery): boolean {
  if (params.level) {
    const level = resolveLevel(entry.level)
    if (level !== params.level) return false
  }
  if (params.requestId && entry.requestId !== params.requestId) return false
  if (params.query && !JSON.stringify(entry).includes(params.query)) {
    return false
  }
  return true
}

function resolveLevel(value: unknown): string | undefined {
  if (typeof value === 'number') return PINO_LEVEL_NAMES[value]
  if (typeof value === 'string') return value
  return undefined
}

export type SystemService = ReturnType<typeof createSystemService>
