import { zodToOpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import type { z } from 'zod'

/**
 * 给共享 contracts schema 注册 OpenAPI 组件名。
 *
 * contracts 只依赖 zod，不能调用 @hono/zod-openapi 的 .openapi()；
 * 而 zod@4.4.3 没有 exports map，Node ESM 与 esbuild/vite 会解析到两个
 * 不同的 zod 类副本，直接对 contracts 实例调用 .openapi() 在部分
 * 运行环境下不可用。这里通过 zod-to-openapi 的全局 registry 注册
 * refId，与 zod 副本无关，@hono/zod-openapi 生成文档时从同一 registry
 * 读取元数据。
 */
export function nameSchema<T extends z.ZodType>(schema: T, refId: string): T {
  zodToOpenAPIRegistry.add(schema, { _internal: { refId } })
  return schema
}
