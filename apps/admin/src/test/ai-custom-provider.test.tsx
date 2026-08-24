import '@admin/i18n'

import {
  toCreateCustomProviderInput,
  toUpdateCustomProviderInput,
} from '@admin/features/ai/components/CustomProviderDrawer'
import { customAiProviderModelSchema } from '@starter/contracts'
import { describe, expect, it } from 'vitest'

const model = {
  modelId: 'chat-model',
  name: 'Chat Model',
  contextWindow: 128_000,
  maxOutputTokens: 16_000,
  supportsImageInput: true,
  supportsReasoning: true,
  supportsTools: true,
  inputCost: 1,
  outputCost: 2,
  cacheReadCost: 0.2,
  cacheWriteCost: 0.3,
}

const baseValues = {
  providerId: 'custom-provider',
  name: 'Custom Provider',
  baseUrl: 'https://api.example.com/',
  protocol: 'openai-completions' as const,
  compat: {
    supportsDeveloperRole: true,
    supportsToolSearch: true,
    maxTokensField: 'max_tokens',
  },
  apiKey: 'secret-value',
  models: [{ ...model, key: 'model-key' }],
}

describe('custom Provider 表单转换', () => {
  it('创建时规范化 URL、去掉表单 key，并保留当前协议支持的 compat 字段', () => {
    const input = toCreateCustomProviderInput(baseValues)

    expect(input).toEqual({
      providerId: 'custom-provider',
      name: 'Custom Provider',
      baseUrl: 'https://api.example.com',
      protocol: 'openai-completions',
      compat: { supportsDeveloperRole: true, maxTokensField: 'max_tokens' },
      apiKey: 'secret-value',
      models: [model],
    })
    expect(customAiProviderModelSchema.safeParse(input.models[0]).success).toBe(true)
  })

  it('更新时需要 revision，但不会把 API Key 放进定义更新请求', () => {
    expect(toUpdateCustomProviderInput(baseValues, 7)).toEqual({
      expectedRevision: 7,
      name: 'Custom Provider',
      baseUrl: 'https://api.example.com',
      protocol: 'openai-completions',
      compat: { supportsDeveloperRole: true, maxTokensField: 'max_tokens' },
      models: [model],
    })
  })
})
