import type { FlowDocument } from './flow-document'

export interface BuiltinFlowTemplate {
  id: string
  name: string
  description: string
  createDocument: (now?: Date) => FlowDocument
}

function randomId(): string {
  return crypto.randomUUID()
}

export const BUILTIN_FLOW_TEMPLATES: BuiltinFlowTemplate[] = [
  {
    id: 'article-digest-and-translate',
    name: '文章提炼与英文简报',
    description: '输入长文 -> 提炼要点与核心结构 -> 翻译并生成英文技术简报',
    createDocument: (now: Date = new Date()) => {
      const timestamp = now.toISOString()
      const inputId = randomId()
      const digestAgentId = randomId()
      const translateAgentId = randomId()

      return {
        id: randomId(),
        name: '文章提炼与英文简报',
        nodes: [
          {
            id: inputId,
            type: 'input',
            position: { x: 50, y: 180 },
            data: {
              inputText:
                '现代 Web 开发正快速从单纯的页面渲染向智能化交互转型。AI Agent 不再仅仅是一个外挂的聊天窗口，而是深入到表单填写、流程编排、代码分析和内容生成的各个环节。为了实现高响应性和稳定性，前后端架构需要结合 SSE 流式传输、轻量数据契约和可恢复的状态机。',
            },
          },
          {
            id: digestAgentId,
            type: 'agent',
            position: { x: 420, y: 180 },
            data: {
              agentId: '',
              promptTemplate:
                '请对以下内容进行深度提炼，提取出 3 个核心观点，并以结构化的 Markdown 列表形式输出：\n\n{{input}}',
            },
          },
          {
            id: translateAgentId,
            type: 'agent',
            position: { x: 790, y: 180 },
            data: {
              agentId: '',
              promptTemplate:
                '请将以下提炼的核心观点翻译并整理为一份专业的英文技术简报（Executive Summary），保持专业术语的准确性：\n\n{{steps.0.output}}',
            },
          },
        ],
        edges: [
          { id: randomId(), source: inputId, target: digestAgentId },
          { id: randomId(), source: digestAgentId, target: translateAgentId },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    },
  },
  {
    id: 'code-review-and-test',
    name: '代码审查与测试生成',
    description: '输入源码 -> 分析缺陷与性能瓶颈 -> 输出重构方案与测试用例',
    createDocument: (now: Date = new Date()) => {
      const timestamp = now.toISOString()
      const inputId = randomId()
      const reviewAgentId = randomId()
      const refactorAgentId = randomId()

      return {
        id: randomId(),
        name: '代码审查与测试生成',
        nodes: [
          {
            id: inputId,
            type: 'input',
            position: { x: 50, y: 180 },
            data: {
              inputText:
                'function processUserData(users: any[]) {\n  let result = [];\n  for (let i = 0; i < users.length; i++) {\n    if (users[i].active == true) {\n      result.push({ id: users[i].id, name: users[i].name.trim() });\n    }\n  }\n  return result;\n}',
            },
          },
          {
            id: reviewAgentId,
            type: 'agent',
            position: { x: 420, y: 180 },
            data: {
              agentId: '',
              promptTemplate:
                '请作为资深 TypeScript 工程师审查以下代码，指出类型安全问题、潜在的空指针异常以及可提升的函数式编程写法：\n\n```typescript\n{{input}}\n```',
            },
          },
          {
            id: refactorAgentId,
            type: 'agent',
            position: { x: 790, y: 180 },
            data: {
              agentId: '',
              promptTemplate:
                '基于以下代码审查结论，请给出优雅重构后的 TypeScript 代码，并编写对应的 Vitest 单元测试套件：\n\n审查报告：\n{{steps.0.output}}\n\n原始代码：\n{{input}}',
            },
          },
        ],
        edges: [
          { id: randomId(), source: inputId, target: reviewAgentId },
          { id: randomId(), source: reviewAgentId, target: refactorAgentId },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    },
  },
  {
    id: 'brainstorm-to-prd',
    name: '头脑风暴到方案大纲',
    description: '输入构想 -> 发散可行性方案 -> 细化为结构化 PRD 与实施要点',
    createDocument: (now: Date = new Date()) => {
      const timestamp = now.toISOString()
      const inputId = randomId()
      const brainstormAgentId = randomId()
      const specAgentId = randomId()

      return {
        id: randomId(),
        name: '头脑风暴到方案大纲',
        nodes: [
          {
            id: inputId,
            type: 'input',
            position: { x: 50, y: 180 },
            data: {
              inputText: '构想：在开发脚手架中增加一个支持可视化拖拽编排的 AI Flow 画布系统。',
            },
          },
          {
            id: brainstormAgentId,
            type: 'agent',
            position: { x: 420, y: 180 },
            data: {
              agentId: '',
              promptTemplate:
                '请针对以下产品构想进行头脑风暴，从用户痛点、核心交互创新点、技术可行性三个角度给出 3 种差异化的设计路线：\n\n{{input}}',
            },
          },
          {
            id: specAgentId,
            type: 'agent',
            position: { x: 790, y: 180 },
            data: {
              agentId: '',
              promptTemplate:
                '请综合以下头脑风暴内容，选择最务实且具有良好用户体验的方案，整理为包含目标、核心功能清单、验收标准的实施要点：\n\n{{steps.0.output}}',
            },
          },
        ],
        edges: [
          { id: randomId(), source: inputId, target: brainstormAgentId },
          { id: randomId(), source: brainstormAgentId, target: specAgentId },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    },
  },
]
