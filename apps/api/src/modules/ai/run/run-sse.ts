import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { HonoEnv } from '@api/shared/hono-env.js'
import type { RunEvent } from '@starter/contracts'

/**
 * 订阅 Run 事件队列并以 SSE 写出。
 * 心跳 15s、按 sequence 去重、终态事件即停；transport 断开只结束当前订阅，不中止 Run。
 * 恢复流的 Last-Event-ID / afterSequence 处理由调用侧完成后再传入 events。
 */
export function writeRunEventStream(c: Context<HonoEnv>, events: AsyncIterable<RunEvent>) {
  c.header('Cache-Control', 'no-cache')
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    const iterator = events[Symbol.asyncIterator]()
    const seenSequences = new Set<number>()
    let terminal = false
    const heartbeat = setInterval(() => {
      void stream.write(': heartbeat\n\n').catch(() => undefined)
    }, 15_000)
    let resolveAbort!: () => void
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve
    })
    stream.onAbort(() => {
      clearInterval(heartbeat)
      resolveAbort()
    })
    try {
      while (!terminal) {
        const next = await Promise.race([iterator.next(), aborted.then(() => ({ done: true, value: undefined }))])
        if (next.done) break
        const value = next.value
        if (!value || seenSequences.has(value.sequence)) continue
        seenSequences.add(value.sequence)
        await stream.writeSSE({
          id: value.eventId,
          event: value.type,
          data: JSON.stringify(value),
        })
        terminal = value.type === 'run.completed' || value.type === 'run.failed' || value.type === 'run.aborted'
      }
    } catch {
      // transport 断开只结束当前订阅，不中止 Run。
    } finally {
      clearInterval(heartbeat)
      await iterator.return?.()
    }
  })
}
