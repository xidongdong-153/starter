import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { HonoEnv } from '@api/shared/hono-env.js'
import { AI_EVENT_PROTOCOL_VERSION, streamResumeRequiredFrameSchema, type RunEvent } from '@starter/contracts'

/**
 * 订阅 Run 事件队列并以 SSE 写出。
 * 心跳 15s、按 sequence 去重、终态事件即停；transport 断开只结束当前订阅，不中止 Run。
 * 恢复流的 Last-Event-ID / afterSequence 处理由调用侧完成后再传入 events。
 * 未观察到终态事件就结束时发送 `stream.resume_required` transport frame，
 * 客户端按 frame 内 lastSequence 重连 /events/stream；该 frame 不写 ai_run_events。
 */
export function writeRunEventStream(c: Context<HonoEnv>, events: AsyncIterable<RunEvent>) {
  c.header('Cache-Control', 'no-cache')
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    const iterator = events[Symbol.asyncIterator]()
    const seenSequences = new Set<number>()
    let terminal = false
    let aborted = false
    let lastSequence = 0
    const heartbeat = setInterval(() => {
      void stream.write(': heartbeat\n\n').catch(() => undefined)
    }, 15_000)
    let resolveAbort!: () => void
    const abortedPromise = new Promise<void>((resolve) => {
      resolveAbort = resolve
    })
    stream.onAbort(() => {
      aborted = true
      clearInterval(heartbeat)
      resolveAbort()
    })
    try {
      while (!terminal) {
        const next = await Promise.race([
          iterator.next(),
          abortedPromise.then(() => ({ done: true, value: undefined })),
        ])
        if (next.done) break
        const value = next.value
        if (!value) continue
        lastSequence = Math.max(lastSequence, value.sequence)
        if (seenSequences.has(value.sequence)) continue
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
      // 未见终态且连接未断开（iterator 提前 EOF 或抛错）时提示客户端按 lastSequence 恢复；
      // 连接已断时写 frame 无意义，写失败也静默。
      if (!terminal && !aborted) {
        try {
          await stream.writeSSE({
            event: 'stream.resume_required',
            data: JSON.stringify(
              streamResumeRequiredFrameSchema.parse({
                type: 'stream.resume_required',
                eventProtocolVersion: AI_EVENT_PROTOCOL_VERSION,
                lastSequence,
                reason: 'transport_closed',
              }),
            ),
          })
        } catch {
          // 连接多半已断，静默忽略。
        }
      }
      await iterator.return?.()
    }
  })
}
