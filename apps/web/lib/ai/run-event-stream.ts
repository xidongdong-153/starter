import type { RunEvent } from '@starter/contracts'
import { runEventSchema } from '@starter/contracts'
import { ApiRequestError, isApiFailureBody, readJson } from '@web/lib/http'
import { chatRpc, flowRpc } from '@web/lib/rpc'

/** SSE 帧之间是一个空行，服务端换行可能是 `\n` 或 `\r\n`。 */
const FRAME_SEPARATOR = /\r?\n\r?\n/
const LINE_SEPARATOR = /\r?\n/

export interface StartRunStreamInput {
  agentId: string
  /** 可选图片附件引用，与 input 一起构成首条 user message；最多 4 个。 */
  attachmentIds?: string[]
  /** 可选幂等键：同 key 的重复启动返回既有 Run；失败 Run 重试时必须换新 key。 */
  idempotencyKey?: string
  /** 用户输入的文本，服务端会去掉首尾空白后校验长度。 */
  input: string
  /** 可选 lane；不传走 main。Flow 用 flow-<序号> 隔离每个节点的 transcript。 */
  lane?: string
  /** 走哪个产品面：chat 或 flow，决定请求打到 `/api/chat/*` 还是 `/api/flow/*`。 */
  product: 'chat' | 'flow'
  sessionId: string
  signal: AbortSignal
}

export interface ResumeRunStreamInput {
  /** 只要比这个 sequence 更大的事件；传 0 就是从 run.started 开始全量回放。 */
  afterSequence: number
  runId: string
  sessionId: string
  signal: AbortSignal
}

/**
 * 启动 Agent Run 并按顺序产出 RunEvent。
 *
 * 启动失败（连不上、非 2xx、没有响应体）抛 `ApiRequestError`。
 * 流开始后中途断开不抛错，直接结束迭代：Run 还在服务端跑，调用方要转成轮询
 * `GET /runs/{runId}`。所以调用方需要自己记录「有没有收到过事件」和「有没有收到终态事件」：
 * 收到过事件就是断流，一个事件都没收到就是启动失败。
 * 单帧 JSON 或 schema 解析失败只丢这一帧，不中断整个流。
 */
export async function* startRunStream(request: StartRunStreamInput): AsyncGenerator<RunEvent> {
  yield* readRunEvents(await openRunStream(request))
}

/**
 * 接回一条已经存在的 Run 的事件流，不创建新的 Run。
 *
 * `afterSequence: 0` 会先回放这条 Run 的全部持久事件，再接上实时增量，
 * 所以刷新页面后走的是和首次发送同一条折叠路径。Run 已经进终态时回放里就带着终态事件。
 * 断开和坏帧的处理与 `startRunStream` 相同。
 */
export async function* resumeRunStream(request: ResumeRunStreamInput): AsyncGenerator<RunEvent> {
  yield* readRunEvents(await openResumeStream(request))
}

/** 读 SSE 响应体并按帧产出 RunEvent；启动流和恢复流共用这一段。 */
async function* readRunEvents(response: Response): AsyncGenerator<RunEvent> {
  const body = response.body
  if (!body) {
    throw new ApiRequestError(response.status, 'API 没有返回事件流。')
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch {
        // 读流中途断开与服务端提前关闭是同一种情况，交给调用方轮询恢复。
        return
      }
      if (chunk.done) break

      buffer += decoder.decode(chunk.value, { stream: true })
      const frames = buffer.split(FRAME_SEPARATOR)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const event = parseFrame(frame)
        if (event) yield event
      }
    }

    const event = parseFrame(buffer)
    if (event) yield event
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}

/**
 * 发起启动 Run 的请求。
 *
 * 走 `chatRpc` / `flowRpc` 是为了保留路径和 body 的类型约束；这里不能用 `unwrapApiData`，
 * 因为响应是 `text/event-stream`，不是 `{ ok, data, meta }` envelope。
 * `accept` 需要覆盖 client 默认的 `application/json`。
 */
async function openRunStream(request: StartRunStreamInput): Promise<Response> {
  const { agentId, attachmentIds, idempotencyKey, input, lane, product, sessionId, signal } = request
  let response: Response

  try {
    // 新建 Run 从头开始收事件，恢复用的 afterSequence 留空；
    // lane、idempotencyKey 和 attachmentIds 不传时走服务端默认
    // （main lane、不幂等、纯文本），保持原调用不变。
    const args = {
      param: { sessionId },
      json: {
        agentId,
        input,
        ...(lane !== undefined ? { lane } : {}),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        ...(attachmentIds !== undefined && attachmentIds.length > 0 ? { attachmentIds } : {}),
      },
    }
    const options = {
      headers: { accept: 'text/event-stream' },
      init: { cache: 'no-store' as const, signal },
    }
    response = await (product === 'chat'
      ? chatRpc.api.chat.sessions[':sessionId'].runs.$post(args, options)
      : flowRpc.api.flow.sessions[':sessionId'].runs.$post(args, options))
  } catch (error) {
    if (signal.aborted) throw error
    throw new ApiRequestError(0, 'API 服务连不上，请确认服务已经启动。')
  }

  if (!response.ok) {
    throw await toStreamError(response, `启动 Agent Run 失败：${response.status}`)
  }

  return response
}

/**
 * 发起恢复请求。只有 Chat 页面需要接回旧流，固定走 chat 面；Flow 的运行态刷新即弃，没有恢复路径。
 *
 * 用 GET `/events/stream`，不能再 POST 一次 `/runs`，那样会创建第二个 Run。
 * `afterSequence` 走 query，`accept` 同样要覆盖 client 默认的 `application/json`。
 */
async function openResumeStream(request: ResumeRunStreamInput): Promise<Response> {
  const { afterSequence, runId, sessionId, signal } = request
  let response: Response

  try {
    response = await chatRpc.api.chat.sessions[':sessionId'].runs[':runId'].events.stream.$get(
      { param: { runId, sessionId }, query: { afterSequence: String(afterSequence) } },
      { headers: { accept: 'text/event-stream' }, init: { cache: 'no-store', signal } },
    )
  } catch (error) {
    if (signal.aborted) throw error
    throw new ApiRequestError(0, 'API 服务连不上，请确认服务已经启动。')
  }

  if (!response.ok) {
    throw await toStreamError(response, `恢复 Agent Run 事件流失败：${response.status}`)
  }

  return response
}

/** 把非 2xx 的 SSE 响应转成带 status 和 error code 的错误。 */
async function toStreamError(response: Response, fallbackMessage: string): Promise<ApiRequestError> {
  const body = await readJson(response)
  const failure = isApiFailureBody(body) ? body.error : null
  return new ApiRequestError(response.status, failure?.message ?? fallbackMessage, failure?.code ?? null)
}

/**
 * 解析一个 SSE 帧。
 * 只取 `data:` 行拼接，忽略 `id:`、`event:` 和以 `:` 开头的心跳注释。
 */
function parseFrame(frame: string): RunEvent | undefined {
  const payload = frame
    .split(LINE_SEPARATOR)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''))
    .join('\n')
  if (payload.length === 0) return undefined

  let json: unknown
  try {
    json = JSON.parse(payload)
  } catch {
    return undefined
  }

  const parsed = runEventSchema.safeParse(json)
  return parsed.success ? parsed.data : undefined
}
