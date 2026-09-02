import { createHash } from 'node:crypto'
import type { AiRunResolvedManifest, AiRunResolvedManifestSystemPrompt } from '@starter/contracts'

import type { ResolvedAiOutputContract } from '../output/output-contract-registry.js'

/**
 * 对象键按字典序排序后的确定性序列化，作为全部 hash 的输入格式：
 * 同一数据结构不因键的书写顺序不同而产生不同 hash。
 * undefined 字段跳过；数组元素中的 undefined 按 null 处理（与 JSON.stringify 一致）。
 */
export function canonicalJson(value: unknown): string {
  return serializeCanonical(value)
}

/** 字符串的 SHA-256 十六进制摘要。 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * 组装 Run 启动时固化的 resolved manifest 并计算 manifestHash。
 *
 * manifestHash 是除自身外全部字段的 canonicalJson SHA-256；同一 Agent
 * revision 在不同时间解析出的 manifest 与 hash 相同（资源内容变化会
 * 先传播为 Agent revision 变化）。
 */
export function buildResolvedRunManifest(input: {
  agentId: string | null
  agentRevision: number | null
  model: { providerId: string; modelId: string }
  systemPrompt: AiRunResolvedManifestSystemPrompt | null
  skills: ReadonlyArray<{ skillId: string; revision: number; contentHash: string }>
  tools: ReadonlyArray<{ name: string; version: string; manifestHash: string }>
  outputContract: Pick<ResolvedAiOutputContract, 'name' | 'version' | 'schemaHash'> | null
}): AiRunResolvedManifest {
  const manifest: Omit<AiRunResolvedManifest, 'manifestHash'> = {
    agentId: input.agentId,
    agentRevision: input.agentRevision,
    modelRef: `${input.model.providerId}/${input.model.modelId}`,
    systemPrompt: input.systemPrompt,
    skills: input.skills.map((skill) => ({
      skillId: skill.skillId,
      revision: skill.revision,
      contentHash: skill.contentHash,
    })),
    tools: input.tools.map((tool) => ({
      name: tool.name,
      version: tool.version,
      manifestHash: tool.manifestHash,
    })),
    outputContract: input.outputContract
      ? {
          name: input.outputContract.name,
          version: input.outputContract.version,
          schemaHash: input.outputContract.schemaHash,
        }
      : null,
  }
  return {
    ...manifest,
    manifestHash: sha256Hex(canonicalJson(manifest)),
  }
}

function serializeCanonical(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? null : serializeCanonical(item)))
    return `[${items.join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${serializeCanonical(item)}`).join(',')}}`
  }
  throw new Error(`canonicalJson 不支持的值类型: ${typeof value}`)
}
