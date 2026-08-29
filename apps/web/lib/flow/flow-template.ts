/**
 * 模板渲染：`{{input}}` 替换起点输入，`{{steps.N.output}}` 替换第 N 个 agent 节点的产出。
 * 单遍正则替换，替换结果不再扫描：产出里即使包含 `{{...}}` 也不会展开（防注入）。
 */

const TEMPLATE_VARIABLE_PATTERN = /\{\{(input|steps\.(\d+)\.output)\}\}/g

export interface TemplateContext {
  input: string
  /** 链上第 N 个 agent 节点的产出；未完成或提取不到时为 null。 */
  outputs: (string | null)[]
}

export interface TemplateRenderResult {
  ok: boolean
  text: string
  error: string | null
}

/**
 * 渲染模板。产出缺失（重试路径上游被跳过、提取失败）时变量保留原文并报错；
 * 静态校验保证正常执行路径不会出现这种情况。
 */
export function renderTemplate(template: string, context: TemplateContext): TemplateRenderResult {
  let error: string | null = null
  const text = template.replace(TEMPLATE_VARIABLE_PATTERN, (whole, name: string, indexText?: string) => {
    if (name === 'input') return context.input
    const output = context.outputs[Number(indexText)]
    if (output === undefined || output === null) {
      error = `模板变量 ${whole} 的上游产出不可用。`
      return whole
    }
    return output
  })
  return { ok: error === null, text, error }
}

/** 可用变量列表：步骤 i 可用 {{input}} 和 {{steps.N.output}}（N < i）。 */
export function availableVariables(stepIndex: number): string[] {
  return ['{{input}}', ...Array.from({ length: stepIndex }, (_, index) => `{{steps.${index}.output}}`)]
}
