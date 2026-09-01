import { hc } from 'hono/client'
import type { AppType } from '@starter/api/rpc'
import type { ChatAppType } from '@starter/api/rpc/chat'
import type { FlowAppType } from '@starter/api/rpc/flow'

import { apiUrl } from './env.client'
import { ApiRequestError, isApiFailureBody, isApiSuccessBody, readJson } from './http'

/**
 * 普通 JSON 接口的 Hono RPC 客户端。
 * 页面和组件不直接使用，领域 API 函数通过它发起类型化请求。
 */
export const apiRpc = hc<AppType>(apiUrl, {
  init: { credentials: 'include' },
  headers: { accept: 'application/json' },
})

/**
 * Chat 产品面的 RPC 客户端，走 `/api/chat/*`。
 * 产品路由不并入主 `AppType`（类型体积限制，见 api 侧 routes/index.ts），单独建 client；
 * 初始化参数与 `apiRpc` 一致。响应 data 是 unknown，由调用方用 contracts schema 校验。
 */
export const chatRpc = hc<ChatAppType>(apiUrl, {
  init: { credentials: 'include' },
  headers: { accept: 'application/json' },
})

/** Flow 产品面的 RPC 客户端，走 `/api/flow/*`，做法同 `chatRpc`。 */
export const flowRpc = hc<FlowAppType>(apiUrl, {
  init: { credentials: 'include' },
  headers: { accept: 'application/json' },
})

/**
 * 执行 RPC 请求并解包统一 envelope。
 * 网络错误、非 2xx、无效 envelope 都转换为 ApiRequestError。
 */
export async function unwrapApiData<TData>(request: Promise<Response>): Promise<TData> {
  let response: Response

  try {
    response = await request
  } catch {
    throw new ApiRequestError(0, 'API 服务连不上，请确认服务已经启动。')
  }

  const body = await readJson(response)

  if (!response.ok) {
    const failure = isApiFailureBody(body) ? body.error : null
    throw new ApiRequestError(
      response.status,
      failure?.message ?? `请求失败：${response.status}`,
      failure?.code ?? null,
    )
  }

  if (!isApiSuccessBody(body)) {
    throw new ApiRequestError(response.status, 'API 返回的数据格式不正确。')
  }

  return body.data as TData
}
