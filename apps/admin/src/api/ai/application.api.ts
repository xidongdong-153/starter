import type { AiApplication, AiApplicationSecret, CreateAiApplicationInput } from '@starter/contracts'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

export function getAiApplications(): Promise<AiApplication[]> {
  return unwrapApiData(apiRpc.api.ai.admin.applications.$get())
}

/** 响应包含一次性 secret，调用方只能临时展示，不要写入缓存或日志。 */
export function createAiApplication(input: CreateAiApplicationInput): Promise<AiApplicationSecret> {
  return unwrapApiData(apiRpc.api.ai.admin.applications.$post({ json: input }))
}

/** 轮换后旧 secret 立即失效，新 secret 只在本次响应返回。 */
export function rotateAiApplicationSecret(appId: string): Promise<AiApplicationSecret> {
  return unwrapApiData(apiRpc.api.ai.admin.applications[':appId'].rotate.$post({ param: { appId } }))
}

export function revokeAiApplication(appId: string): Promise<AiApplication> {
  return unwrapApiData(apiRpc.api.ai.admin.applications[':appId'].revoke.$post({ param: { appId } }))
}
