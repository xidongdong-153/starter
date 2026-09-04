import type { Context } from 'hono'

import type { HonoEnv } from '@api/shared/hono-env.js'
import { createSuccessResponse } from '@api/shared/response.js'
import { startAgentRunJsonSchema } from '@starter/contracts'

import type {
  AgentRuntimeEventCursor,
  AgentRuntimePort,
  AgentRuntimeStartInput,
} from '../runtime/agent-runtime.port.js'
import { writeRunEventStream } from './run-sse.js'

export async function startRunTransport(c: Context<HonoEnv>, port: AgentRuntimePort, input: AgentRuntimeStartInput) {
  const result = await port.start(input)
  if (acceptsJson(c.req.header('accept'))) {
    // JSON 模式没有消费者：立即结束 start queue，事件不再积累。
    // push 对已关闭 queue 是 no-op，Run 执行与终态不受影响；幂等命中的回放流同样结束。
    await result.events[Symbol.asyncIterator]().return?.()
    return c.json(createSuccessResponse(startAgentRunJsonSchema.parse({ runId: result.runId }), c.var.requestId), 200)
  }
  return writeRunEventStream(c, result.events)
}

export function resumeRunTransport(
  c: Context<HonoEnv>,
  port: AgentRuntimePort,
  input: {
    access: AgentRuntimeStartInput['access']
    sessionId: string
    runId: string
    afterSequence: number
  },
) {
  const cursor = resolveRunEventCursor(input.afterSequence, c.req.header('Last-Event-ID'))
  const events = port.subscribe(input.access, input.sessionId, input.runId, cursor)
  return writeRunEventStream(c, events)
}

export function resolveRunEventCursor(afterSequence: number, lastEventId?: string): AgentRuntimeEventCursor {
  if (afterSequence > 0) return { afterSequence }
  if (lastEventId) return { lastEventId }
  return { afterSequence: 0 }
}

function acceptsJson(accept: string | undefined): boolean {
  const value = accept ?? ''
  return value.includes('application/json') && !value.includes('text/event-stream')
}
