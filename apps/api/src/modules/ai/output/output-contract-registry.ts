import {
  aiOutputContractRefSchema,
  aiOutputModeSchema,
  aiOutputRenderKindSchema,
  aiOutputVisibilitySchema,
  type AiOutputContractRef,
  type AiOutputMode,
  type AiOutputRenderKind,
  type AiOutputVisibility,
} from '@starter/contracts'
import { z } from 'zod'

import { canonicalJson, sha256Hex } from '@api/modules/ai/run/resolved-manifest.js'

export interface AiOutputContract<T extends z.ZodRawShape = z.ZodRawShape> {
  name: string
  version: string
  description: string
  schema: z.ZodObject<T>
  renderKind: AiOutputRenderKind
  visibility: AiOutputVisibility
  mode: AiOutputMode
}

export interface ResolvedAiOutputContract<T extends z.ZodRawShape = z.ZodRawShape> extends AiOutputContract<T> {
  readonly ref: AiOutputContractRef
  readonly schemaHash: string
}

/** Output Contract 快照的持久化出口；define 时写入，历史读取不依赖进程内注册表。 */
export interface AiOutputContractSnapshotStore {
  upsert: (input: {
    name: string
    version: string
    description: string
    schemaJson: string
    renderKind: AiOutputRenderKind
    visibility: AiOutputVisibility
    mode: AiOutputMode
    now: Date
  }) => void
}

export interface AiOutputContractRegistry {
  define: <T extends z.ZodRawShape>(contract: AiOutputContract<T>) => ResolvedAiOutputContract<T>
  resolve: (ref: Pick<AiOutputContractRef, 'name' | 'version'>) => ResolvedAiOutputContract
  find: (ref: Pick<AiOutputContractRef, 'name' | 'version'>) => ResolvedAiOutputContract | undefined
  list: () => readonly ResolvedAiOutputContract[]
}

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const namePattern = /^[a-z][a-z0-9._-]{0,119}$/u

/** define 时算出的 schema JSON（draft-7）；hash 与快照写入共用，避免重复序列化。 */
function contractSchemaJson<T extends z.ZodRawShape>(schema: z.ZodObject<T>): string {
  return JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' }))
}

export function defineAiOutputContract<T extends z.ZodRawShape>(
  input: AiOutputContract<T>,
): ResolvedAiOutputContract<T> {
  if (!namePattern.test(input.name)) throw new Error('AI Output Contract name 无效')
  if (!semverPattern.test(input.version)) throw new Error('AI Output Contract version 无效')
  if (input.description.trim().length === 0 || input.description.length > 1000) {
    throw new Error('AI Output Contract description 无效')
  }
  if (!(input.schema instanceof z.ZodObject)) {
    throw new Error('AI Output Contract schema 必须是 Zod object')
  }
  aiOutputRenderKindSchema.parse(input.renderKind)
  aiOutputVisibilitySchema.parse(input.visibility)
  aiOutputModeSchema.parse(input.mode)

  const schemaJson = contractSchemaJson(input.schema)
  const schemaHash = sha256Hex(canonicalJson(schemaJson))
  const ref = aiOutputContractRefSchema.parse({
    name: input.name,
    version: input.version,
    schemaHash,
    renderKind: input.renderKind,
    visibility: input.visibility,
    mode: input.mode,
  })
  return Object.freeze({ ...input, ref, schemaHash })
}

export function createAiOutputContractRegistry(
  contracts: readonly ResolvedAiOutputContract[] = [],
  options: { snapshotStore?: AiOutputContractSnapshotStore } = {},
): AiOutputContractRegistry {
  const byRef = new Map<string, ResolvedAiOutputContract>()
  const snapshotStore = options.snapshotStore
  const add = (contract: ResolvedAiOutputContract) => {
    const key = contractKey(contract)
    if (byRef.has(key)) throw new Error(`重复的 AI Output Contract: ${key}`)
    byRef.set(key, contract)
  }
  contracts.forEach(add)

  return Object.freeze({
    define<T extends z.ZodRawShape>(input: AiOutputContract<T>) {
      const contract = defineAiOutputContract(input)
      add(contract)
      snapshotStore?.upsert({
        name: contract.name,
        version: contract.version,
        description: contract.description,
        schemaJson: contractSchemaJson(contract.schema),
        renderKind: contract.renderKind,
        visibility: contract.visibility,
        mode: contract.mode,
        now: new Date(),
      })
      return contract
    },
    resolve(ref: Pick<AiOutputContractRef, 'name' | 'version'>) {
      const contract = byRef.get(contractKey(ref))
      if (!contract) throw new Error(`AI Output Contract 未注册: ${contractKey(ref)}`)
      return contract
    },
    find: (ref: Pick<AiOutputContractRef, 'name' | 'version'>) => byRef.get(contractKey(ref)),
    list: () => [...byRef.values()],
  })
}

function contractKey(ref: Pick<AiOutputContractRef, 'name' | 'version'>): string {
  return `${ref.name}@${ref.version}`
}

/**
 * 组装读取路径（structured-outputs 路由与 transcript 回放共用）的 contract ref：
 * schemaHash / renderKind 取表内记录（emit 时刻的事实）；visibility / mode
 * 优先取表内值（新数据），历史行的 NULL 回退 registry 当前定义；两者都拿不到
 * 返回 null，调用方按不可渲染跳过。renderKind / visibility / mode 校验失败
 * 同样返回 null。
 */
export function toStructuredOutputContractRef(
  record: {
    contractName: string
    contractVersion: string
    schemaHash: string
    renderKind: string
    visibility: string | null
    mode: string | null
  },
  contract: ResolvedAiOutputContract | null | undefined,
): AiOutputContractRef | null {
  const renderKind = aiOutputRenderKindSchema.safeParse(record.renderKind)
  if (!renderKind.success) return null
  let visibility: AiOutputVisibility
  let mode: AiOutputMode
  if (record.visibility !== null && record.mode !== null) {
    const parsedVisibility = aiOutputVisibilitySchema.safeParse(record.visibility)
    const parsedMode = aiOutputModeSchema.safeParse(record.mode)
    if (!parsedVisibility.success || !parsedMode.success) return null
    visibility = parsedVisibility.data
    mode = parsedMode.data
  } else if (contract) {
    visibility = contract.visibility
    mode = contract.mode
  } else {
    return null
  }
  return {
    name: record.contractName,
    version: record.contractVersion,
    schemaHash: record.schemaHash,
    renderKind: renderKind.data,
    visibility,
    mode,
  }
}
