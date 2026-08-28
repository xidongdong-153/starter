import type { PipelineStepDefinition } from "@starter/contracts";

/**
 * Pipeline 步骤模板：纯字符串替换，不是编程语言。
 *
 * 语法只有两种变量，正则 `/\{\{(input|steps\.(\d+)\.output)\}\}/g`：
 * - `{{input}}`：整条流水线的原始输入。
 * - `{{steps.N.output}}`：第 N 步（从 0 计）的产出。
 *
 * 其他字面量（含长得像变量的 `{{ foo }}`、`{{steps.x.output}}`）原样保留，
 * 不报错、不替换。需要条件、循环、过滤器就写进 Agent 的 prompt。
 */

export interface StepTemplateIssue {
  /** 违规的步骤序号（从 0 计）。 */
  stepIndex: number;
  /** 违规变量原文，如 `{{steps.0.output}}`。 */
  variable: string;
  /** 该步骤允许引用的最大步骤序号（stepIndex - 1；为 -1 表示没有可引用的前序步骤）。 */
  allowedMaxIndex: number;
}

const TEMPLATE_VARIABLE_PATTERN = /\{\{(input|steps\.(\d+)\.output)\}\}/g;

/**
 * 静态校验（定义保存时）：步骤 i 只能引用 `steps.N.output` 且 N < i。
 * 前置引用只允许看过去，不看未来；校验通过后运行时渲染只剩纯替换。
 */
export function validateStepTemplates(
  steps: ReadonlyArray<Pick<PipelineStepDefinition, "inputTemplate">>,
): StepTemplateIssue | null {
  for (let index = 0; index < steps.length; index += 1) {
    const template = steps[index]!.inputTemplate;
    for (const match of template.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
      const variable = match[0];
      const referenced = Number(match[2]);
      if (match[1] === "input") continue;
      if (referenced >= index) {
        return {
          stepIndex: index,
          variable,
          allowedMaxIndex: index - 1,
        };
      }
    }
  }
  return null;
}

/**
 * 运行时渲染：单遍正则替换，替换结果不再扫描（产出里含 `{{...}}` 字样时
 * 按字面量处理，防止模型输出注入模板指令）。
 *
 * `outputs[i]` 缺失时保留变量原文；静态校验保证正常执行路径不会走到这里
 * （被引用的步骤若未执行到，流水线早已 fail fast 终止）。
 */
export function renderTemplate(
  template: string,
  context: { input: string; outputs: readonly string[] },
): string {
  return template.replace(
    TEMPLATE_VARIABLE_PATTERN,
    (match, name: string, index: string) => {
      if (name === "input") return context.input;
      const output = context.outputs[Number(index)];
      return output === undefined ? match : output;
    },
  );
}
