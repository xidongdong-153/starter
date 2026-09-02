import type { AiSkillRepository } from '../skill/skill.repository.js'
import { createReadSkillTool } from '../skill/skill-tools.js'
import { createAiToolRegistry, type AiToolRegistry, type RegisteredAiTool } from './tool-registry.js'

/**
 * API 内置 Tool Catalog 的唯一显式组装入口。
 *
 * 生产 Tool 只能通过这里的代码显式注册：runtime 注入（测试注入用途）加上
 * 各业务模块的已审核 Tool 实现。Catalog 不扫描目录、不读取数据库中的
 * handler 名称、不动态 import 请求参数，也不执行 Admin 上传的代码。
 */
export function createBuiltinAiToolRegistry(input: {
  injectedTools: readonly RegisteredAiTool[]
  skillRepository: AiSkillRepository
}): AiToolRegistry {
  return createAiToolRegistry([...input.injectedTools, createReadSkillTool(input.skillRepository)])
}
