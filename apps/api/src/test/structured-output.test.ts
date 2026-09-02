import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createPiToolAdapter } from '@api/infra/agent/pi-tool-adapter.js'
import { defineAiOutputContract } from '@api/modules/ai/output/output-contract-registry.js'
import { createStructuredOutputTool } from '@api/modules/ai/output/structured-output.tool.js'
import { testRunExecution } from './run-execution.js'

function makeContract(visibility: 'product' | 'admin' = 'product') {
  return defineAiOutputContract({
    name: 'decision.result',
    version: visibility === 'product' ? '1.0.0' : '1.0.1',
    description: 'Validated decision result',
    schema: z.object({ decision: z.string() }),
    renderKind: 'decision',
    visibility,
    mode: 'optional',
  })
}

function makeOptions() {
  const execution = testRunExecution({
    runId: '00000000-0000-4000-8000-000000000001',
  })
  execution.beginTurn(1)
  execution.beginStep('assistant', 1)
  execution.setModelCall('model-call-1')
  return { execution, hasPermission: vi.fn(async () => true) }
}

describe('structured output tool', () => {
  it('服务端再次 safeParse，成功写入并发布，产品可见值带 terminate', async () => {
    const contract = makeContract()
    const persist = vi.fn(() => ({
      id: '00000000-0000-4000-8000-000000000004',
    }))
    const publish = vi.fn()
    const tool = createStructuredOutputTool(contract, { persist, publish })
    const adapter = createPiToolAdapter([tool], makeOptions())

    const result = await adapter.tools[0]!.execute(
      '00000000-0000-4000-8000-000000000006',
      { decision: 'approve' },
      new AbortController().signal,
    )

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ value: { decision: 'approve' } }))
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: contract.ref,
        value: { decision: 'approve' },
        referenceId: '00000000-0000-4000-8000-000000000004',
      }),
    )
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'Structured output accepted.' }],
      details: { terminate: true, status: 'succeeded' },
    })
  })

  it('非法参数不写入也不发布成功事件', async () => {
    const contract = makeContract()
    const persist = vi.fn()
    const publish = vi.fn()
    const tool = createStructuredOutputTool(contract, { persist, publish })
    const adapter = createPiToolAdapter([tool], makeOptions())

    await expect(
      adapter.tools[0]!.execute('00000000-0000-4000-8000-000000000006', { decision: 42 }, new AbortController().signal),
    ).rejects.toThrow('invalid')
    expect(persist).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('admin Contract 只发布安全引用', async () => {
    const contract = makeContract('admin')
    const publish = vi.fn()
    const tool = createStructuredOutputTool(contract, {
      persist: () => ({ id: '00000000-0000-4000-8000-000000000004' }),
      publish,
    })
    const adapter = createPiToolAdapter([tool], makeOptions())

    await adapter.tools[0]!.execute(
      '00000000-0000-4000-8000-000000000006',
      { decision: 'approve' },
      new AbortController().signal,
    )

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ value: null, contract: contract.ref }))
  })

  it('持久化失败不发布成功事件，并终止 Run 的 Tool 路径', async () => {
    const contract = makeContract()
    const publish = vi.fn()
    const onTerminalFailure = vi.fn()
    const tool = createStructuredOutputTool(contract, {
      persist: () => {
        throw new Error('database unavailable')
      },
      publish,
    })
    const options = { ...makeOptions(), onTerminalFailure }
    const adapter = createPiToolAdapter([tool], options)

    await expect(
      adapter.tools[0]!.execute(
        '00000000-0000-4000-8000-000000000006',
        { decision: 'approve' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('storage')
    expect(publish).not.toHaveBeenCalled()
    expect(onTerminalFailure).toHaveBeenCalledWith('storage_failed')
  })
})
