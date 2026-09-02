import type { AppRegistrar } from '@api/bootstrap/app.types.js'
import { Scalar } from '@scalar/hono-api-reference'

export const registerOpenApi: AppRegistrar = (app, runtime) => {
  if (!runtime.env.OPENAPI_ENABLED) return

  app
    .doc('/doc', {
      openapi: '3.0.0',
      info: {
        version: '0.1.0',
        title: 'Starter API',
        description:
          'Starter 项目的 HTTP API 文档。AI API 分为控制面、运行面和兼容面；运行事件协议与具体前端实现无关。',
      },
      tags: [
        { name: 'System', description: '系统状态接口' },
        { name: 'Auth', description: '登录状态接口' },
        { name: 'Profile', description: '用户资料接口' },
        {
          name: 'AI Control',
          description: 'AI 管理控制面：Provider、模型、Prompt、Skill、Agent、Tool 和用量审计。',
        },
        {
          name: 'AI Runtime',
          description: 'AI 运行面：Session、Agent Run、Transcript 和 RunEvent SSE。',
        },
        {
          name: 'AI Compatibility',
          description: 'Starter 兼容接口：Better Auth 用户模型、模型偏好和旧版 AI 接口。',
        },
      ],
    })
    .get(
      '/reference',
      Scalar({
        url: '/doc',
        pageTitle: 'Starter API Reference',
        layout: 'modern',
        theme: 'default',
        isEditable: false,
        showSidebar: true,
        hideClientButton: true,
        withDefaultFonts: false,
        defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
        cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.64.1',
      }),
    )
}
