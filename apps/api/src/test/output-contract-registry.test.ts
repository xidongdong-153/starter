import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createAiOutputContractRegistry,
  defineAiOutputContract,
} from '@api/modules/ai/output/output-contract-registry.js'
import { defineAiTool } from '@api/modules/ai/tool/tool-registry.js'

const contractInput = {
  name: 'decision.result',
  version: '1.2.3',
  description: 'Validated decision result',
  schema: z.object({ decision: z.string() }),
  renderKind: 'decision' as const,
  visibility: 'product' as const,
  mode: 'required' as const,
}

describe('ai output contract registry', () => {
  it('校验定义并按 name/version 精确解析，不自动选择其他版本', () => {
    const registry = createAiOutputContractRegistry()
    const first = registry.define(contractInput)
    const second = registry.define({ ...contractInput, version: '2.0.0' })

    expect(first.schemaHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(first.ref).toEqual({
      name: 'decision.result',
      version: '1.2.3',
      schemaHash: first.schemaHash,
      renderKind: 'decision',
      visibility: 'product',
      mode: 'required',
    })
    expect(registry.resolve({ name: first.name, version: first.version })).toBe(first)
    expect(registry.resolve({ name: second.name, version: second.version })).toBe(second)
    expect(() => registry.resolve({ name: first.name, version: '3.0.0' })).toThrow('未注册')
    expect(() => registry.define(contractInput)).toThrow('重复')
  })

  it('拒绝非法 name、semver、空描述和非 object schema', () => {
    expect(() => defineAiOutputContract({ ...contractInput, name: 'Bad Name' })).toThrow('name')
    expect(() => defineAiOutputContract({ ...contractInput, version: 'latest' })).toThrow('version')
    expect(() => defineAiOutputContract({ ...contractInput, description: ' ' })).toThrow('description')
    expect(() =>
      defineAiOutputContract({
        ...contractInput,
        schema: z.string() as never,
      }),
    ).toThrow('Zod object')
  })

  it('拒绝业务 Tool 使用 emit_structured_output 保留名称', () => {
    expect(() =>
      defineAiTool({
        name: 'emit_structured_output',
        version: '1.0.0',
        description: 'Conflicting business tool',
        inputSchema: z.object({}),
        timeoutMs: 1000,
        scope: 'platform',
        requiredPermission: null,
        execute: async () => ({ modelText: 'ok', safeSummary: null }),
      }),
    ).toThrow('保留')
  })
})
