import type { AiSkillSummary, AiToolSummary, AiUserModel } from '@starter/contracts'
import { aiSkillSummarySchema, aiToolSummarySchema, aiUserModelSchema } from '@starter/contracts'
import { z } from 'zod'
import { apiRpc, unwrapApiData } from '@web/lib/rpc'

/**
 * Flow 自定义节点配置面板的数据源，走主 API（`/api/ai/*`）。
 * 响应校验与 `flow.api.ts` 同一套做法。
 */

/** 当前用户可用模型（管理员白名单内且 Provider 可用），模型下拉的数据源。 */
export async function listUserModels(): Promise<AiUserModel[]> {
  const data = await unwrapApiData<unknown>(apiRpc.api.ai.models.$get({ init: { cache: 'no-store' } }))
  return parseApiData(z.array(aiUserModelSchema).safeParse(data), '模型列表')
}

/** 工具注册表列表（name/version/description），自定义节点选工具用。 */
export async function listAiTools(): Promise<AiToolSummary[]> {
  const data = await unwrapApiData<unknown>(apiRpc.api.ai.tools.$get({ init: { cache: 'no-store' } }))
  return parseApiData(z.array(aiToolSummarySchema).safeParse(data), '工具列表')
}

/** 技能列表；只取已启用的给配置面板选。 */
export async function listEnabledSkills(): Promise<AiSkillSummary[]> {
  const data = await unwrapApiData<unknown>(apiRpc.api.ai.skills.$get({ init: { cache: 'no-store' } }))
  const skills = parseApiData(z.array(aiSkillSummarySchema).safeParse(data), '技能列表')
  return skills.filter((skill) => skill.enabled)
}

/** 校验失败时抛出，错误里带上是哪个接口的数据对不上。 */
function parseApiData<TData>(result: { data: TData; success: true } | { success: false }, source: string): TData {
  if (!result.success) {
    throw new Error(`${source}的数据格式不正确。`)
  }
  return result.data
}
