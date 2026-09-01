/**
 * Flow 常用 Prompt 模板预设与起点输入示例
 */

export interface FlowPromptPreset {
  id: string
  name: string
  description: string
  template: (prevVar: string) => string
}

export interface FlowInputSample {
  id: string
  name: string
  content: string
}

/** 常用 Prompt 模式预设 */
export const FLOW_PROMPT_PRESETS: FlowPromptPreset[] = [
  {
    id: 'pass-through',
    name: '承接上游并处理',
    description: '直接承接上一节点的产出并继续深加工',
    template: (prevVar) =>
      `请基于以下内容进行进一步分析与补充：\n\n${prevVar}\n\n要求：\n1. 逻辑严密，重点突出\n2. 给出具体可落地的建议`,
  },
  {
    id: 'json-extract',
    name: '结构化 JSON 提取',
    description: '将上游产出转为严格的 JSON 格式',
    template: (prevVar) =>
      `请将以下内容提取并整理为标准的 JSON 格式：\n\n${prevVar}\n\n请只输出符合规范的 JSON 内容（包含在 \`\`\`json 代码块内）。`,
  },
  {
    id: 'review-critique',
    name: '多维度审查评审',
    description: '从优势、潜在风险和优化建议三方面评估',
    template: (prevVar) =>
      `请作为专业评审专家，对以下方案进行严谨审查：\n\n${prevVar}\n\n请按以下结构输出：\n1. 【核心优势】\n2. 【潜在风险与不足】\n3. 【具体改进措施】`,
  },
  {
    id: 'summarize',
    name: '核心要点提炼',
    description: '提炼核心结论与要点清单',
    template: (prevVar) =>
      `请对以下内容进行高度提炼：\n\n${prevVar}\n\n要求：\n- 提炼出不超过 5 条核心要点（Bullet Points）\n- 语言凝练，直击要害`,
  },
  {
    id: 'code-gen',
    name: '代码实现与重构',
    description: '根据需求或设计生成高质量代码',
    template: (prevVar) =>
      `请根据以下规范和需求编写高质量的 TypeScript 代码：\n\n${prevVar}\n\n要求：\n1. 遵循现代 TypeScript 严格模式规范\n2. 包含必要的类型定义与错误处理`,
  },
]

/** 常用起点输入示例数据 */
export const FLOW_INPUT_SAMPLES: FlowInputSample[] = [
  {
    id: 'product-requirement',
    name: '产品需求场景',
    content:
      '设计一个支持可视化拖拽的流程编排模块，需要支持节点创建、连线、Prompt 变量插值（如 {{input}} 和 {{steps.0.output}}）以及运行态实时观测。请分析核心用户故事与关键交互痛点。',
  },
  {
    id: 'tech-architecture',
    name: '技术架构调研',
    content:
      '对比 Next.js 16 App Router 与 Vite SPA 在复杂多智能体管理后台系统中的架构优势与适用边界，分析两者的状态管理、流式渲染（Streaming SSE）与构建部署策略。',
  },
  {
    id: 'code-refactor',
    name: '代码优化审查',
    content:
      '前端应用在长时间运行后可能存在内存泄漏和重复渲染问题，特别是在复杂的 React Flow 画布与高频事件监听场景下。请梳理排查路线与性能优化 Checklist。',
  },
]
